/**
 * [모듈 11] 11_Settle.gs
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: 노무비 집계, 보너스/공제 반영 및 최종 정산장부 기록 (정산 엔진)
 * 최종 업데이트: 2026-02-16
 * 수정자: Gemini (강성묵 과장 시스템 설계 기준 준수 - 영어 완전 배제 및 오너 승인 강화)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🛡️ [강 과장 전용 시스템 운영 매뉴얼: 11번]
 * 1. 영어 0% 정책: 모든 주석 및 내부 시스템 용어(Settlement -> 정산)를 한국어로 통일합니다.
 * 2. 단가 스냅샷: 정산 확정 시점의 단가를 값으로 기록하여 과거 데이터의 무결성을 보장합니다.
 * 3. 오너 승인 연동: 정산 확정 시 오너(사장님)에게 즉시 승인 요청 알림이 발송됩니다.
 * 4. 규격 준수: 모든 인라인 버튼 응답에 콜백 ID 처리를 포함하여 시스템 지연을 방지합니다.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

/**
 * 💰 1. 현장별 정산 프로세스 개시
 */
function startSiteSettlement(chatId, siteName) {
  if (typeof Settlement !== 'undefined' && Settlement.prepareFinalCheck) {
    Settlement.prepareFinalCheck(chatId, siteName);
  } else {
    Telegram.sendMessage(chatId, "⚠️ [오류] 정산 모듈의 연결 상태를 확인해 주세요.");
  }
}

/**
 * ➕ 2. 보너스 및 공제 항목 추가 처리 (캐시 우선 로직)
 */
function handleSettleAdjustment(chatId, data, callbackId) {
  const cache = CacheService.getUserCache();
  const raw = cache.get("SETTLE_DATA_" + chatId);
  
  if (!raw) {
    return Telegram.answerCallbackQuery(callbackId, "⚠️ 세션이 만료되었습니다. 다시 시작해 주세요.");
  }

  let sData = JSON.parse(raw);
  const parts = data.split("_"); 
  const action = parts[1]; // add(추가) 또는 sub(차감)
  const amount = parseInt(parts[2]);

  // 🚀 비동기 연산 처리 (현장 용어 적용)
  if (action === "add") {
    sData.totalAmount += amount;
    sData.adjustment = (sData.adjustment || 0) + amount;
    sData.note = (sData.note || "") + ` [보너스 +${amount.toLocaleString()}]`;
  } else if (action === "sub") {
    sData.totalAmount -= amount;
    sData.adjustment = (sData.adjustment || 0) - amount;
    sData.note = (sData.note || "") + ` [공제 -${amount.toLocaleString()}]`;
  }

  // 데이터 업데이트
  cache.put("SETTLE_DATA_" + chatId, JSON.stringify(sData), 3600);
  
  // 🚀 즉시 응답 후 화면 갱신
  Telegram.answerCallbackQuery(callbackId, "✅ 금액 반영 완료");
  
  if (typeof Settlement !== 'undefined' && Settlement.showSettleSummary) {
    Settlement.showSettleSummary(chatId, sData);
  }
}

/**
 * 📑 3. 정산 콜백 핸들러 (버튼 클릭 분기)
 */
function handleCallbackQuery(chatId, data, queryId) {
  // A. 현장 성격 설정 (자체/파견)
  if (data.startsWith("settle_set_type_")) {
    const type = data.replace("settle_set_type_", "");
    const cache = CacheService.getUserCache();
    const raw = cache.get("SETTLE_DATA_" + chatId);
    if (raw) {
      let sData = JSON.parse(raw);
      sData.type = type;
      cache.put("SETTLE_DATA_" + chatId, JSON.stringify(sData), 3600);
      Telegram.answerCallbackQuery(queryId, "설정 완료");
      Settlement.showSettleSummary(chatId, sData);
    }
  }
  
  // B. 최종 장부 기록 확정 (오너 승인 연동)
  else if (data === "settle_final_confirm") {
    Settlement.finalCommitToSheet(chatId, queryId);
  }
  
  // C. 보너스/공제 버튼 처리
  else if (data.startsWith("bonus_")) {
    handleSettleAdjustment(chatId, data, queryId);
  }

  // D. 지출 승인 연동
  else if (data.startsWith("exp_auth_")) {
    if (typeof handleOwnerApproval === 'function') {
      handleOwnerApproval(chatId, data, queryId);
    }
  }
}

/**
 * 📅 4. 월간 정산 보고서 생성 (가변 범위 조회 최적화)
 */
function generateMonthlyReport(chatId, yearMonth) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.REVENUE);
  if (!sheet) return Telegram.sendMessage(chatId, "⚠️ 정산장부 시트를 찾을 수 없습니다.");

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return Telegram.sendMessage(chatId, `📅 ${yearMonth} 내역이 존재하지 않습니다.`);
  
  // 필요한 데이터 범위(A:E)만 타겟팅 로드
  const data = sheet.getRange(1, 1, lastRow, 5).getValues();
  let monthlyTotal = 0;
  let siteBreakdown = {};

  for (let i = 1; i < data.length; i++) {
    const rowDateRaw = data[i][0];
    let rowDate = "";
    
    if (rowDateRaw instanceof Date) {
      rowDate = Utilities.formatDate(rowDateRaw, "GMT+9", "yyyy-MM");
    }
    
    if (rowDate === yearMonth) {
      const amount = Number(data[i][4]) || 0; // E열: 최종 정산액
      const site = data[i][1] || "기타 현장"; // B열: 현장명
      monthlyTotal += amount;
      siteBreakdown[site] = (siteBreakdown[site] || 0) + amount;
    }
  }

  let report = `📊 <b>[월간 정산 보고서: ${yearMonth}]</b>\n━━━━━━━━━━━━━━━\n`;
  const sites = Object.keys(siteBreakdown);
  
  if (sites.length === 0) {
    report += "해당 월의 확정된 정산 내역이 없습니다.\n";
  } else {
    sites.forEach(site => {
      report += `📍 ${site}: <b>${siteBreakdown[site].toLocaleString()}원</b>\n`;
    });
  }
  
  report += `━━━━━━━━━━━━━━━\n💰 <b>총 집행액: ${monthlyTotal.toLocaleString()}원</b>`;
  
  return Telegram.sendMessage(chatId, report);
}