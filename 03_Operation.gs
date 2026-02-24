/**
 * [모듈 03] 03_Operation.gs
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: 현장일지 기록(레시피 기반 자재 차감), 일정 등록, 상황판 브리핑
 * 최종 업데이트: 2026-02-24 (운영설정 과수소요량 자동 차감 및 자연어기록 연동 반영)
 */

/**
 * 📝 1. 현장일지 기록 및 자재 재고 자동 차감
 * 과장님 지침: 운영설정의 레시피(BOM)를 읽어와 여러 자재를 한 번에 차감함
 */
function recordFieldJournal(chatId, journalData) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const journalSheet = ss.getSheetByName(CONFIG.SHEETS.FIELD_LOG) || ss.getSheetByName("현장일지");
  if (!journalSheet) return Telegram.sendMessage(chatId, "⚠️ 현장일지 시트를 찾을 수 없습니다.");

  // 1. 현장일지 데이터 기록 (A열~O열 매핑)
  journalSheet.appendRow([
    journalData.date || new Date(),           // A: 작업일자
    journalData.siteName,                     // B: 현장명
    journalData.process,                      // C: 작업공정
    journalData.workerCount,                  // D: 투입인원
    journalData.description,                  // E: 작업내용
    journalData.matName1 || journalData.recipeName, // F: 자재명(또는 레시피명)
    journalData.matQty1 || journalData.outputQty,  // G: 소요량(또는 완성품 수량)
    journalData.matUnit1 || "EA",             // H: 단위
    "", "", "",                               // I, J, K: 확장용
    journalData.photoUrl || "",               // L: 현장사진
    journalData.note || "",                   // M: 특이사항
    String(chatId),                           // N: 관리자ID
    new Date()                                // O: 최종업데이트
  ]);

  // 2. [지능형 자재 차감] 운영설정의 과수소요량(레시피) 연동 실행
  let deductionLog = "";
  if (journalData.recipeName && journalData.outputQty > 0) {
    // 레시피 기반 다중 차감 (박스, 난좌 등 한꺼번에 차감)
    deductionLog = executeRecipeDeduction(journalData.recipeName, journalData.outputQty);
  } else if (journalData.matName1 && journalData.matQty1 > 0) {
    // 단일 자재 수동 입력 차감
    const success = updateMaterialStock(journalData.matName1, journalData.matQty1);
    deductionLog = success ? `📦 ${journalData.matName1} ${journalData.matQty1}개 차감 완료` : "⚠️ 자재 매칭 실패";
  }

  // 3. [자연어기록] 탭에 작업 흔적 남기기 (AI 학습용)
  logToNaturalLanguage(chatId, "현장일지", `${journalData.siteName}: ${journalData.process} (${deductionLog})`);

  return Telegram.sendMessage(chatId, `✅ <b>현장일지 기록 완료</b>\n━━━━━━━━━━━━━━━\n📍 현장: ${journalData.siteName}\n🔧 작업: ${journalData.process}\n${deductionLog ? "📉 재고: " + deductionLog : ""}`, { parse_mode: "HTML" });
}

/**
 * 🛠️ 레시피 기반 다중 자재 차감 로직
 * 운영설정 시트의 '과수소요량' 값을 파싱함 (예: "박스:1,난좌:2,패드:1")
 */
function executeRecipeDeduction(recipeName, outputQty) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    const opSheet = ss.getSheetByName(CONFIG.SHEETS.OP_CONFIG);
    if (!opSheet) return "⚠️ 운영설정 시트 없음";

    const data = opSheet.getDataRange().getValues();
    let recipeStr = "";
    
    // 1. 해당 품목의 레시피(BOM) 문자열 찾기
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]).trim() === recipeName && String(data[i][0]).includes("과수소요량")) {
        recipeStr = String(data[i][2]).trim();
        break;
      }
    }

    if (!recipeStr) return "레시피 정보 없음";

    // 2. 문자열 파싱 및 자재관리 탭 차감 실행 (박스:1,난좌:2 -> outputQty 만큼 곱함)
    let results = [];
    const items = recipeStr.split(",");
    items.forEach(item => {
      const parts = item.split(":");
      if (parts.length === 2) {
        const matName = parts[0].trim();
        const perQty = Number(parts[1].trim());
        const totalNeed = perQty * outputQty;
        
        if (updateMaterialStock(matName, totalNeed)) {
          results.push(`${matName}-${totalNeed}`);
        }
      }
    });

    return results.length > 0 ? results.join(", ") : "차감 대상 없음";
  } catch (e) { return "레시피 오류"; }
}

