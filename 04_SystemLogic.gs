/**
 * [모듈 04] 04_SystemLogic.gs
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: 오너 승인 액션 처리 및 출근부 실제 데이터 기록 (Action Handler)
 * 최종 업데이트: 2026-02-16
 * 수정자: Gemini (강성묵 과장 시스템 설계 최종 합의안 반영 - 데이터 무결성 강화)
 */

/**
 * 💸 1. 오너(대표님) 및 관리자 승인 Callback 처리
 */
function handleOwnerApproval(chatId, data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // A. [지출 승인 처리]
  if (data.startsWith("exp_auth_")) {
    const parts = data.split("_");
    const action = parts[2]; 
    const requesterId = parts[3];
    const sheet = ss.getSheetByName(CONFIG.SHEETS.EXPENSE);
    if (!sheet) return;
    const lastRow = sheet.getLastRow();
    
    // 설계기준: E열(5번째 열) 지출 상태값 업데이트
    if (action === "ok") {
      sheet.getRange(lastRow, 5).setValue("승인완료"); 
      Telegram.sendMessage(chatId, "✅ 해당 지출 건을 최종 승인하였습니다.");
      Telegram.sendMessage(requesterId, "🔔 <b>[지출 승인 완료]</b>\n제출하신 영수증이 대표님 승인을 얻어 정산 대상으로 분류되었습니다.");
    } else {
      sheet.getRange(lastRow, 5).setValue("반려");
      Telegram.sendMessage(chatId, "❌ 해당 지출 건을 반려하였습니다.");
      Telegram.sendMessage(requesterId, "🚫 <b>[지출 반려 알림]</b>\n제출하신 지출 내역이 반려되었습니다. 다시 확인 후 재제출 바랍니다.");
    }
  }

  // B. [정산 마감 확인]
  if (data.startsWith("owner_pay_confirm_")) {
    const rowIdx = parseInt(data.split("_")[3]);
    const sheet = ss.getSheetByName(CONFIG.SHEETS.REVENUE);
    if (sheet) {
      // 설계기준: F열(6번 열) 상태 업데이트
      sheet.getRange(rowIdx, 6).setValue("입금완료"); 
      Telegram.sendMessage(chatId, `💰 <b>[장부 마감 완료]</b>\n정산장부 항목의 입금 확인 및 모든 절차가 종료되었습니다.`);
    }
  }
}

/**
 * 📍 2. 출근부 데이터 기록 엔진 (FieldService)
 * 설계 기준: A(신청일시)~S(정산확인) 19개 열 정밀 매핑
 */
const FieldService = {
  recordLog: function(workerChatId, siteName, type, role) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const logSheet = ss.getSheetByName(CONFIG.SHEETS.LOG);
    if (!logSheet) return;

    const worker = getWorkerInfoByChatId(workerChatId);
    const now = new Date();
    const timeStr = Utilities.formatDate(now, "GMT+9", "HH:mm");
    const dateStr = Utilities.formatDate(now, "GMT+9", "yyyy-MM-dd");
    const c = CONFIG.COL;

    // [출근 처리 - IN]
    if (type === "IN") {
      let newRow = new Array(19).fill(""); 
      
      newRow[c.L_DATE] = now;               // A: 신청일시
      newRow[c.L_ID] = workerChatId;        // B: ID
      newRow[c.L_NAME] = worker.name;       // C: 이름
      newRow[c.L_NATION] = worker.lang;     // D: 국적/언어
      newRow[c.L_SITE] = siteName;          // E: 현장
      
      // F(5) 상태: 마스터 특별 관리 적용
      newRow[c.L_STATUS] = (role && role.isMaster) ? "마스터점검" : "출근"; 
      
      newRow[c.L_BASIC] = worker.basicPay;   // H: 기본급
      newRow[c.L_TOTAL] = worker.basicPay;   // K: 총지급액 초기값
      
      try {
        const fieldSheet = ss.getSheetByName(CONFIG.SHEETS.FIELDS);
        const fData = fieldSheet.getDataRange().getValues();
        for(let i=1; i<fData.length; i++) {
          if(fData[i][CONFIG.COL.F_NAME] === siteName) {
            newRow[c.L_WEATHER] = getLiveWeather(fData[i][CONFIG.COL.F_LAT], fData[i][CONFIG.COL.F_LON]);
            newRow[c.L_LAT] = fData[i][CONFIG.COL.F_LAT];
            newRow[c.L_LON] = fData[i][CONFIG.COL.F_LON];
            newRow[c.L_LOC] = `https://www.google.com/maps?q=${fData[i][CONFIG.COL.F_LAT]},${fData[i][CONFIG.COL.F_LON]}`;
            break;
          }
        }
      } catch(e) { newRow[c.L_WEATHER] = "🌡️ 날씨확인불가"; }
      
      newRow[17] = "Telegram_GPS";          // R: 인증방식
      newRow[c.L_CHECK] = "승인대기";        // S: 정산확인

      logSheet.appendRow(newRow);
      return true;
    } 
    
    // [퇴근 처리 - OUT]
    else if (type === "OUT") {
      const data = logSheet.getDataRange().getValues();
      // 🚀 역순 탐색으로 당일 본인의 마지막 출근 기록 탐색
      for (let i = data.length - 1; i >= 1; i--) {
        const rowDate = (data[i][c.L_DATE] instanceof Date) ? 
                        Utilities.formatDate(data[i][c.L_DATE], "GMT+9", "yyyy-MM-dd") : "";
        
        if (String(data[i][c.L_ID]) === String(workerChatId) && rowDate === dateStr) {
          logSheet.getRange(i + 1, c.L_STATUS + 1).setValue("퇴근완료"); // F(5)
          logSheet.getRange(i + 1, 17).setValue(`퇴근인증: ${timeStr}`); // Q(16)
          logSheet.getRange(i + 1, 16).setValue("System_Auto");          // P(15)
          return true;
        }
      }
    }
    return false;
  }
};