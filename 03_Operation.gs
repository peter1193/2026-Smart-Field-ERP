/**
 * [모듈 03] 03_Operation.gs
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: 현장일지 기록(자재 차감), 일정 등록(캘린더), 상황판 브리핑, 안전 확인
 * 최종 업데이트: 2026-02-16
 * 수정자: Gemini (강성묵 과장 시스템 설계 최종 합의안 반영 - 달력 UI 규격 보정)
 */

/**
 * 📝 1. 현장일지 기록 및 자재 재고 자동 차감
 */
function recordFieldJournal(chatId, journalData) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const journalSheet = ss.getSheetByName(CONFIG.SHEETS.FIELD_LOG) || ss.getSheetByName("현장일지");
  if (!journalSheet) return Telegram.sendMessage(chatId, "⚠️ 현장일지 시트를 찾을 수 없습니다.");

  journalSheet.appendRow([
    journalData.date || new Date(),           // A: 작업일자
    journalData.siteName,                     // B: 현장명
    journalData.process,                      // C: 작업공정
    journalData.workerCount,                  // D: 투입인원
    journalData.description,                  // E: 작업내용
    journalData.matName1,                     // F: 자재명 1
    journalData.matQty1,                      // G: 소요량 1
    journalData.matUnit1,                     // H: 단위 1
    journalData.matName2,                     // I: 자재명 2
    journalData.matQty2,                      // J: 소요량 2
    journalData.matUnit2,                     // K: 단위 2
    journalData.photoUrl || "",               // L: 현장사진
    journalData.note || "",                   // M: 특이사항
    String(chatId),                           // N: 관리자ID
    new Date()                                // O: 최종업데이트
  ]);

  // 🚀 자재 자동 차감 실행
  if (journalData.matName1 && journalData.matQty1 > 0) {
    updateMaterialStock(journalData.matName1, journalData.matQty1);
  }
  if (journalData.matName2 && journalData.matQty2 > 0) {
    updateMaterialStock(journalData.matName2, journalData.matQty2);
  }

  return Telegram.sendMessage(chatId, "✅ 현장일지가 기록되었으며, 자재 재고가 자동으로 차감되었습니다.");
}

/**
 * 📦 자재고 차감 처리 유틸리티
 */
function updateMaterialStock(matName, useQty) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const matSheet = ss.getSheetByName(CONFIG.SHEETS.MATERIALS);
  if (!matSheet) return;

  const data = matSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][CONFIG.COL.MAT_NAME]).trim() === String(matName).trim()) {
      const currentQty = Number(data[i][CONFIG.COL.MAT_QTY]) || 0;
      const newQty = currentQty - useQty;
      matSheet.getRange(i + 1, CONFIG.COL.MAT_QTY + 1).setValue(newQty);
      matSheet.getRange(i + 1, CONFIG.COL.MAT_DATE + 1).setValue(new Date());
      break;
    }
  }
}

/**
 * 📅 2. 작업 일정 등록 (구글 캘린더 연동)
 */
function registerScheduleFromChat(chatId, text) {
  const now = new Date();
  let targetDate = new Date(now);
  
  if (text.includes("내일")) targetDate.setDate(now.getDate() + 1);
  else if (text.includes("모레")) targetDate.setDate(now.getDate() + 2);
  
  const filteredParts = text.trim().split(/\s+/).filter(p => !["오늘", "내일", "모레"].some(k => p.includes(k)));
  const fieldName = filteredParts[0] || "현장명 미정";
  const workDesc = filteredParts[1] || "작업내용 미정";
  const staffInfo = filteredParts.slice(2).join(" ") || "정보 없음";

  try {
    const calendar = CalendarApp.getDefaultCalendar();
    const startTime = parseInt(getOpSetting("업무시작시간")) || 8; 
    
    calendar.createEvent(`[Field] ${fieldName}`, 
      new Date(targetDate.setHours(startTime, 0, 0)), 
      new Date(targetDate.setHours(startTime + 9, 0, 0)), 
      { description: `작업: ${workDesc}\n인원: ${staffInfo}\n기록자: Smart Field AI` }
    );
    
    return { 
      date: Utilities.formatDate(targetDate, "GMT+9", "yyyy-MM-dd"), 
      field: fieldName, 
      desc: workDesc, 
      staff: staffInfo 
    };
  } catch (e) { return null; }
}

