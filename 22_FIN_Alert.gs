/**
 * 2026 Smart Field ERP - 22_FIN_Alert
 * 원칙: 
 * 1. 대분류 분리([지출], [입금])를 통해 버튼 과부하 방지 및 2차 선택지 최적화
 * 2. 지출은 '승인' 기반, 입금은 '로그 가산' 기반의 개별 액션 버튼 생성
 * 3. 수입(파견) 파트: D+3 지연 시 🔥 강조 로직 시각화 반영
 */

/** 1. 통합 요약 알림 발송 (아침 트리거용 메인 진입점) */
function FIN_sendDailyFinanceAlert() {
  const owners = FIN_getFinanceOwners();
  const data = FIN_getIntegratedPendingList(); // 21번 엔진 호출
  
  if (owners.length === 0) return;

  // 발송 조건: 지출이나 수입 중 하나라도 내역이 있어야 함
  const hasExpense = data.pay.length > 0 || data.labor.length > 0;
  const hasIncome = data.income.length > 0;
  
  if (!hasExpense && !hasIncome) {
    Logger.log("결제 대기 및 입금 예정 내역이 없어 알림을 발송하지 않습니다.");
    return;
  }

  let message = "🔔 <b>[Smart Field 자금 통제 리포트]</b>\n\n";
  
  if (hasIncome) {
    message += `🏦 <b>입금 대기:</b> ${data.income.length}건 (${data.totalIncome.toLocaleString()}원)\n`;
  }
  if (hasExpense) {
    message += `💸 <b>지출 예정:</b> ${data.pay.length + data.labor.length}건 (${data.totalSum.toLocaleString()}원)\n`;
  }
  
  message += "\n상세 내역 확인 및 처리를 위해 아래 버튼을 눌러주세요.";

  // 메인 대분류 버튼 구성 (버튼 과부하 방지)
  const mainButtons = [];
  if (hasExpense) {
    mainButtons.push([{ text: "💸 지출관리(정기/인력) 확인", callback_data: "view_expense_list" }]);
  }
  if (hasIncome) {
    mainButtons.push([{ text: "🏦 파견비 입금확인 바로가기", callback_data: "view_income_list" }]);
  }
  mainButtons.push([{ text: "📊 전체 자금 현황판", callback_data: "FIN_DASH" }]);

  const keyboard = { inline_keyboard: mainButtons };

  owners.forEach(chatId => {
    FIN_sendTelegramMessage(chatId, message, keyboard);
  });
}

/** 2. 카테고리별 상세 현황판 발송 (2차 선택지 화면) */
function FIN_sendCategoryView(chatId, type) {
  const data = FIN_getIntegratedPendingList();
  let message = "";
  let buttons = [];
  let displayIdx = 1;

  if (type === "expense") {
    message = "💸 <b>[지출 승인 관리]</b>\n\n";
    // 정기지출 + 외부인력 통합 나열
    const allExpenses = [...data.pay, ...data.labor];
    allExpenses.forEach(item => {
      message += `${displayIdx}. ${item.target}\n`;
      message += `   💰 ${item.amount.toLocaleString()}원 | 📅 ${item.due}\n\n`;
      
      const actionType = item.category ? "pay" : "labor"; 
      buttons.push([{
        text: `✅ ${displayIdx}번 결제완료(승인)`,
        callback_data: `approve_${actionType}_${item.row}_${item.id}`
      }]);
      displayIdx++;
    });
  } 
  else if (type === "income") {
    message = "🏦 <b>[파견비 입금 관리]</b>\n\n";
    data.income.forEach(item => {
      const icon = (item.isLate && item.lateDays >= 3) ? "🔥" : "▫️";
      message += `${displayIdx}. ${icon} ${item.target}\n`;
      message += `   💰 잔액: ${item.amount.toLocaleString()}원 | 📅 ${item.due}\n\n`;
      
      buttons.push([{
        text: `💰 ${displayIdx}번 입금액 추가`,
        callback_data: `add_income_${item.row}_${item.id}`
      }]);
      displayIdx++;
    });
  }

  // 하단 공통 제어 버튼 (2차 선택지)
  const commonControl = [
    [{ text: "🔄 새로고침", callback_data: `view_${type}_list` }, { text: "🔙 메인으로", callback_data: "FIN_MAIN" }]
  ];

  const keyboard = { inline_keyboard: buttons.concat(commonControl) };
  FIN_sendTelegramMessage(chatId, message, keyboard);
}

/** [내부함수] 텔레그램 발송 처리 (객체명 가변 대응) */
function FIN_sendTelegramMessage(chatId, text, keyboard) {
  try {
    const payload = {
      chat_id: String(chatId),
      text: text,
      parse_mode: 'HTML',
      reply_markup: JSON.stringify(keyboard)
    };

    if (typeof TELEGRAM !== 'undefined') {
      TELEGRAM.sendMessage(chatId, text, keyboard);
    } else if (typeof TelegramAPI !== 'undefined') {
      TelegramAPI.call('sendMessage', payload);
    } else if (typeof Telegram !== 'undefined') {
      Telegram.sendMessage(chatId, text, keyboard);
    }
  } catch (e) {
    Logger.log("메시지 발송 실패: " + e.toString());
  }
}