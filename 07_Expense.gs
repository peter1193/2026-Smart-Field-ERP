/**
 * [모듈 07] 07_Expense.gs
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: 현장 지출(경비) 신청, 내역 기록 및 증빙 관리 (오너 승인 연동)
 * 최종 업데이트: 2026-02-17
 * 수정자: Gemini (강성묵 과장 시스템 설계 기준 준수 - 시트 참조 무결성 및 규격 보정)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🛡️ [강 과장 전용 시스템 운영 매뉴얼: 07번]
 * 1. 신청 프로세스: 금액(숫자) -> 용도(텍스트) -> 증빙(사진) 3단계로 진행됩니다.
 * 2. 승인 시스템: 지출 발생 시 '오너' 권한을 가진 관리자에게 실시간 승인 버튼이 발송됩니다.
 * 3. 성능 최적화: getDataRange()를 배제하고 getLastRow() 기반 가변 범위를 사용하여 병목을 방지합니다.
 * 4. 무결성 유지: getActiveSpreadsheet 대신 openById를 사용하여 웹훅 환경 에러를 차단합니다.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

/**
 * 💰 1. 지출 신청 시작
 */
function startExpenseRequest(chatId) {
  const cache = CacheService.getUserCache();
  // 상태값 저장 (10분 유효)
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

  // A단계: 금액 입력 확인
  if (currentStep === "AMOUNT") {
    const amount = text.replace(/[^0-9]/g, "");
    if (!amount) {
      return Telegram.sendMessage(chatId, "⚠️ 숫자만 입력 가능합니다. 다시 입력해 주세요.");
    }

    cache.put("USER_STATUS_" + chatId, "WAITING_EXP_DESC_" + amount, 600);

    return Telegram.sendMessage(
      chatId,
      "📝 <b>[지출 신청 2/3]</b>\n\n" +
      "금액: <b>" + Number(amount).toLocaleString() + "원</b>\n\n" +
      "어디에 사용하셨나요? <b>사용 용도</b>를 입력해 주세요."
    );
  }

  // B단계: 용도 입력 확인
  if (currentStep === "DESC") {
    cache.put(
      "USER_STATUS_" + chatId,
      "WAITING_EXP_PHOTO_" + prevData + "_" + text,
      600
    );

    return Telegram.sendMessage(
      chatId,
      "📸 <b>[지출 신청 3/3]</b>\n\n" +
      "용도: <b>" + text + "</b>\n\n" +
      "증빙을 위한 <b>영수증 사진</b>을 전송해 주세요.\n(사진이 없으면 '없음'이라고 입력하십시오.)"
    );
  }
}

/**
 * 🗄️ 3. 지출 저장 + 승인 요청 (성능 패치 적용)
 */
function saveExpenseToSheet(chatId, amount, desc, photoUrl) {
  // 🚀 [보정] 웹훅 환경 안정성을 위해 openById로 명시적 호출
  const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEETS.EXPENSE);
  if (!sheet) return;

  const admin = getAdminInfo(chatId);
  const workerName = admin ? (admin.title + " " + admin.name) : "미등록 사용자";

  // 🚀 성능 패치: 단건 기록은 appendRow를 유지
  sheet.appendRow([
    new Date(),
    desc,
    Number(amount),
    photoUrl || "증빙없음",
    "오너대기",
    workerName
  ]);

  const adminMsg =
    "💸 <b>[지출 승인 요청]</b>\n━━━━━━━━━━━━━━━\n" +
    "👤 <b>청구자:</b> " + workerName + "\n" +
    "💰 <b>금액:</b> " + Number(amount).toLocaleString() + "원\n" +
    "📝 <b>용도:</b> " + desc + "\n━━━━━━━━━━━━━━━\n" +
    "위 지출 건에 대해 승인하시겠습니까?";

  // 🚀 규격 보정: 00번 엔진 규격에 맞춘 인라인 버튼 구성
  const buttons = {
    inline_keyboard: [[
      { text: "✅ 승인", callback_data: "exp_auth_ok_" + chatId },
      { text: "❌ 반려", callback_data: "exp_auth_no_" + chatId }
    ]]
  };

  const adminSheet = ss.getSheetByName(CONFIG.SHEETS.ADMINS);
  if (!adminSheet) return;

  const lastRow = adminSheet.getLastRow();
  const adminData = adminSheet.getRange(1, 1, lastRow, 15).getValues();

  for (let i = 1; i < adminData.length; i++) {
    const targetId = String(adminData[i][CONFIG.COL.A_ID]);
    if (!targetId) continue;

    // 권한 확인 (13번 모듈 연동 예정)
    if (typeof getUserRole === "function") {
      const role = getUserRole(targetId);
      // 오너 권한이 있는 관리자에게만 전송
      if (role.isOwner) {
        Telegram.sendMessage(targetId, adminMsg, buttons);
      }
    }
  }
}

/**
 * 📊 4. 개인 지출 요약 (성능 패치 적용)
 */
function getExpenseSummary(chatId) {
  // 🚀 [보정] openById로 교체
  const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEETS.EXPENSE);
  if (!sheet) return "⚠️ [오류] 지출 내역 시트를 찾을 수 없습니다.";

  const admin = getAdminInfo(chatId);
  if (!admin) return "⚠️ [오류] 사용자 권한을 확인할 수 없습니다.";

  const workerName = admin.title + " " + admin.name;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return "💰 <b>지출 정산 요약</b>\n━━━━━━━━━━━━━━━\n신청 내역이 없습니다.";

  const data = sheet.getRange(1, 1, lastRow, 6).getValues();

  let totalConfirmed = 0;
  let totalPending = 0;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][5]) === workerName) {
      const amount = Number(data[i][2]);
      const status = String(data[i][4]);

      if (status === "승인완료") totalConfirmed += amount;
      if (status === "오너대기") totalPending += amount;
    }
  }

  return (
    "💰 <b>지출 정산 요약</b>\n━━━━━━━━━━━━━━━\n" +
    "✅ 승인 완료: <b>" + totalConfirmed.toLocaleString() + "원</b>\n" +
    "⏳ 승인 대기: <b>" + totalPending.toLocaleString() + "원</b>\n━━━━━━━━━━━━━━━"
  );
}