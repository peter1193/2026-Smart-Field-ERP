/**
 * [모듈 19] 19_MainController.gs
 * 프로젝트: 2026 Smart Field ERP (통합 관제탑)
 * 역할: 전 시스템 단일 게이트웨이(doPost), 하드코딩 제거 및 설정 기반 운영
 * 최종 업데이트: 2026-02-23 (무한 루프 방지: 선 응답 후 처리 및 봇 메시지 차단 로직 보강)
 */

/** 1. 메인 게이트웨이 (doPost) */
function doPost(e) {
  // [안전장치 1] 중복 요청 방지를 위한 Lock 설정
  const lock = LockService.getScriptLock();
  
  try {
    // 1초 이내에 락을 얻지 못하면 중복 신호로 간주하고 즉시 종료
    if (!lock.tryLock(1000)) {
      return ContentService.createTextOutput("LOCKED");
    }

    // 데이터 유효성 검사
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput("NO_DATA");
    }
    
    const contents = JSON.parse(e.postData.contents);

    // [안전장치 2] 봇이 보낸 메시지는 무조건 무시 (무한 루프 차단 핵심)
    const isBot = contents.message && contents.message.from && contents.message.from.is_bot;
    if (isBot) {
      return ContentService.createTextOutput("IGNORE_BOT");
    }

    /* 0️⃣ 로그 기록 (비동기 처리를 위해 상단 배치) */
    if (typeof LogService !== 'undefined') {
      const logId = contents.message ? contents.message.chat.id : 
                   (contents.callback_query ? contents.callback_query.message.chat.id : "SYSTEM");
      LogService.logMessage(logId, "RAW_WEBHOOK", contents);
    }

    /* 1️⃣ 선제적 응답 반환 (재전송 방지)
       로직 처리 전 텔레그램 서버에 "잘 받았다"고 신호를 보내 루프를 원천 차단합니다. */
    const response = ContentService.createTextOutput("OK");

    /* A️⃣ 콜백 처리 (Inline 버튼) */
    if (contents.callback_query) {
      const query = contents.callback_query;
      const callbackData = query.data;
      const chatId = query.message.chat.id;
      const queryId = query.id;
      const userName = query.from.first_name || "관리자";

      // 1) 금융/정산 처리
      if (callbackData.startsWith("approve_") || callbackData.startsWith("settle_") || callbackData.startsWith("add_income_") || callbackData.startsWith("view_")) {
        if (typeof FIN_handleCallback_v2 === 'function') {
          FIN_handleCallback_v2(callbackData, chatId, query.message.message_id, userName);
        }
      }

      // 2) 공지 대상 선택
      else if (callbackData.startsWith("notice_")) {
        const target = callbackData.split("_")[1];
        const labelMap = { all: "전 직원", admin: "관리자", worker: "근로자" };
        CacheService.getScriptCache().put("NOTICE_MODE_" + chatId, target, 600);
        
        Telegram.call('sendMessage', {
          chat_id: chatId,
          text: `📢 **[공지 내용 입력]**\n대상: **${labelMap[target] || target}**\n\n내용을 입력해 주세요. ('취소' 입력 시 중단)`,
          parse_mode: "Markdown"
        });
      }

      // 3) 싸이렌 실행
      else if (callbackData === "CONFIRM_SIREN_ALL") {
        if (typeof QueueEngine !== 'undefined' && typeof QueueEngine.broadcastSiren === 'function') {
          QueueEngine.broadcastSiren(chatId, "⚠️ 오너 긴급 지시사항입니다. 즉시 확인 바랍니다.");
        }
      }

      Telegram.answerCallbackQuery(queryId);
      return response;
    }

    /* B️⃣ 메시지 처리 (텍스트/사진) */
    if (contents.message) {
      const msg = contents.message;
      const text = msg.text;
      const chatId = msg.chat.id;

      const cache = CacheService.getScriptCache();
      const noticeTarget = cache.get("NOTICE_MODE_" + chatId);

      // 공지 모드 텍스트 입력 처리
      if (text && noticeTarget) {
        if (text.includes("취소")) {
          cache.remove("NOTICE_MODE_" + chatId);
          Telegram.sendMessage(chatId, "❌ 공지 발송이 취소되었습니다.");
        } else if (typeof QueueEngine !== 'undefined' && typeof QueueEngine.sendGroupNotice === 'function') {
          QueueEngine.sendGroupNotice(chatId, noticeTarget, text);
          cache.remove("NOTICE_MODE_" + chatId);
        }
        return response;
      }

      // /start 명령어 처리
      if (text === "/start") {
        const userRole = (typeof getUserRole === "function") ? getUserRole(chatId) : { ROLE: "MASTER" };
        if (typeof routeMainMenu === 'function') {
          routeMainMenu(chatId);
        } else if (typeof UIHandler !== 'undefined') {
          UIHandler.마스터_대시보드_발송(chatId, userRole);
        }
        return response;
      }

      // 일반 텍스트 명령어 처리
      if (typeof handleTextMessage === 'function' && text) {
        const userRole = (typeof getUserRole === "function") ? getUserRole(chatId) : { ROLE: "MASTER" };
        handleTextMessage(chatId, text, userRole);
        return response;
      }

      // 사진 분석 처리
      if (msg.photo && typeof GeminiAI !== 'undefined') {
        GeminiAI.analyzeMaterialPhoto(chatId, msg.photo);
        return response;
      }
    }

    return response;

  } catch (err) {
    if (typeof LogService !== 'undefined') LogService.logError("doPost_Main", err);
    return ContentService.createTextOutput("ERROR_STABILIZED");
  } finally {
    // 반드시 락 해제
    lock.releaseLock();
  }
}

