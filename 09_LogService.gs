/**
 * [모듈 09] 09_LogService.gs
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: 시스템 로그 기록, 자연어 소통 기록 및 마스터 에러 리포팅 (시스템 블랙박스)
 * 최종 업데이트: 2026-02-16
 * 수정자: Gemini (강성묵 과장 로그 관리 방침 반영 및 트리거 최적화)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🛡️ [강 과장 전용 시스템 운영 매뉴얼: 09번]
 * 1. 통신 기록 (logMessage): 텔레그램 원본 데이터를 기록하며 15일간 보관합니다.
 * 2. 에러 리포팅 (logError): 치명적 오류 발생 시 즉시 과장님께 리포트를 발송합니다.
 * 3. 자동 청소: 매일 새벽 트리거를 통해 노후 데이터를 자동 삭제합니다.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

const LogService = {
  
  /**
   * 📝 1. 모든 메시지 수신 내역 기록
   */
  logMessage: function(chatId, type, content) {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(CONFIG.SHEETS.MSG_LOG);
      if (!sheet) return;

      const now = new Date();
      // content가 객체일 경우 JSON 문자열로 변환 (설계 기준 준수)
      const logContent = (typeof content === 'object') ? JSON.stringify(content) : String(content);
      
      sheet.appendRow([
        now,                             // A: 일시
        String(chatId),                  // B: ID
        type,                            // C: 유형
        logContent.substring(0, 5000)    // D: 내용 (셀 용량 초과 방지)
      ]);
    } catch (e) {
      console.error("Logging Error: " + e.toString());
    }
  },

  /**
   * 🧠 2. 직원소통 및 자연어 분석 결과 기록
   */
  logNLP: function(chatId, text, translation, reply = "대기중", status = "처리중") {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(CONFIG.SHEETS.NLP_LOG);
      if (!sheet) return;

      sheet.appendRow([
        new Date(),       // A: 일시
        String(chatId),   // B: ID
        text,             // C: 원문
        translation,      // D: 번역
        reply,            // E: 관리자답변
        status            // F: 처리상태
      ]);
    } catch (e) {
      console.error("NLP Logging Error: " + e.toString());
    }
  },

  /**
   * 🚨 3. 시스템 에러 리포팅 (마스터 관리자 즉시 보고)
   */
  logError: function(context, error) {
    const errorMsg = `⚠️ <b>[시스템 에러 발생]</b>\n━━━━━━━━━━━━━━━\n📍 <b>위치:</b> ${context}\n❌ <b>내용:</b> ${error.toString()}\n━━━━━━━━━━━━━━━\n📢 프로그램 관리자님의 조치가 필요합니다.`;
    
    console.error(`[ERP_ERROR] ${context}: ${error.toString()}`);
    
    try {
      if (typeof Telegram !== 'undefined' && CONFIG.ADMIN_ID) {
        // 🚀 교정: 00번 모듈의 통신 규격에 맞춰 메시지 발송
        Telegram.sendMessage(CONFIG.ADMIN_ID, errorMsg);
      }
    } catch (e) {
      console.error("Telegram Notification Fail: " + e.toString());
    }
    
    this.logMessage(CONFIG.ADMIN_ID, "CRITICAL_ERROR", {
      context: context,
      error: error.toString(),
      timestamp: new Date().toISOString()
    });
  },

  /**
   * 🧹 4. 오래된 로그 자동 청소 (강 과장 지침 준수)
   * 보관 기간: 메시지기록 15일 / 직원소통 30일
   */
  autoCleanupLogs: function() {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const now = new Date();
      
      const cleanupTarget = [
        { name: CONFIG.SHEETS.MSG_LOG, days: 15 },
        { name: CONFIG.SHEETS.NLP_LOG, days: 30 }
      ];

      cleanupTarget.forEach(target => {
        const sheet = ss.getSheetByName(target.name);
        if (!sheet) return;

        const data = sheet.getDataRange().getValues();
        let deleteCount = 0;

        // 🚀 역순(Bottom-up) 삭제 처리로 인덱스 꼬임 방지
        for (let i = data.length - 1; i >= 1; i--) {
          const logDate = new Date(data[i][0]);
          if (isNaN(logDate.getTime())) continue;

          const diffDays = (now.getTime() - logDate.getTime()) / (1000 * 60 * 60 * 24);

          if (diffDays > target.days) {
            sheet.deleteRow(i + 1);
            deleteCount++;
          }
        }
        
        if (deleteCount > 0) {
          this.logMessage(CONFIG.ADMIN_ID, "LOG_CLEANUP", `${target.name} 시트 데이터 ${deleteCount}건 자동 정리 완료.`);
        }
      });
    } catch (e) {
      this.logError("LogService.autoCleanupLogs", e);
    }
  }
};

/**
 * 🚀 트리거 실행용 전역 함수
 */
function runAutoCleanup() {
  LogService.autoCleanupLogs();
}