/**
 * 📊 3. 실시간 종합 상황판 브리핑
 */
function getTodayComprehensiveBriefing() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName(CONFIG.SHEETS.LOG);
  if (!logSheet) return "⚠️ 출근부 시트를 찾을 수 없습니다.";

  const todayStr = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd");
  const logData = logSheet.getDataRange().getValues();
  const c = CONFIG.COL;

  let totalIn = 0;
  let siteStats = {}; 
  let totalPay = 0;

  for (let j = 1; j < logData.length; j++) {
    if (!logData[j][c.L_DATE]) continue;
    const lDate = (logData[j][c.L_DATE] instanceof Date) ? 
                  Utilities.formatDate(logData[j][c.L_DATE], "GMT+9", "yyyy-MM-dd") : String(logData[j][c.L_DATE]);
    
    if (lDate.includes(todayStr)) {
      totalIn++;
      const siteName = logData[j][c.L_SITE] || "미지정";
      const status = logData[j][c.L_STATUS] || "대기";
      if (!siteStats[siteName]) siteStats[siteName] = { count: 0, active: 0 };
      siteStats[siteName].count++;
      if (["출근", "작업중", "퇴근완료"].includes(status)) siteStats[siteName].active++;
      totalPay += (Number(logData[j][c.L_TOTAL]) || 0);
    }
  }

  let briefing = `<b>[📅 Smart Field 실시간 상황판]</b>\n기준: ${todayStr}\n\n`;
  briefing += `👷 <b>총 출근 인원: ${totalIn}명</b>\n💰 <b>지급 예정액: ${totalPay.toLocaleString()}원</b>\n━━━━━━━━━━━━━━━\n`;
  
  for (let site in siteStats) {
    briefing += `📍 <b>${site}</b>\n   인원: ${siteStats[site].count}명 (활성: ${siteStats[site].active}명)\n`;
  }
  return briefing + `━━━━━━━━━━━━━━━\n※ 강 과장님 설계 기준 기반 집계`;
}

/**
 * 📅 4. 달력 UI 생성 유틸리티
 */
function sendScheduleSummary(chatId, year, month) {
  const targetYear = year || new Date().getFullYear();
  const targetMonth = month || (new Date().getMonth() + 1);
  const calendarKeyboard = createCalendarKeyboard(targetYear, targetMonth);
  
  const msg = `📅 <b>작업 일정 관리 (${targetYear}년 ${targetMonth}월)</b>\n날짜를 선택하여 상세 일정을 조회하세요.`;
  
  // 🚀 교정: 00번 모듈 엔진 규격에 맞춰 객체 상태로 전달
  return Telegram.sendMessage(chatId, msg, { reply_markup: { inline_keyboard: calendarKeyboard } });
}

function createCalendarKeyboard(year, month) {
  let keyboard = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDay = new Date(year, month - 1, 1).getDay();
  const weekDays = ["일", "월", "화", "수", "목", "금", "토"];
  
  keyboard.push(weekDays.map(day => ({ text: day, callback_data: "ignore" })));

  let row = [];
  for (let i = 0; i < firstDay; i++) row.push({ text: " ", callback_data: "ignore" });

  for (let day = 1; day <= daysInMonth; day++) {
    row.push({ text: String(day), callback_data: `date_click_${year}-${month}-${day}` });
    if (row.length === 7) { keyboard.push(row); row = []; }
  }

  if (row.length > 0) {
    while (row.length < 7) row.push({ text: " ", callback_data: "ignore" });
    keyboard.push(row);
  }

  keyboard.push([
    { text: "⬅️ 이전 달", callback_data: `cal_prev_${year}_${month}` }, 
    { text: "다음 달 ➡️", callback_data: `cal_next_${year}_${month}` }
  ]);
  keyboard.push([{ text: "🏠 메인메뉴", callback_data: "go_main" }]);
  
  return keyboard;
}