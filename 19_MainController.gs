/**
 * [모듈 19] 19_MainController.gs
 * 프로젝트: 2026 Smart Field ERP (통합 관제탑)
 * 역할: 전 시스템 단일 게이트웨이(doPost), 보안 필터링, 시스템 복구 및 트리거 제어
 * 최종 업데이트: 2026-02-24 (무한 루프 차단 및 자연어기록 연동 강화)
 */

/** 1. 메인 게이트웨이 (doPost) */
function doPost(e) {
  // [안전장치 1] 중복 요청 방지를 위한 Lock 설정 (1초)
  const lock = LockService.getScriptLock();
  
  try {
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

    /* 0️⃣ 로그 기록 (자연어기록 시트 및 로그 서비스 연동) */
    const chatId = contents.message ? contents.message.chat.id : 
                   (contents.callback_query ? contents.callback_query.message.chat.id : "SYSTEM");
    
    if (typeof LogService !== 'undefined') {
      LogService.logMessage(chatId, "RAW_WEBHOOK", contents);
    }

    /* 1️⃣ 선제적 응답 반환 (재전송 방지)
       로직 처리 전 텔레그램 서버에 "OK" 신호를 보내 재시도 루프를 차단합니다. */
    const response = ContentService.createTextOutput("OK");

    /* A️⃣ 콜백 처리 (Inline 버튼 클릭) */
    if (contents.callback_query) {
      const query = contents.callback_query;
      const callbackData = query.data;
      const queryId = query.id;
      const userName = query.from.first_name || "사용자";

      // 1) 금융/정산/승인 관련 (FIN_Callback 등 연동)
      if (callbackData.startsWith("approve_") || callbackData.startsWith("settle_") || callbackData.startsWith("add_income_") || callbackData.startsWith("view_") || callbackData.startsWith("exp_auth_") || callbackData.startsWith("owner_")) {
        if (typeof handleOwnerApproval === 'function') {
          handleOwnerApproval(chatId, callbackData);
        } else if (typeof FIN_handleCallback_v2 === 'function') {
          FIN_handleCallback_v2(callbackData, chatId, query.message.message_id, userName);
        }
      }

      // 2) 공지 모드 트리거
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

      // 3) 긴급 싸이렌/SOS 처리
      else if (callbackData === "siren_all" || callbackData === "CONFIRM_SIREN_ALL") {
        if (typeof QueueEngine !== 'undefined' && typeof QueueEngine.broadcastSiren === 'function') {
          QueueEngine.broadcastSiren(chatId, "🚨 과장님 긴급 지시: 즉시 현장 대기 및 상황 보고 바랍니다.");
        }
      }

      Telegram.answerCallbackQuery(queryId);
      return response;
    }

    /* B️⃣ 메시지 처리 (텍스트/음성/사진) */
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

      // 2) 기본 명령어 (/start) 및 리프레시
      if (text === "/start" || text === "🏠 메인메뉴") {
        if (typeof routeMainMenu === 'function') {
          routeMainMenu(chatId);
        } else if (typeof UIHandler !== 'undefined') {
          const userRole = (typeof getUserRole === "function") ? getUserRole(chatId) : { ROLE: "MASTER" };
          UIHandler.마스터_대시보드_발송(chatId, userRole);
        }
        return response;
      }

      // 3) 지능형 자연어 명령어 처리 (CommandHandler 연동)
      if (text && typeof handleTextMessage === 'function') {
        const userRole = (typeof getUserRole === "function") ? getUserRole(chatId) : { isAdmin: false };
        handleTextMessage(chatId, text, userRole);
        return response;
      }

      // 4) 사진/이미지 분석 (Gemini AI 연동)
      if (msg.photo && typeof GeminiAI !== 'undefined') {
        GeminiAI.analyzeMaterialPhoto(chatId, msg.photo);
        return response;
      }
    }

    return response;

  } catch (err) {
    if (typeof LogService !== 'undefined') LogService.logError("doPost_Main_Fatal", err);
    return ContentService.createTextOutput("ERROR_STABILIZED");
  } finally {
    lock.releaseLock();
  }
}

/** 2. 시스템 초기화 및 복구 로직 (Webhook Reset 포함) */
function system_fullDeployAndReset() {
  const ui = SpreadsheetApp.getUi();
  try {
    const url = ScriptApp.getService().getUrl();
    if (!url || url.indexOf("exec") === -1) throw new Error("웹앱 배포(새 배포)가 선행되어야 합니다.");

    const token = getSettingValue("BOT_TOKEN");
    if (!token) throw new Error("시스템설정 시트에서 BOT_TOKEN을 찾을 수 없습니다.");

    if (typeof Telegram !== 'undefined') {
      Telegram.call('setWebhook', { 
        url: url, 
        drop_pending_updates: true,
        allowed_updates: ["message", "callback_query"]
      });
      Telegram.call('setMyCommands', { 
        commands: [{ command: "start", description: "ERP 리모컨 호출" }] 
      });
    }

    setupQueueTrigger();
    setupBackupTrigger();

    ui.alert("✅ [2026 Smart Field ERP] 시스템 초기화 및 통신 정체 제거 완료");
  } catch (e) {
    ui.alert("❌ 초기화 오류: " + e.toString());
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

/** 4. 백업 트리거 설정 (매일 밤 23시) */
function setupBackupTrigger() {
  const handler = 'scheduledBackupTrigger';
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => { if (t.getHandlerFunction() === handler) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger(handler).timeBased().atHour(23).everyDays(1).create();
}

/** 5. 스프레드시트 상단 메뉴 생성 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🛠️ ERP 관리')
    .addItem('🚀 시스템 초기화 (웹훅/트리거 복구)', 'system_fullDeployAndReset')
    .addItem('🆘 시스템 전체 강제 동기화', 'TOTAL_SYSTEM_RECOVERY')
    .addToUi();
}

/** 6. 시스템 전체 강제 동기화 (Emergency Sync) */
function TOTAL_SYSTEM_RECOVERY() {
  const url = ScriptApp.getService().getUrl();
  if (!url || url.indexOf("exec") === -1) {
    Browser.msgBox("❌ 먼저 [배포] -> [새 배포]를 진행하세요!");
    return;
  }

  try {
    const token = getSettingValue("BOT_TOKEN");
    if (!token) throw new Error("BOT_TOKEN 미설정");
    
    const telegramApi = "https://api.telegram.org/bot" + token + "/";
    UrlFetchApp.fetch(telegramApi + "setWebhook?url=" + encodeURIComponent(url) + "&drop_pending_updates=true");
    
    setupQueueTrigger();
    Browser.msgBox("✅ 복구 완료! 텔레그램 서버에 정체된 모든 신호를 비우고 재연결했습니다.");
  } catch (e) {
    Browser.msgBox("❌ 복구 실패: " + e.toString());
  }
}

/** 7. 설정값 동적 획득 내부 함수 (시스템설정 시트 기반) */
function getSettingValue(key) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEETS.SYSTEM) || ss.getSheetByName("시스템설정");
    if (!sheet) return "";
    
    const data = sheet.getDataRange().getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === key) return String(data[i][1]).trim();
    }
  } catch(e) { return ""; }
  return "";
}