/**
 * 📦 자재고 차감 처리 유틸리티
 */
function updateMaterialStock(matName, useQty) {
  const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  const matSheet = ss.getSheetByName(CONFIG.SHEETS.MATERIALS);
  if (!matSheet) return false;

  const data = matSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    // 자재관리 시트의 A열(항목명) 매칭
    if (String(data[i][0]).trim() === String(matName).trim()) {
      const currentQty = Number(data[i][2]) || 0; // C열: 현재고
      const newQty = currentQty - useQty;
      
      matSheet.getRange(i + 1, 3).setValue(newQty); // C열 업데이트
      matSheet.getRange(i + 1, 6).setValue(new Date()); // F열: 최종점검일 업데이트
      return true;
    }
  }
  return false;
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
    const startTime = parseInt(getSystemSetting("업무시작시간")) || 8; 
    
    calendar.createEvent(`[ERP] ${fieldName}`, 
      new Date(targetDate.setHours(startTime, 0, 0)), 
      new Date(targetDate.setHours(startTime + 9, 0, 0)), 
      { description: `작업: ${workDesc}\n인원: ${staffInfo}\n기록자: 2026 Smart Field ERP` }
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
  const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  const logSheet = ss.getSheetByName(CONFIG.SHEETS.LOG);
  if (!logSheet) return "⚠️ 출근부 시트를 찾을 수 없습니다.";

  const todayStr = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd");
  const logData = logSheet.getDataRange().getValues();
  const c = CONFIG.COL;

  let totalIn = 0;
  let siteStats = {}; 
  let totalPay = 0;

  for (let j = 1; j < logData.length; j++) {
    if (!logData[j][0]) continue; // A열 신청일시 기준
    const lDate = (logData[j][0] instanceof Date) ? 
                  Utilities.formatDate(logData[j][0], "GMT+9", "yyyy-MM-dd") : String(logData[j][0]);
    
    if (lDate.includes(todayStr)) {
      totalIn++;
      const siteName = logData[j][4] || "미지정"; // E: 현장
      const status = logData[j][5] || "대기"; // F: 상태
      if (!siteStats[siteName]) siteStats[siteName] = { count: 0, active: 0 };
      siteStats[siteName].count++;
      if (["출근", "작업중", "퇴근완료"].includes(status)) siteStats[siteName].active++;
      totalPay += (Number(logData[j][10]) || 0); // K: 총지급액
    }
  }

  let briefing = `<b>[📅 Smart Field 실시간 상황판]</b>\n기준: ${todayStr}\n\n`;
  briefing += `👷 <b>총 출근 인원: ${totalIn}명</b>\n💰 <b>지급 예정액: ${totalPay.toLocaleString()}원</b>\n━━━━━━━━━━━━━━━\n`;
  
  for (let site in siteStats) {
    briefing += `📍 <b>${site}</b>\n   인원: ${siteStats[site].count}명 (활성: ${siteStats[site].active}명)\n`;
  }
  return briefing + `━━━━━━━━━━━━━━━\n※ 강성묵 과장님 설계 기준 기반 집계`;
}

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
  } catch(e) {}
}

/**
 * 📅 4. 달력 UI 생성 유틸리티
 */
function sendScheduleSummary(chatId, year, month) {
  const targetYear = year || new Date().getFullYear();
  const targetMonth = month || (new Date().getMonth() + 1);
  const calendarKeyboard = createCalendarKeyboard(targetYear, targetMonth);
  
  const msg = `📅 <b>작업 일정 관리 (${targetYear}년 ${targetMonth}월)</b>\n날짜를 선택하여 상세 일정을 조회하세요.`;
  
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