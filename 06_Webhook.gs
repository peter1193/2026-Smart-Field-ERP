/**
 * [모듈 06] 06_Webhook.gs
 * 프로젝트: 2026 Smart Field ERP (통합 관제탑)
 * 역할: 웹훅 설정 관리 및 헬스체크 (doPost는 19번으로 통합 이전됨)
 * 최종 업데이트: 2026-02-22
 */

/**
 * 🔗 웹훅 단일 설정 (동적 URL 참조 방식)
 */
function 웹훅_단일설정() {
  // CONFIG 의존성을 제거하고 현재 프로젝트의 실제 배포 URL을 직접 가져옴
  const url = ScriptApp.getService().getUrl();
  Logger.log("📡 실시간 배포 URL 탐색: " + url);

  if (!url || !url.includes("/exec")) {
    Logger.log("❌ 배포된 웹앱 주소가 아닙니다. [배포 -> 새 배포]를 먼저 진행하세요.");
    return;
  }

  const result = Telegram.call('setWebhook', {
    url: url,
    drop_pending_updates: true
  });
  
  Logger.log("🔗 웹훅 설정 결과: " + JSON.stringify(result));
}

/**
 * 🌍 GET 요청 확인용 (헬스체크)
 */
function doGet() {
  return ContentService
    .createTextOutput("2026 Smart Field ERP Webhook Server Active")
    .setMimeType(ContentService.MimeType.TEXT);
}

/**
 * 🧹 캐시 초기화
 */
function 캐시초기화() {
  CacheService.getScriptCache().remove("SETTING_WEBHOOK_URL");
  Logger.log("캐시 삭제 완료");
}

/**
 * 📱 연락처 공유 처리 핸들러 (19번 doPost에서 호출)
 */
function handleContactInput(chatId, contact) {
  Logger.log("📞 연락처 수신 처리 시작: " + chatId);
  
  const phoneNumber = contact.phone_number;
  const firstName = contact.first_name;
  
  // 인증 로직이나 직원 명부 매칭 로직으로 확장 가능
  Telegram.sendMessage(chatId, `✅ 연락처(${firstName}) 확인 완료.\n번호: ${phoneNumber}`);
}