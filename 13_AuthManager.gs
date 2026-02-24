/**
 * [모듈 13] 13_AuthManager.gs
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: 권한 식별(마스터/관리자/근로자), 메뉴 라우팅, 시스템 보안 잠금 제어
 * 최종 업데이트: 2026-02-24 (오너-관리자 권한 분리 및 시스템설정 연동 강화)
 */

/**
 * 🔐 1. 사용자 권한 객체 생성 및 식별
 */
function getUserRole(chatId) {
  const cache = CacheService.getScriptCache();
  const idStr = String(chatId).trim();
  const cacheKey = "USER_ROLE_" + idStr;
  const cached = cache.get(cacheKey);

  if (cached) {
    return JSON.parse(cached);
  }

  // 기초 정보 로드 (00_Config.gs의 getAdminInfo 활용)
  const adminInfo = getAdminInfo(idStr);
  const workerInfo = (typeof getWorkerInfoByChatId === 'function')
    ? getWorkerInfoByChatId(idStr)
    : null;

  let role = {
    chatId: idStr,
    isMaster: false,  // 실질적 오너
    isOwner: false,   // 대표 및 임원진
    isAdmin: false,   // 강성묵 과장님 및 중간 관리자
    isWorker: false,
    isRegistered: false,
    title: "",
    name: "미등록",
    lang: "KO",
    settings: {
      stockAlert: "OFF",
      settleAlert: "OFF",
      attendanceAlert: "OFF"
    }
  };

  /**
   * 🔥 1️⃣ [0순위] 프로그램 총괄 관리자 판정 (강성묵 과장님)
   */
  if (idStr === String(CONFIG.ADMIN_ID).trim()) {
    role.isMaster = true;
    role.isOwner = true;
    role.isAdmin = true;
    role.isRegistered = true;
    role.name = "강성묵";
    role.title = "과장";
    role.lang = "KO";

    cache.put(cacheKey, JSON.stringify(role), 300);
    return role;
  }

  /**
   * 🔐 2️⃣ [1순위] 관리자 및 오너 판정 (시트 및 CONFIG 기반)
   */
  if (adminInfo || CONFIG.OWNER_IDS.includes(idStr)) {
    role.isRegistered = true;
    role.isAdmin = true;
    
    if (adminInfo) {
      role.name = adminInfo.name || "관리자";
      role.title = adminInfo.title || "";
      role.isMaster = adminInfo.isMaster || false;
    }

    if (role.isMaster || CONFIG.OWNER_IDS.includes(idStr)) {
      role.isOwner = true;
    }

    cache.put(cacheKey, JSON.stringify(role), 300);
    return role;
  }

  /**
   * 👷 3️⃣ [2순위] 근로자 판정
   */
  if (workerInfo && workerInfo.name && workerInfo.name !== "미등록") {
    role.isRegistered = true;
    role.name = workerInfo.name;
    role.isWorker = true;
    role.lang = (workerInfo.lang || "KO").toUpperCase();

    cache.put(cacheKey, JSON.stringify(role), 300);
    return role;
  }

  cache.put(cacheKey, JSON.stringify(role), 300);
  return role;
}

/**
 * 🛠️ 2. 메뉴 라우팅
 */
function routeMainMenu(chatId) {
  const role = getUserRole(chatId);
  const sysLock = getSystemSetting("SYSTEM_LOCK") || "OPEN";

  if (sysLock === "LOCK" && !role.isOwner && !role.isMaster) {
    return Telegram.sendMessage(
      chatId,
      "🕒 <b>[시스템 보안 모드 가동 중]</b>\n현재 긴급 정기 점검 또는 보안 잠금 상태입니다.\n문의: 관리자(강성묵 과장)",
      { parse_mode: "HTML" }
    );
  }

  if (role.isAdmin || role.isOwner || role.isMaster) {
    return UIHandler.마스터_대시보드_발송(chatId, role);
  } else if (role.isWorker) {
    return UIHandler.근로자_메뉴_발송(chatId, role);
  } else {
    return Telegram.sendMessage(
      chatId,
      "⚠️ <b>미등록 사용자</b>\n시스템 사용 권한이 없습니다. 관리자에게 승인을 요청하세요.",
      { parse_mode: "HTML" }
    );
  }
}

/**
 * 🎛 관리자 스위치
 */
function handleMasterSwitch(chatId, data, callbackId) {
  const role = getUserRole(chatId);
  if (!role.isAdmin && !role.isOwner && !role.isMaster) {
    return Telegram.answerCallbackQuery(callbackId, "⚠️ 권한이 없습니다.");
  }

  if (data === "CONFIRM_TASK") {
    if (typeof PearManager !== "undefined") {
      return PearManager.executeRegistration(chatId, callbackId);
    }
  } else if (data === "CANCEL_TASK") {
    CacheService.getScriptCache().remove("PENDING_TASK_" + String(chatId).trim());
    return Telegram.answerCallbackQuery(callbackId, "❌ 등록이 취소되었습니다.");
  }
}