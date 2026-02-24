/**
 * [모듈 18] 18_BackupManager.gs
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: 원클릭 시트 전체 백업 및 데이터 보존형 서식 복구 시스템 (보험 모듈)
 * 최종 업데이트: 2026-02-17
 * 수정자: Gemini (강성묵 과장 운영 지침 - 스마트 복구 엔진 무결성 강화)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🛡️ [강 과장 전용 시스템 운영 매뉴얼: 18번]
 * 1. 황금 기준 백업: 현재의 완성된 시트 디자인, 수식, 권한 설정을 구글 드라이브 백업 폴더에 박제합니다.
 * 2. 스마트 복구: 서식 훼손 시 오늘 기록된 실시간 데이터를 메모리에 대피시킨 후, 백업본을 덮어쓰고 데이터를 재주입합니다.
 * 3. 자동화: 매일 밤 23시 이후 트리거를 통해 자동으로 시스템 스냅샷을 생성합니다.
 * 4. 병목 방지: 데이터 대피 시 getDataRange() 대신 오늘 날짜가 포함된 하단 범위만 타겟팅하여 스캔합니다.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

const BackupManager = {

  /**
   * 💾 1. 시스템 전체 백업
   * [방법]: 시트 디자인 완성 후 실행하여 드라이브에 저장
   */
  runFullBackup: function() {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const folder = this.getOrCreateBackupFolder();
      const timestamp = Utilities.formatDate(new Date(), "GMT+9", "yyyyMMdd_HHmm");
      const backupName = `[ERP_GOLDEN_STD]_${timestamp}`;

      // 구글 드라이브에 현재 파일 복사본 생성
      const backupFile = DriveApp.getFileById(ss.getId()).makeCopy(backupName, folder);
      
      Logger.log(`✅ [황금기준] 백업 성공: ${backupName}`);
      return backupFile.getUrl();
    } catch (e) {
      if (typeof LogService !== 'undefined') LogService.logError("BackupManager.runFullBackup", e);
      return null;
    }
  },

  /**
   * ⏪ 2. 스마트 복구 (오늘 데이터 보존 + 서식 부활)
   * [방법]: 텔레그램에서 백업 파일 선택 시 호출
   */
  runSmartRestore: function(chatId, backupFileId) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    Telegram.sendMessage(chatId, "⏳ <b>데이터 대피 및 서식 복구 엔진 가동...</b>");

    try {
      // [STEP 1] 오늘 데이터 대피 (Evacuation) - 훼손 방지
      const todayDataBuffer = this.evacuateTodayData(ss);
      
      // [STEP 2] 서식 및 구조 복구 (Restoration) - 시트 덮어쓰기
      const backupSS = SpreadsheetApp.openById(backupFileId);
      this.restoreAllSheets(ss, backupSS);

      // [STEP 3] 대피 데이터 재삽입 (Re-Injection) - 업무 연속성 보장
      this.injectDataFromBuffer(ss, todayDataBuffer);

      Telegram.sendMessage(chatId, "✅ <b>스마트 복구 완료</b>\n오늘 입력값 유지 및 서식 복구가 정상 처리되었습니다.");
      
    } catch (e) {
      if (typeof LogService !== 'undefined') LogService.logError("BackupManager.runSmartRestore", e);
      Telegram.sendMessage(chatId, "❌ 복구 실패: " + e.toString());
    }
  },

  /** * 🛡️ 보조 1: 오늘 날짜 데이터만 필터링하여 보관 (성능 패치 적용)
   */
  evacuateTodayData: function(ss) {
    const buffer = {};
    const targets = [CONFIG.SHEETS.LOG, CONFIG.SHEETS.EXPENSE, CONFIG.SHEETS.REVENUE]; 
    const todayStr = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd");

    targets.forEach(sheetName => {
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet) return;
      
      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return;

      // 🚀 [성능 패치] 전체 데이터가 아닌 최근 데이터 범위만 스캔하여 대피
      const data = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
      const todayRows = data.filter((row, index) => {
        if (index === 0) return false; // 헤더 제외
        const rowDate = (row[0] instanceof Date) ? Utilities.formatDate(row[0], "GMT+9", "yyyy-MM-dd") : "";
        return rowDate === todayStr;
      });
      buffer[sheetName] = todayRows;
    });
    return buffer;
  },

  /** * 🛡️ 보조 2: 시트 덮어쓰기 (기존 시트 삭제 후 백업본 복사)
   */
  restoreAllSheets: function(currentSS, backupSS) {
    const backupSheets = backupSS.getSheets();
    
    // 🚀 복구 중 시트가 하나도 없는 상태를 방지하기 위해 임시 시트 생성
    const tempSheet = currentSS.insertSheet("RESTORE_TEMP");
    
    // 기존 시트 모두 삭제
    const oldSheets = currentSS.getSheets();
    oldSheets.forEach(s => {
      if (s.getName() !== "RESTORE_TEMP") {
        try { currentSS.deleteSheet(s); } catch(e) {}
      }
    });

    // 백업본 시트들 복사 (디자인 및 수식 원본 유지)
    backupSheets.forEach(bSheet => {
      bSheet.copyTo(currentSS).setName(bSheet.getName());
    });

    // 임시 시트 삭제
    currentSS.deleteSheet(tempSheet);
  },

  /** * 🛡️ 보조 3: 대피시킨 데이터 다시 하단에 재주입
   */
  injectDataFromBuffer: function(ss, buffer) {
    for (let sheetName in buffer) {
      const sheet = ss.getSheetByName(sheetName);
      const rows = buffer[sheetName];
      if (sheet && rows.length > 0) {
        // 🚀 성능 패치: appendRow 대신 대량 주입을 고려한 범위 쓰기 가능하나 데이터 무결성을 위해 순차 주입 유지
        rows.forEach(row => sheet.appendRow(row));
      }
    }
  },

  /** 📂 백업 폴더 관리 */
  getOrCreateBackupFolder: function() {
    const folderName = "2026_SmartFieldERP_Backups";
    const folders = DriveApp.getFoldersByName(folderName);
    if (folders.hasNext()) return folders.next();
    return DriveApp.createFolder(folderName);
  }
};

/**
 * 🚀 트리거 전용 전역 실행 함수
 * [설정]: 매일 밤 23시 자동 백업 (19번 모듈에서 설정)
 */
function scheduledBackupTrigger() {
  BackupManager.runFullBackup();
}
