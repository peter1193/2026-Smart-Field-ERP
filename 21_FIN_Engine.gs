/**
 * 2026 Smart Field ERP - 21_FIN_Engine
 * 원칙: 
 * 1. 시트의 수식 결과(금액, 날짜, 상태)를 100% 신뢰하며 통합 데이터 추출
 * 2. 지출(정기/인력)과 수입(파견미수금) 데이터를 분리하여 통합 관리
 * 3. 수입 파트: 입금예정일 기반 D+3 지연 강조 로직 엔진 반영
 */

/** 1. 알림 대상 오너 동적 조회 (관리자명단 기반) */
function FIN_getFinanceOwners() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("관리자명단");
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  const owners = [];

  for (let i = 1; i < data.length; i++) {
    const telegramId = String(data[i][1]).trim();     // B열: ID
    const alertOn = String(data[i][6]).toUpperCase();   // G열: ON/OFF
    const level = String(data[i][10]).trim();           // K열: 권한

    if (telegramId && alertOn === "ON" && (level === "오너" || level === "마스터")) {
      owners.push(telegramId);
    }
  }
  return owners;
}

/** 2. 통합 자금 데이터 추출 (지출 + 수입 통합) */
function FIN_getIntegratedPendingList() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const result = { 
    pay: [],      // 정기지출
    labor: [],    // 외부인력(지출)
    income: [],   // 파견미수금(수입)
    totalSum: 0,  // 지출 총액
    totalIncome: 0 // 수입 총액
  };

  // --- A. 정기지출 (지급일정관리) ---
  const paySheet = ss.getSheetByName("지급일정관리");
  if (paySheet) {
    const data = paySheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const dueRaw = data[i][4]; // E열: 지급예정일
      const status = data[i][6]; // G열: 상태
      if (!dueRaw || status !== "대기") continue;

      const dueDate = new Date(dueRaw);
      if (isNaN(dueDate.getTime())) continue;
      dueDate.setHours(0, 0, 0, 0);

      if (dueDate <= today) {
        const amt = Number(data[i][3]) || 0;
        result.pay.push({ 
          row: i + 1, 
          id: String(data[i][0]), 
          category: data[i][1], 
          target: data[i][2], 
          amount: amt, 
          due: Utilities.formatDate(dueDate, "GMT+9", "yyyy-MM-dd") 
        });
        result.totalSum += amt;
      }
    }
  }

  // --- B. 외부인력 (외부인력정산) ---
  const laborSheet = ss.getSheetByName("외부인력정산");
  if (laborSheet) {
    const data = laborSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const dueRaw = data[i][8]; // I열: 지급예정일
      const status = data[i][9]; // J열: 상태
      if (!dueRaw || status !== "대기") continue;

      const dueDate = new Date(dueRaw);
      if (isNaN(dueDate.getTime())) continue;
      dueDate.setHours(0, 0, 0, 0);

      if (dueDate <= today) {
        const amt = Number(data[i][7]) || 0;
        result.labor.push({ 
          row: i + 1, 
          id: String(data[i][0]), 
          target: data[i][3], 
          amount: amt, 
          due: Utilities.formatDate(dueDate, "GMT+9", "yyyy-MM-dd") 
        });
        result.totalSum += amt;
      }
    }
  }

  // --- C. 파견미수금 (파견인력매출) ---
  const incomeSheet = ss.getSheetByName("파견인력매출");
  if (incomeSheet) {
    const data = incomeSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const status = data[i][6]; // G열: 상태 (수식 결과)
      if (!data[i][0] || status === "입금완료" || status === "취소") continue;

      const dueRaw = data[i][3]; // D열: 입금예정일
      let isLate = false;
      let lateDays = 0;

      if (dueRaw) {
        const dueDate = new Date(dueRaw);
        if (!isNaN(dueDate.getTime())) {
          dueDate.setHours(0, 0, 0, 0);
          if (today > dueDate) {
            isLate = true;
            lateDays = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
          }
        }
      }

      const balance = Number(data[i][5]) || 0; // F열: 잔액 (수식 결과)
      result.income.push({
        row: i + 1,
        id: String(data[i][0]),     // A열: ID
        target: data[i][1],         // B열: 거래처
        amount: balance,
        status: status,
        isLate: isLate,
        lateDays: lateDays,
        due: dueRaw ? Utilities.formatDate(new Date(dueRaw), "GMT+9", "yyyy-MM-dd") : "미지정"
      });
      result.totalIncome += balance;
    }
  }

  return result;
}

/** 3. 통합 자금 알림 실행 함수 (아침 트리거용 단순 텍스트 보고) */
function FIN_sendDailyReport() {
  const owners = FIN_getFinanceOwners();
  const data = FIN_getIntegratedPendingList();
  
  // 모든 항목이 없으면 종료
  if (owners.length === 0 || (data.pay.length === 0 && data.labor.length === 0 && data.income.length === 0)) return;

  let message = "📢 <b>[자금 집행 및 입금 요약 보고]</b>\n\n";
  
  // 수입 현황
  if (data.income.length > 0) {
    message += "<b>🏦 [파견비 입금 대기]</b>\n";
    data.income.forEach(item => {
      const icon = (item.isLate && item.lateDays >= 3) ? "🔥" : "▫️";
      const lateTxt = item.isLate ? ` (지연 ${item.lateDays}일)` : "";
      message += `${icon} ${item.target}: ${item.amount.toLocaleString()}원${lateTxt}\n`;
    });
    message += `💰 <b>미수금 합계: ${data.totalIncome.toLocaleString()}원</b>\n\n`;
  }

  // 지출 현황 (정기)
  if (data.pay.length > 0) {
    message += "<b>💸 [정기 지출]</b>\n";
    data.pay.forEach(item => { 
      message += `▫️ ${item.target}: ${item.amount.toLocaleString()}원\n`; 
    });
    message += "\n";
  }
  
  // 지출 현황 (인력)
  if (data.labor.length > 0) {
    message += "<b>👷 [외부 인력]</b>\n";
    data.labor.forEach(item => { 
      message += `▫️ ${item.target}: ${item.amount.toLocaleString()}원\n`; 
    });
    message += "\n";
  }
  
  message += `📊 <b>금일 총 지출 필요: ${data.totalSum.toLocaleString()}원</b>`;

  owners.forEach(ownerId => {
    if (typeof TELEGRAM !== 'undefined') {
      TELEGRAM.sendMessage(ownerId, message);
    }
  });
}

/** 4. 시스템 테스트 함수 */
function test_FIN_Notification() {
  const data = FIN_getIntegratedPendingList();
  
  Logger.log("조회된 정기지출: " + data.pay.length);
  Logger.log("조회된 외부인력: " + data.labor.length);
  Logger.log("조회된 파견미수: " + data.income.length);

  try {
    if (typeof FIN_sendDailyFinanceAlert === 'function') {
      FIN_sendDailyFinanceAlert();
      Browser.msgBox("버튼형 통합 알림을 발송했습니다.");
    } else {
      FIN_sendDailyReport();
      Browser.msgBox("텍스트형 요약 보고를 발송했습니다.");
    }
  } catch (e) {
    Browser.msgBox("오류 발생: " + e.toString());
  }
}