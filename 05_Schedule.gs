/**
 * [모듈 05] 05_Schedule.gs
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: 작업 일정 관리 및 시스템 자동화 스케줄러 (17:30 자동 퇴근 처리)
 * 최종 업데이트: 2026-02-16
 */

/**
 * 📅 1. 일정 요약 브리핑 전송
 */
function sendScheduleSummary(chatId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.SCHEDULE);
    
    if (!sheet) return Telegram.sendMessage(chatId, "⚠️ '작업일정' 시트를 찾을 수 없습니다.");

    const data = sheet.getDataRange().getValues();
    const now = new Date();
    const todayStr = Utilities.formatDate(now, "GMT+9", "yyyy-MM-dd");
    
    let summary = `📅 <b>[오늘의 작업 일정]</b> (${todayStr})\n━━━━━━━━━━━━━━━\n`;
    let found = false;

    for (let i = 1; i < data.length; i++) {
      const rawDate = data[i][0];
      if (!rawDate) continue;
      const rowDate = (rawDate instanceof Date) 
        ? Utilities.formatDate(rawDate, "GMT+9", "yyyy-MM-dd") 
        : String(rawDate);
      
      if (rowDate === todayStr) {
        summary += `📍 <b>${data[i][1]}</b> (현장)\n📝 업무: ${data[i][2]}\n👥 예상인원: ${data[i][3]}명\n\n`;
        found = true;
      }
    }

    if (!found) {
      summary += "➖ 오늘 예정된 현장 작업 일정이 없습니다.\n일정 등록이 필요하시면 아래 버튼을 누르세요.\n";
    }

    const role = getUserRole(chatId);
    let buttons = [];

    if (role.isOwner || role.isMaster || role.isAdmin) {
      buttons.push([{ text: "➕ 새 일정 등록하기", callback_data: "sch_add_new" }]);
    }
    buttons.push([{ text: "🏠 메인메뉴", callback_data: "go_main" }]);

    return Telegram.sendMessage(chatId, summary, { 
      inline_keyboard: buttons 
    });

  } catch (e) {
    return Telegram.sendMessage(chatId, "❌ 일정 조회 중 오류가 발생했습니다.");
  }
}

/**
 * 📝 2. 일정 등록 프로세스 시작
 */
function startScheduleRegistration(chatId) {
  const cache = CacheService.getUserCache();
  cache.put("USER_STATUS_" + chatId, "WAITING_SCH_DATE", 600);
  const msg = `📅 <b>[일정 등록 - 1단계]</b>\n\n작업 <b>날짜</b>를 입력해 주세요.\n(예: 2026-02-15 또는 '내일')`;
  return Telegram.sendMessage(chatId, msg);
}

/**
 * 💾 3. 일정 단계별 입력 처리
 */
function confirmScheduleInput(chatId, currentStep, text, prevData = "") {
  const cache = CacheService.getUserCache();
  
  if (currentStep === "DATE") {
    let dateInput = text;
    if (text === "내일") {
      const d = new Date(); 
      d.setDate(d.getDate() + 1);
      dateInput = Utilities.formatDate(d, "GMT+9", "yyyy-MM-dd");
    }
    cache.put("USER_STATUS_" + chatId, `WAITING_SCH_SITE_${dateInput}`, 600);
    return Telegram.sendMessage(chatId, 
      `📍 <b>[일정 등록 - 2단계]</b>\n\n날짜: <b>${dateInput}</b>\n\n등록할 <b>현장명</b>을 입력해 주세요.`);
  } 
  else if (currentStep === "SITE") {
    cache.put("USER_STATUS_" + chatId, `WAITING_SCH_MEMO_${prevData}_${text}`, 600);
    return Telegram.sendMessage(chatId, 
      `📝 <b>[일정 등록 - 3단계]</b>\n\n현장: <b>${text}</b>\n\n<b>작업 내용</b>과 <b>인원</b>을 입력해 주세요.\n(예: 비료 작업 / 3명)`);
  } 
  else if (currentStep === "MEMO") {
    const parts = prevData.split("_");
    saveScheduleToSheet(parts[0], parts[1], text);
    cache.remove("USER_STATUS_" + chatId);
    Telegram.sendMessage(chatId, "✅ <b>작업 일정이 데이터베이스에 저장되었습니다.</b>");
    return sendScheduleSummary(chatId);
  }
}

/**
 * 🗄️ 4. 시트 저장
 */
function saveScheduleToSheet(date, site, memo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.SCHEDULE);
  if (!sheet) return;

  const memberMatch = memo.match(/(\d+)명/);
  const memberCount = memberMatch ? memberMatch[1] : "미정";
  
  sheet.appendRow([date, site, memo, memberCount, new Date()]);
}

/**
 * ⏰ 5. 17:30 전원 자동 퇴근 처리
 */
function executeEveningClosing() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const attendSheet = ss.getSheetByName(CONFIG.SHEETS.LOG); 
  if (!attendSheet) return;

  const data = attendSheet.getDataRange().getValues();
  const todayStr = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd");
  let closeCount = 0;
  const c = CONFIG.COL;

  for (let i = 1; i < data.length; i++) {
    const rawDate = data[i][c.L_DATE];
    const applyDate = rawDate instanceof Date 
      ? Utilities.formatDate(rawDate, "GMT+9", "yyyy-MM-dd") 
      : "";
    const status = data[i][c.L_STATUS];

    if (applyDate === todayStr && status === "출근") {
      attendSheet.getRange(i + 1, c.L_STATUS + 1).setValue("퇴근완료"); 
      attendSheet.getRange(i + 1, 17).setValue("17:30 시스템 자동 마감"); 
      attendSheet.getRange(i + 1, 16).setValue("System_Auto");
      closeCount++;
    }
  }

  const reportMsg = `🕒 <b>[퇴근 마감 보고]</b>\n━━━━━━━━━━━━━━━\n` +
                    `✅ 17:30 전원 퇴근 처리 완료 (${closeCount}명)\n` +
                    `🔓 <b>상황판은 정산 업무를 위해 가동 상태를 유지합니다.</b>`;
  
  Telegram.sendMessage(CONFIG.ADMIN_ID, reportMsg);
}

/**
 * 🕒 6. 보안 LOCK 가동
 */
function manualLockFromMonitor() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settingSheet = ss.getSheetByName(CONFIG.SHEETS.SYSTEM);
  if (settingSheet) settingSheet.getRange("B8").setValue("LOCK");
  
  const alertMsg = "🚨 <b>[사무실 상황판 보안 잠금]</b>\n\n지시에 따라 시계 모드가 가동되었습니다.\n해제는 마스터 텔레그램에서만 가능합니다.";
  Telegram.sendMessage(CONFIG.ADMIN_ID, alertMsg);
}
