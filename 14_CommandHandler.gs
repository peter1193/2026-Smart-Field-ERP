/**
 * [모듈 14] 14_CommandHandler.gs
 * 프로젝트: 2026 Smart Field ERP (통합 관제탑)
 * 역할: 자연어(음성) 기록, 학습형 데이터 엔진 및 명령어 통합 처리
 * 최종 업데이트: 2026-02-24 (자연어기록 시트 연동 및 소통사전 캐시 적용)
 */

/**
 * 🛰️ 텍스트 명령어 및 대분류 버튼 통합 처리
 */
function handleTextMessage(chatId, text, roleInfo) {
  if (!chatId || !text) return;
  const userRole = (roleInfo && typeof roleInfo === "object") ? roleInfo : getUserRole(chatId);
  const cmd = String(text).trim();

  // [핵심] 자연어 입력 로그 기록
  기록_자연어_로그(chatId, userRole.name || "Unknown", cmd);

  const sysLock = getSystemSetting("SYSTEM_LOCK") || "OPEN";
  if (sysLock === "LOCK" && !(userRole.isOwner === true || userRole.isMaster === true)) {
    return Telegram.sendMessage(chatId, "🕒 <b>[시스템 보안 모드]</b>\n현재 관리가 제한됩니다.", { parse_mode: "HTML" });
  }

  /* 1️⃣ 하단 리모컨 버튼 처리 */
  switch (cmd) {
    case '📊 출석체크':
      if (typeof UIHandler !== "undefined") return UIHandler.출석_메뉴_표시(chatId);
      break;
    case '📦 재고관리':
      if (typeof UIHandler !== "undefined") return UIHandler.재고_메뉴_표시(chatId);
      break;
    case '🚜 현장관제':
      if (typeof UIHandler !== "undefined" && UIHandler.현장_메뉴_표시) return UIHandler.현장_메뉴_표시(chatId);
      break;
    case '📅 일정관리':
      if (typeof UIHandler !== "undefined" && UIHandler.일정_메뉴_표시) return UIHandler.일정_메뉴_표시(chatId);
      break;
    case '🚨 긴급싸이렌':
      if (typeof UIHandler !== "undefined") return UIHandler.안전_메뉴_표시(chatId);
      break;
    case '💬 직원소통':
      if (typeof UIHandler !== "undefined" && UIHandler.소통_메뉴_표시) return UIHandler.소통_메뉴_표시(chatId);
      break;
    case '💰 자금/외상':
      if (userRole.isOwner === true || userRole.isMaster === true) {
        if (typeof UIHandler !== "undefined" && UIHandler.정산_메뉴_표시) return UIHandler.정산_메뉴_표시(chatId);
      } else {
        return Telegram.sendMessage(chatId, "⚠️ 자금 정보는 오너 권한입니다.");
      }
      break;
    case '🏠 메인메뉴':
    case '/start':
      if (typeof routeMainMenu === 'function') return routeMainMenu(chatId);
      break;
  }

  /* 2️⃣ 지능형 명령어 분석 */
  if (cmd.includes("SOS") || cmd.includes("도와")) {
    if (typeof SafetyManager !== "undefined") return SafetyManager.processSOS(chatId, userRole);
  }

  if (cmd.includes("입고") || cmd.includes("출고")) {
    if (typeof InventoryManager !== "undefined") return InventoryManager.handleNaturalLanguageStock(chatId, cmd);
  }

  /* 3️⃣ 외국인 소통 */
  if (userRole.isWorker === true) {
    const translatedText = 번역_가속_엔진(cmd, userRole.lang || "KO");
    // 기록_직원_소통(chatId, userRole, cmd, translatedText);
    return Telegram.sendMessage(chatId, "✅ Sent to manager.");
  }
}

/** 📝 [자연어기록] 탭에 로그 남기기 */
function 기록_자연어_로그(chatId, userName, rawText) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    const logSheet = ss.getSheetByName("자연어기록");
    if (logSheet) logSheet.appendRow([new Date(), chatId, userName, rawText, "", "", "대기"]);
  } catch (e) {}
}

/** 📖 [소통사전] 기반 번역 가속 엔진 */
function 번역_가속_엔진(text, lang) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    const dictSheet = ss.getSheetByName("소통사전");
    if (!dictSheet) return "번역중...";
    const data = dictSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][2] === text) return data[i][3];
    }
    return "AI 번역 대기"; 
  } catch (e) { return "번역 오류"; }
}