/** 2. 시스템 초기화 및 복구 로직 (Webhook Reset 포함) */
function system_fullDeployAndReset() {
  const ui = SpreadsheetApp.getUi();
  try {
    const url = ScriptApp.getService().getUrl();
    if (!url || url.indexOf("exec") === -1) throw new Error("웹앱 배포가 필요합니다.");

    const token = getSettingValue("BOT_TOKEN");
    if (!token) throw new Error("BOT_TOKEN을 찾을 수 없습니다.");

    if (typeof Telegram !== 'undefined') {
      // drop_pending_updates: true를 통해 정체된 메시지를 싹 비우고 재연결합니다.
      Telegram.call('setWebhook', { url: url, drop_pending_updates: true });
      Telegram.call('setMyCommands', { commands: [{ command: "start", description: "리모컨 호출" }] });
    }

    setupQueueTrigger();
    setupBackupTrigger();

    ui.alert("✅ 시스템 초기화 및 무한 루프 정체 제거 완료");
  } catch (e) {
    ui.alert("❌ 오류: " + e.toString());
  }
}

/** 3. 큐 엔진 트리거 자동 생성 (1분 단위) */
function setupQueueTrigger() {
  const handler = 'runQueueEngineProcess';
  const triggers = ScriptApp.getProjectTriggers();
  let exists = false;
  triggers.forEach(t => { if (t.getHandlerFunction() === handler) exists = true; });
  if (!exists) ScriptApp.newTrigger(handler).timeBased().everyMinutes(1).create();
}

/** 4. 백업 트리거 설정 */
function setupBackupTrigger() {
  const handler = 'scheduledBackupTrigger';
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => { if (t.getHandlerFunction() === handler) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger(handler).timeBased().atHour(23).everyDays(1).create();
}

/** 5. 스프레드시트 메뉴 생성 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🛠️ ERP 관리')
    .addItem('🚀 시스템 초기화 (웹훅/트리거 복구)', 'system_fullDeployAndReset')
    .addItem('🆘 시스템 전체 강제 동기화', 'TOTAL_SYSTEM_RECOVERY')
    .addToUi();
}

/** 6. 시스템 전체 강제 동기화 (Emergency Sync) */
function TOTAL_SYSTEM_RECOVERY() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settingsSheet = ss.getSheetByName("시스템설정");
  const url = ScriptApp.getService().getUrl();
  
  if (!url || url.indexOf("exec") === -1) {
    Browser.msgBox("❌ 먼저 [배포] -> [새 배포]를 통해 웹앱 URL을 만드세요!");
    return;
  }

  try {
    const token = getSettingValue("BOT_TOKEN");
    if (!token) throw new Error("BOT_TOKEN을 찾을 수 없습니다.");
    
    const telegramApi = "https://api.telegram.org/bot" + token + "/";
    // 강제 리셋: 쌓인 업데이트 삭제 옵션 추가
    UrlFetchApp.fetch(telegramApi + "setWebhook?url=" + encodeURIComponent(url) + "&drop_pending_updates=true");
    
    setupQueueTrigger();
    Browser.msgBox("✅ 복구 완료! 쌓여있던 메시지들이 모두 비워졌습니다.");
  } catch (e) {
    Browser.msgBox("❌ 복구 실패: " + e.toString());
  }
}

/** 7. 설정값 동적 획득 내부 함수 */
function getSettingValue(key) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("시스템설정");
  if (!sheet) return "";
  
  const data = sheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === key) return String(data[i][1]).trim();
  }
  return "";
}