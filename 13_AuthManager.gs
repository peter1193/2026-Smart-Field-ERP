/**
 * [모듈 13] 13_AuthManager.gs
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: 사용자 권한 식별(마스터/오너/관리자/근로자), 메뉴 라우팅, 시스템 보안 잠금 제어
 * 최종 업데이트: 2026-02-19
 */

/**
 * 🔐 1. 사용자 권한 객체 생성 및 식별
 * 마스터 강제 판정 후, 시트 데이터 및 CONFIG 리스트를 기반으로 권한을 할당합니다.
 */
function getUserRole(chatId) {

  const cache = CacheService.getScriptCache();
  const idStr = String(chatId).trim(); // 타입 무결성을 위해 문자열 강제 변환
  const cacheKey = "USER_ROLE_" + idStr;
  const cached = cache.get(cacheKey);

  if (cached) {
    return JSON.parse(cached);
  }

  // 기초 정보 로드
  const adminInfo = getAdminInfo(idStr);
  const workerInfo = (typeof getWorkerInfoByChatId === 'function')
    ? getWorkerInfoByChatId(idStr)
    : { name: "미등록" };

  // 기본 권한 객체 (초기값: 미등록)
  let role = {
    chatId: idStr,
    isMaster: false,
    isOwner: false,
    isAdmin: false,
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
   * 🔥 1️⃣ [0순위] 시스템 마스터 판정 (강성묵 과장 전용)
   * 시트 조회 실패 시에도 관리 기능을 유지하기 위한 긴급 통로입니다.
   */
  if (idStr === String(CONFIG.ADMIN_ID).trim()) {

    role.isMaster = true;
    role.isOwner = true;
    role.isAdmin = true;
    role.isWorker = false;
    role.isRegistered = true;
    role.name = "강성묵 과장(Master)";
    role.title = "프로그램 관리자";
    role.lang = "KO";

    cache.put(cacheKey, JSON.stringify(role), 300);
    return role;
  }

  /**
   * 🔐 2️⃣ [1순위] 관리자 및 오너 판정 (시트 및 CONFIG 기반)
   * 관리자 명단에 존재하거나, CONFIG.OWNER_IDS에 포함된 경우를 모두 포함합니다.
   */
  if (adminInfo || CONFIG.OWNER_IDS.includes(idStr)) {

    role.isRegistered = true;
    role.isAdmin = true;
    
    // 시트 데이터가 있는 경우 우선 적용
    if (adminInfo) {
      role.name = adminInfo.name || "관리자";
      role.title = adminInfo.title || "";
      role.settings.stockAlert = adminInfo.stockAlert ? "ON" : "OFF";
      role.settings.settleAlert = adminInfo.payAlert ? "ON" : "OFF";
      role.settings.attendanceAlert = adminInfo.attendAlert ? "ON" : "OFF";
    }

    // 오너 권한 판별 (직함 키워드 혹은 OWNER_IDS 리스트 매칭)
    const ownerTitles = ["대표", "오너", "이사", "본부장", "상무"];
    const hasOwnerTitle = role.title && ownerTitles.some(t => role.title.includes(t));
    const isOwnerId = CONFIG.OWNER_IDS.includes(idStr);

    if (hasOwnerTitle || isOwnerId) {
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

  /**
   * ❌ 4️⃣ [3순위] 미등록 사용자 처리
   */
  cache.put(cacheKey, JSON.stringify(role), 300);
  return role;
}


/**
 * 🛠️ 2. 메뉴 라우팅
 * 사용자의 권한과 시스템 잠금 상태에 따라 메뉴를 분기합니다.
 */
function routeMainMenu(chatId) {

  const role = getUserRole(chatId);

  // 시스템 설정에서 LOCK 상태 확인
  const settingSheet = SpreadsheetApp
    .openById(CONFIG.SS_ID)
    .getSheetByName(CONFIG.SHEETS.SYSTEM);

  const sysLock = settingSheet
    ? settingSheet.getRange("B8").getValue()
    : "OPEN";

  // 보안 모드 활성화 시 오너/마스터 외 접근 차단
  if (sysLock === "LOCK" && !role.isOwner && !role.isMaster) {

    return Telegram.sendMessage(
      chatId,
      "🕒 <b>시스템 보안 모드 가동 중입니다.</b>\n현재 관리자 외 접근이 제한되어 있습니다."
    );
  }

  // 권한별 메뉴 발송
  if (role.isOwner || role.isMaster || role.isAdmin) {
    return UIHandler.마스터_대시보드_발송(chatId, role);

  } else if (role.isWorker) {
    return UIHandler.근로자_메뉴_발송(chatId, role);

  } else {
    // 완전 미등록자용 메인 리모컨
    return Telegram.sendMessage(
      chatId,
      "✅ <b>시스템 연결 완료</b>",
      UIHandler.메인_리모컨_구성()
    );
  }
}


/**
 * 🎛 관리자 스위치
 * 콜백 버튼을 통한 관리자 전용 작업을 처리합니다.
 */
function handleMasterSwitch(chatId, data, callbackId) {

  const role = getUserRole(chatId);

  // 마스터/오너 권한 없을 경우 차단
  if (!role.isOwner && !role.isMaster) {
    return;
  }

  if (data === "CONFIRM_TASK") {
    return PearManager.executeRegistration(chatId, callbackId);

  } else if (data === "CANCEL_TASK") {
    CacheService.getScriptCache().remove("PENDING_TASK_" + String(chatId).trim());

    return Telegram.answerCallbackQuery(
      callbackId,
      "❌ 등록 취소"
    );
  }
}