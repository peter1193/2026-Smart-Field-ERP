/**
 * [모듈 99] 99_SystemMasterTool.gs
 * 프로젝트: 2026 Smart Field ERP (관리자 전용 안전 최적화 도구)
 * 역할: 
 * 1. UI 충돌 방지를 위해 확인 창 제거 및 즉시 실행 구조 채택
 * 2. 전수 검사 기반 유령 행 안전 정리 (데이터 보존 우선)
 * 3. ERP 전용 보호구역 선별적 재설정 및 시각적 가이드 적용
 */

/** 🚀 실행 함수 (메뉴 클릭 시 즉시 가동) */
function system_runMasterOptimization() {
  const ui = SpreadsheetApp.getUi();

  try {
    // 1단계: 유령 행 정리 (모든 열 검사 후 여유분 제외 삭제)
    cleanGhostRows_Safe();  
    
    // 2단계: ERP 시스템 보호 구역 잠금 및 회색 채색
    applyProtection_Safe(); 
    
    // 최종 결과 보고 (매개변수 충돌 방지를 위해 단일 문자열만 사용)
    ui.alert("✅ 최적화 및 보호 재설정이 완료되었습니다.");
  } catch (e) {
    ui.alert("❌ 오류 발생: " + e.toString());
  }
}

/** 1️⃣ 전수 검사 기반 유령 행 정리 엔진 */
function cleanGhostRows_Safe() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  
  sheets.forEach(sheet => {
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    const maxRows = sheet.getMaxRows();
    let lastDataRow = 0;

    // 모든 열을 역순으로 전수 검사하여 실제 데이터가 있는 마지막 행 탐색
    for (let r = values.length - 1; r >= 0; r--) {
      if (values[r].some(cell => cell !== "" && cell !== null && String(cell).trim() !== "")) {
        lastDataRow = r + 1;
        break;
      }
    }
    
    if (lastDataRow === 0) lastDataRow = 1;
    const buffer = 10; // 데이터 보호를 위한 하단 여유 행 확보

    if (maxRows > lastDataRow + buffer) {
      // 실제 데이터 영역 + 버퍼 이후의 모든 행을 삭제하여 속도 최적화
      sheet.deleteRows(lastDataRow + buffer + 1, maxRows - (lastDataRow + buffer));
    }
  });
}

/** 2️⃣ ERP 전용 보호구역 재설정 엔진 */
function applyProtection_Safe() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const COLOR = { LOCKED: "#f3f3f3", TEXT: "#999999" };
  const LOCK_DESC = "ERP_SYSTEM_LOCK"; // 시스템 자동 설정 보호 전용 마커
  
  // 시트별 보호가 필요한 핵심 시스템 범위 정의
  const lockConfig = {
    "지급일정관리": ["A:A", "G:I"], 
    "외부인력정산": ["A:A", "J:L"], 
    "파견인력매출": ["A:A", "F:G", "H:H", "J:J"]
  };

  for (let sheetName in lockConfig) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) continue;

    // 기존에 "ERP_SYSTEM_LOCK" 표식이 있는 보호만 선별 제거 (수동 설정 보호는 유지)
    const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
    protections.forEach(p => {
      if (p.getDescription() === LOCK_DESC) p.remove();
    });

    lockConfig[sheetName].forEach(rangeStr => {
      const range = sheet.getRange(rangeStr);
      
      // 시스템 구역 시각적 인지성 부여 (회색 배경)
      range.setBackground(COLOR.LOCKED).setFontColor(COLOR.TEXT);
      
      // 물리적 잠금 설정 (마스터 외 편집 권한 차단)
      const protection = range.protect().setDescription(LOCK_DESC);
      protection.removeEditors(protection.getEditors());
      if (protection.canDomainEdit()) protection.setDomainEdit(false);
    });
  }
}