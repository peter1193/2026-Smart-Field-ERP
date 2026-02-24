/**
 * [모듈 04] 04_SystemLogic.gs
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: 오너 승인 액션 처리 및 출근부 실제 데이터 기록 (Action Handler)
 * 최종 업데이트: 2026-02-24 (출근부 A~S열 정밀 매핑 및 위치 인증 강화)
 */

/**
 * 💸 1. 오너(대표님) 및 관리자 승인 Callback 처리
 */
function handleOwnerApproval(chatId, data) {
  const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  
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
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    const logSheet = ss.getSheetByName(CONFIG.SHEETS.LOG);
    if (!logSheet) return false;

    const worker = getWorkerInfoByChatId(workerChatId);
    const now = new Date();
    const timeStr = Utilities.formatDate(now, "GMT+9", "HH:mm");
    const dateStr = Utilities.formatDate(now, "GMT+9", "yyyy-MM-dd");
    const c = CONFIG.COL;

    // [출근 처리 - IN]
    if (type === "IN") {
      let newRow = new Array(19).fill(""); 
      
      newRow[0] = now;                          // A: 신청일시
      newRow[1] = workerChatId;                 // B: ID
      newRow[2] = worker.name || "미등록";      // C: 이름
      newRow[3] = worker.lang || "KO";          // D: 국적/언어
      newRow[4] = siteName;                     // E: 현장
      
      // F(5) 상태: 마스터 특별 관리 적용
      newRow[5] = (role && role.isMaster) ? "마스터점검" : "출근"; 
      
      newRow[7] = worker.basicPay || 0;         // H: 기본급
      newRow[10] = worker.basicPay || 0;        // K: 총지급액 초기값
      
      try {
        const fieldSheet = ss.getSheetByName(CONFIG.SHEETS.FIELDS);
        const fData = fieldSheet.getDataRange().getValues();
        for(let i=1; i<fData.length; i++) {
          // 현장정보 A열(현장명) 매칭
          if(String(fData[i][0]).trim() === String(siteName).trim()) {
            // 날씨 정보는 추후 API 연동을 위해 예약
            newRow[11] = "🌤️ 확인중";             // L: 날씨
            newRow[12] = fData[i][2];             // M: 위도
            newRow[13] = fData[i][3];             // N: 경도
            newRow[14] = `https://www.google.com/maps?q=${fData[i][2]},${fData[i][3]}`; // O: 위치
            break;
          }
        }
      } catch(e) { newRow[11] = "🌡️ 날씨확인불가"; }
      
      newRow[17] = "TG_GPS_Auth";               // R: 인증방식
      newRow[18] = "승인대기";                   // S: 정산확인

      logSheet.appendRow(newRow);
      
      // [자연어기록]에 흔적 남기기
      logToNaturalLanguage(workerChatId, "출근보고", `${worker.name}: ${siteName} 입소 완료`);
      
      return true;
    } 
    
    // [퇴근 처리 - OUT]
    else if (type === "OUT") {
      const data = logSheet.getDataRange().getValues();
      // 🚀 역순 탐색으로 당일 본인의 마지막 출근 기록 탐색
      for (let i = data.length - 1; i >= 1; i--) {
        const rowDate = (data[i][0] instanceof Date) ? 
                        Utilities.formatDate(data[i][0], "GMT+9", "yyyy-MM-dd") : "";
        
        if (String(data[i][1]) === String(workerChatId) && rowDate === dateStr) {
          logSheet.getRange(i + 1, 6).setValue("퇴근완료");   // F: 상태
          logSheet.getRange(i + 1, 17).setValue(`퇴근:${timeStr}`); // Q: 비고
          logSheet.getRange(i + 1, 16).setValue("System_Auto");    // P: 승인자
          
          // [자연어기록]에 흔적 남기기
          logToNaturalLanguage(workerChatId, "퇴근보고", `${worker.name}: 작업 종료 및 퇴소`);
          
          return true;
        }
      }
    }
    return false;
  }
};

/**
 * 📝 [자연어기록] 탭에 로그 남기기 유틸리티
 */
function logToNaturalLanguage(id, type, content) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    const logSheet = ss.getSheetByName(CONFIG.SHEETS.NLP_LOG);
    if (logSheet) {
      logSheet.appendRow([new Date(), id, type, content, "", "", "완료"]);
    }
  } catch(e) { console.error("NLP 로그 기록 실패"); }
}