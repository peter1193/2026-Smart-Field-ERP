/**
 * [모듈 07] 07_Expense.gs
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: 현장 지출(경비) 신청, 내역 기록 및 증빙 관리 (오너 승인 연동)
 * 최종 업데이트: 2026-02-24 (오너 권한 필터링 및 자연어기록 연동)
 */

/**
 * 💰 1. 지출 신청 시작
 */
function startExpenseRequest(chatId) {
  const cache = CacheService.getUserCache();
  cache.put("USER_STATUS_" + chatId, "WAITING_EXP_AMOUNT", 600);

  const msg =
    "💰 <b>[지출 신청 1/3]</b>\n\n" +
    "지불하신 <b>금액</b>을 숫자만 입력해 주세요.\n" +
    "(예시: 15000)";

  return Telegram.sendMessage(chatId, msg);
}

/**
 * 💾 2. 지출 단계별 입력 처리
 */
function confirmExpenseInput(chatId, currentStep, text, prevData) {
  const cache = CacheService.getUserCache();

  if (currentStep === "AMOUNT") {
    const amount = text.replace(/[^0-9]/g, "");
    if (!amount) {
      return Telegram.sendMessage(chatId, "⚠️ 숫자만 입력 가능합니다. 다시 입력해 주세요.");
    }
    cache.put("USER_STATUS_" + chatId, "WAITING_EXP_DESC_" + amount, 600);
    return Telegram.sendMessage(chatId,
      `📝 <b>[지출 신청 2/3]</b>\n\n금액: <b>${Number(amount).toLocaleString()}원</b>\n\n사용 용도를 입력해 주세요.`);
  }

  if (currentStep === "DESC") {
    cache.put("USER_STATUS_" + chatId, "WAITING_EXP_PHOTO_" + prevData + "_" + text, 600);
    return Telegram.sendMessage(chatId,
      `📸 <b>[지출 신청 3/3]</b>\n\n용도: <b>${text}</b>\n\n영수증 사진을 전송해 주세요.\n(사진이 없으면 '없음' 입력)`);
  }
}

/**
 * 🗄️ 3. 지출 저장 + 승인 요청 (오너 권한 연동)
 */
function saveExpenseToSheet(chatId, amount, desc, photoUrl) {
  const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEETS.EXPENSE);
  if (!sheet) return;

  const admin = getAdminInfo(chatId);
  const workerName = admin ? (admin.title + " " + admin.name) : "미등록 사용자";

  // 시트 기록
  sheet.appendRow([
    new Date(),
    desc,
    Number(amount),
    photoUrl || "증빙없음",
    "오너대기",
    workerName
  ]);

  // 자연어기록 연동
  logToNaturalLanguage(chatId, "지출신청", `${desc}: ${amount}원`);

  const adminMsg =
    "💸 <b>[지출 승인 요청]</b>\n━━━━━━━━━━━━━━━\n" +
    "👤 <b>청구자:</b> " + workerName + "\n" +
    "💰 <b>금액:</b> " + Number(amount).toLocaleString() + "원\n" +
    "📝 <b>용도:</b> " + desc + "\n━━━━━━━━━━━━━━━\n" +
    "승인하시겠습니까?";

  const buttons = {
    inline_keyboard: [[
      { text: "✅ 승인", callback_data: "exp_auth_ok_" + chatId },
      { text: "❌ 반려", callback_data: "exp_auth_no_" + chatId }
    ]]
  };

  // 13번 모듈 기반 오너 권한자 탐색 및 발송
  const adminSheet = ss.getSheetByName(CONFIG.SHEETS.ADMINS);
  if (!adminSheet) return;

  const adminData = adminSheet.getDataRange().getValues();
  for (let i = 1; i < adminData.length; i++) {
    const targetId = String(adminData[i][2]); // C열: ChatID
    if (!targetId) continue;

    const role = getUserRole(targetId);
    if (role.isOwner || role.isMaster) {
      Telegram.sendMessage(targetId, adminMsg, { reply_markup: buttons });
    }
  }
}

/**
 * 📊 4. 개인 지출 요약
 */
function getExpenseSummary(chatId) {
  const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEETS.EXPENSE);
  if (!sheet) return "⚠️ 시트를 찾을 수 없습니다.";

  const admin = getAdminInfo(chatId);
  if (!admin) return "⚠️ 권한 확인 불가";

  const workerName = admin.title + " " + admin.name;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return "💰 신청 내역이 없습니다.";

  const data = sheet.getRange(1, 1, lastRow, 6).getValues();
  let confirmed = 0, pending = 0;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][5]) === workerName) {
      const amt = Number(data[i][2]);
      if (data[i][4] === "승인완료") confirmed += amt;
      if (data[i][4] === "오너대기") pending += amt;
    }
  }

  return `💰 <b>지출 정산 요약</b>\n━━━━━━━━━━━━━━━\n✅ 승인 완료: <b>${confirmed.toLocaleString()}원</b>\n⏳ 승인 대기: <b>${pending.toLocaleString()}원</b>\n━━━━━━━━━━━━━━━`;
}