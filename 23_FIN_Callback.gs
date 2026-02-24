/**
 * [모듈 23] 23_FIN_Callback.gs
 * 프로젝트: 2026 Smart Field ERP (통합 관제탑)
 * 역할: 금융 콜백 액션 처리 및 입금액 데이터 재주입 엔진
 * 수정사항: 
 * 1. 입금 성공 시 새로운 메시지를 보내는 대신 기존 안내 메시지를 수정(Update)하여 UX 최적화
 * 2. 모든 객체를 [Telegram]으로 표준화 및 answerCallbackQuery 위임 구조 유지
 * 3. 파견인력매출 확인자 기록 위치를 J열(10번)로 고정하여 I열 비고 보존
 */

/** 1. 버튼 액션 및 콜백 통합 처리 함수 */
function FIN_handleCallback_v2(callbackData, chatId, messageId, userName) {
  const lock = LockService.getScriptLock();
  try {
    // 1. 동시 클릭 방지 (최대 5초 대기)
    if (!lock.tryLock(5000)) return;

    const parts = callbackData.split("_");
    if (parts.length < 4) return;

    const action = parts[0];      // approve, settle, add, view
    const type = parts[1];        // pay, labor, income
    const row = Number(parts[2]); // 시트 행 번호
    const id = parts[3];          // 항목 고유 ID (A열 값)

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 메뉴 전환 요청 처리 (22번 연동)
    if (action === "view") {
      if (typeof FIN_sendCategoryView === 'function') {
        FIN_sendCategoryView(chatId, type);
      }
      return;
    }

    // --- A. 지출(pay, labor) 2단계 통제 로직 ---
    if (type === "pay" || type === "labor") {
      let sheetName = (type === "pay") ? "지급일정관리" : "외부인력정산";
      let colMap = (type === "pay") ? { status: 7, date: 8, user: 9 } : { status: 10, date: 11, user: 12 };
      
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet) return;

      // 행 밀림 방어: ID 대조 (무결성 체크)
      const currentId = String(sheet.getRange(row, 1).getValue()).trim();
      if (currentId !== id) {
        Logger.log("무결성 오류: ID 불일치 (요청:" + id + ", 현재:" + currentId + ")");
        return;
      }

      const currentStatus = String(sheet.getRange(row, colMap.status).getValue());

      // [1단계] 승인권자 액션: 대기 -> 승인
      if (action === "approve" && currentStatus === "대기") {
        sheet.getRange(row, colMap.status).setValue("승인");
        
        const approvalText = `✅ <b>[지급 승인 완료]</b>\n\n<b>ID:</b> ${id}\n<b>승인자:</b> ${userName}\n<b>상태:</b> 승인 (지급 대기)`;
        FIN_updateTelegramMessage(chatId, messageId, approvalText);
      } 
      // [2단계] 지급권자 액션: 승인 -> 완료
      else if (action === "settle" && currentStatus === "승인") {
        sheet.getRange(row, colMap.status).setValue("완료");
        sheet.getRange(row, colMap.date).setValue(new Date()); 
        sheet.getRange(row, colMap.user).setValue(userName); 

        const settleText = `💰 <b>[최종 지급 완료]</b>\n\n<b>ID:</b> ${id}\n<b>집행자:</b> ${userName}\n<b>일시:</b> ${Utilities.formatDate(new Date(), "GMT+9", "MM/dd HH:mm")}`;
        FIN_updateTelegramMessage(chatId, messageId, settleText);
      }
    }

    // --- B. 입금(income) 처리 로직 (로그 기반) ---
    else if (type === "income" && action === "add") {
      const masterSheet = ss.getSheetByName("파견인력매출");
      if (!masterSheet) return;

      // ID 대조를 통한 무결성 확인
      const masterId = String(masterSheet.getRange(row, 1).getValue()).trim();
      if (masterId !== id) return;

      // 💡 UX 개선: 기존 버튼 메시지를 입력 안내 메시지로 즉시 수정
      const promptMsg = `🏦 <b>[입금 확인 입력]</b>\n\n<b>거래처:</b> ${masterSheet.getRange(row, 2).getValue()}\n<b>잔액:</b> ${masterSheet.getRange(row, 6).getValue().toLocaleString()}원\n\n확인된 입금액을 숫자로만 입력해 주세요.`;
      
      // CacheService에 messageId를 포함하여 저장 (나중에 수정하기 위함)
      const cache = CacheService.getScriptCache();
      cache.put("FIN_INPUT_MODE_" + chatId, `INCOME_ADD_${row}_${id}_${messageId}`, 300); 
      
      FIN_updateTelegramMessage(chatId, messageId, promptMsg);
    }

  } catch (e) {
    console.error("23_FIN_Callback Error: " + e.toString());
  } finally {
    lock.releaseLock();
  }
}

/** 2. 입금액 입력 처리 (19_MainController에서 호출) */
function FIN_processInboundAmount(chatId, amountText, userName) {
  const cache = CacheService.getScriptCache();
  const cacheKey = "FIN_INPUT_MODE_" + chatId;
  const inputMode = cache.get(cacheKey);
  
  if (!inputMode || !inputMode.startsWith("INCOME_ADD")) return;

  const parts = inputMode.split("_");
  const row = Number(parts[2]);
  const id = parts[3];
  const originalMessageId = parts[4]; // 보관했던 메시지 ID
  const amount = Number(amountText.replace(/[^0-9]/g, ''));

  if (isNaN(amount) || amount <= 0) {
    if (typeof Telegram !== 'undefined') Telegram.sendMessage(chatId, "⚠️ 숫자만 정확히 입력해 주세요.");
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName("파견입금로그");
  const masterSheet = ss.getSheetByName("파견인력매출");
  
  if (!logSheet || !masterSheet) return;

  // 1. 로그 시트에 트랜잭션 기록
  const logId = "LOG-" + Utilities.formatDate(new Date(), "GMT+9", "yyyyMMddHHmmss");
  logSheet.appendRow([logId, id, new Date(), amount, userName]);

  // 2. 마스터 시트 최종입금일(H열:8번) 및 확인자(J열:10번) 자동 기록
  masterSheet.getRange(row, 8).setValue(new Date());
  masterSheet.getRange(row, 10).setValue(userName);

  cache.remove(cacheKey);

  // 💡 UX 개선: 입력 안내 메시지를 성공 보고서로 교체하여 채팅방 정돈
  const successMsg = `🏦 <b>[입금 기록 완료]</b>\n\n<b>매출 ID:</b> ${id}\n<b>금액:</b> ${amount.toLocaleString()}원\n<b>확인자:</b> ${userName}\n\n시스템이 잔액과 상태를 자동으로 갱신했습니다.`;
  
  if (originalMessageId) {
    FIN_updateTelegramMessage(chatId, originalMessageId, successMsg);
  } else if (typeof Telegram !== 'undefined') {
    Telegram.sendMessage(chatId, successMsg);
  }
}

/** [내부함수] 텔레그램 메시지 갱신 처리 (객체 단일화) */
function FIN_updateTelegramMessage(chatId, messageId, text) {
  try {
    if (typeof Telegram !== 'undefined') {
      Telegram.editMessageText(chatId, messageId, text);
    }
  } catch (e) {
    Logger.log("메시지 갱신 실패: " + e.toString());
  }
}