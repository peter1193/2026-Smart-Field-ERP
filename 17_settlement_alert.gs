/**
 * 2026 Smart Field ERP - [17_settlement_alert]
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: 오너 정산 관제(승인/독촉/상황판) 및 비동기 큐 기반 따뜻한 다국어 공지 발송
 * 최종 업데이트: 2026-02-17
 * 수정자: Gemini (강성묵 과장 시스템 설계 기준 준수 - S급 하이퍼포먼스 튜닝 적용)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🛡️ [강 과장 전용 시스템 운영 매뉴얼: 17번]
 * 1. 지연 방지: 봇이 날짜를 계산하지 않고 오너가 [1~10일/11~20일/21~말일] 중 구간을 직접 선택하여 즉시 공지합니다.
 * 2. 비동기 큐: 오너가 공지 버튼을 누르면 직접 발송 루프를 돌지 않고 20번 QueueEngine에 작업을 예약합니다.
 * 3. 마감 원칙: 의의제기 기한을 "오늘 퇴근 1시간 전까지"로 명시하여 당일 정산 마감을 강력히 유도합니다.
 * 4. 따뜻한 보상: "입금 또는 현금 지급" 문구를 포함하여 고생한 근로자의 노고에 감사를 표합니다.
 * 5. 싱글톤 핸들: getSS()를 통해 시트 로드 부하를 최소화하고 Z1~Z4 캐시 리포트 속도를 극대화합니다.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

const SettlementAlert = {

  /**
   * 1. 오너용 정산 관제 대시보드 (Z열 캐시 기반)
   */
  renderOwnerDashboard: function(chatId) {
    const ss = getSS(); // 싱글톤 핸들 사용
    const summarySheet = ss.getSheetByName(CONFIG.SHEETS.SETTLE);
    if (!summarySheet) return;

    // 캐시 데이터 로드 (성능 최적화된 범위 스캔)
    const cacheData = summarySheet.getRange("Z1:Z4").getValues();
    const count = cacheData[0][0]; 
    const total = cacheData[1][0]; 
    const status = this.getSettleFinalStatus ? this.getSettleFinalStatus() : false;

    const report = "💰 <b>[2026 정산 총괄 관제 센터]</b>\n" +
                   "━━━━━━━━━━━━━━━\n" +
                   "🚨 <b>미결제 수당:</b> " + count + "건\n" +
                   "💵 <b>승인대기 총액:</b> " + total.toLocaleString() + "원\n" +
                   "✅ <b>정산 확정 상태:</b> " + (status ? "🔴 확정완료" : "⚪ 미확정") + "\n" +
                   "━━━━━━━━━━━━━━━\n" +
                   "미결된 내역을 검토 후 최종 공지를 진행하십시오.";
    
    const buttons = [
      [{ text: "🔍 1. 미결 수당 검토 (" + count + ")", callback_data: "settle_review_pending" }],
      [{ text: "🏆 2. 정산 구간 선택 및 공지 발송", callback_data: "settle_ask_period" }],
      [{ text: "📱 3. 실시간 확인 상황판", callback_data: "settle_monitor_view" }]
    ];

    return Telegram.sendMessage(chatId, report, { inline_keyboard: buttons });
  },

  /**
   * 2. 정산 구간 선택 메뉴 (지연 방지 및 비동기 트리거용)
   */
  askSettlePeriod: function(chatId) {
    const msg = "📢 <b>정산 구간을 선택해 주세요.</b>\n선택 즉시 20번 큐 엔진을 통해 전 직원 공지가 발송됩니다.";
    const buttons = [
      [{ text: "📅 1일 ~ 10일", callback_data: "set_period_1_10" }],
      [{ text: "📅 11일 ~ 20일", callback_data: "set_period_11_20" }],
      [{ text: "📅 21일 ~ 말일", callback_data: "set_period_21_end" }],
      [{ text: "🏠 취소", callback_data: "owner_settle_main" }]
    ];
    return Telegram.sendMessage(chatId, msg, { inline_keyboard: buttons });
  },

  /**
   * 3. [비동기 전환] 전 직원 공지 발송 (20번 QueueEngine 연동)
   */
  sendFinalBroadcast: function(adminChatId, selectedPeriod) {
    const ss = getSS();
    const opSheet = ss.getSheetByName(CONFIG.SHEETS.OP_CONFIG);
    const deadline = "오늘 퇴근 1시간 전까지"; 

    // 전 직원 리스트 로드 (직원명부 기준)
    const workers = this.getWorkerList(); 
    
    // 🚀 20번 큐 엔진에 작업 전달 (웹훅 프리징 방지)
    QueueEngine.push({
      type: "SETTLE_BROADCAST",
      payload: {
        period: selectedPeriod,
        deadline: deadline,
        targetList: workers.map(w => ({ chatId: w.chatId, name: w.name, lang: w.lang }))
      }
    });

    // 시트 상태를 '승인'으로 즉시 변경하여 직원 열람 권한 오픈
    opSheet.getRange("C10").setValue("승인");
    
    return Telegram.sendMessage(adminChatId, `🚀 <b>[${selectedPeriod}] 공지 예약 완료</b>\n20번 큐 엔진이 백그라운드에서 순차 발송을 시작합니다.`);
  },

  /**
   * 4. 따뜻한 격려 + 지급 방식 + 마감원칙 (5개국어 템플릿)
   * 20번 QueueEngine에서 호출하여 실제 메시지를 생성합니다.
   */
  getWarmMessage: function(lang, name, period, deadline) {
    const dict = {
      "KO": `🌸 <b>[소중한 정산 내용이 도착했습니다]</b>\n\n${name}님, 고생하시는 그 마음 잘 알고 있습니다.\n이번 <b>${period}</b> 정산 내역입니다.\n\n• <b>확인 기한:</b> ${deadline}\n\n내용 보시고 궁금한 점은 말씀해 주세요. 별다른 말씀이 없으시면 동의한 것으로 알고, 정성을 다해 <b>입금 또는 현금 지급</b>해 드리겠습니다.\n\n<b>당신의 노고에 감사드립니다.</b>`,
      
      "VI": `🌸 <b>[Nội dung quyết toán trân quý đã đến]</b>\n\nChào ${name}, chúng tôi hiểu rõ sự vất vả của bạn.\nQuyết toán cho <b>${period}</b>.\n\n• <b>Hạn kiểm tra:</b> 1 giờ trước khi tan làm hôm nay\n\nNếu không có ý kiến, chúng tôi sẽ <b>chuyển khoản hoặc trả tiền mặt</b> trân trọng nhất.\n<b>Cảm ơn sự nỗ lực của bạn!</b>`,
      
      "TH": `🌸 <b>[รายละเอียดการชำระเงินมาแล้วครับ]</b>\n\nคุณ ${name}, ขอบคุณในความทุ่มเทของคุณ\nการชำระเงินสำหรับ <b>${period}</b>\n\n• <b>ตรวจสอบภายใน:</b> 1 ชั่วโมงก่อนเลิกงานวันนี้\n\nหากไม่มีข้อโต้แย้ง ผมจะ <b>โอนเงินเข้าบัญชีหรือจ่ายเงินสด</b> ให้คุณอย่างแน่นอนครับ`,
      
      "KH": `🌸 <b>[ព័ត៌មានការទូទាត់បានមកដល់ហើយ]</b>\n\nសួស្តី ${name}, អរគុណសម្រាប់ការខិតខំ។\nការទូទាត់សម្រាប់ <b>${period}</b>\n\n• <b>ពិនិត្យឱ្យបានមុន:</b> ១ ម៉ោងមុនចេញពីធ្វើការថ្ងៃនេះ\n\nខ្ញុំនឹង <b>ផ្ញើប្រាក់ទៅគណនី ឬប្រគល់ប្រាក់សុទ្ធ</b> ជូនអ្នកដោយក្តីគោរព។`,
      
      "PH": `🌸 <b>[Narito na ang iyong settlement]</b>\n\nSalamat sa iyong sipag ${name}.\nSettlement para sa <b>${period}</b>\n\n• <b>Deadline:</b> 1 oras bago ang uwian ngayong araw\n\nKung walang problema, <b>ihuhulog sa account o ibibigay nang cash</b> ang iyong sahod.`
    };
    return dict[lang] || dict["KO"];
  },

  /**
   * 5. 실시간 확인 상황판 및 미체크자 독촉
   */
  renderMonitorBoard: function(chatId) {
    const logs = this.getReadStatusLogs(); 
    const unread = logs.filter(l => !l.isRead);
    const readCount = logs.length - unread.length;

    let msg = `📱 <b>[실시간 열람 상황판]</b>\n` +
              `━━━━━━━━━━━━━━━\n` +
              `✅ <b>확인 완료:</b> ${readCount}명\n` +
              `❌ <b>미체크:</b> ${unread.length}명\n` +
              `━━━━━━━━━━━━━━━\n` +
              `<b>[미체크 명단]</b>\n${unread.map(u => u.name).join(", ") || "전원 확인 완료"}`;

    const buttons = [];
    if (unread.length > 0) {
      buttons.push([{ text: "🔔 미체크자 독촉 알림 발송", callback_data: "settle_push_uncheck" }]);
    }
    buttons.push([{ text: "🔄 새로고침", callback_data: "settle_monitor_view" }]);

    return Telegram.sendMessage(chatId, msg, { inline_keyboard: buttons });
  },

  /**
   * 6. 미체크자 대상 타겟 독촉 메시지
   */
  sendUrgentReminder: function(adminChatId) {
    const unread = this.getReadStatusLogs().filter(l => !l.isRead);
    
    unread.forEach(user => {
      const lang = user.lang || "KO";
      const pushMsg = {
        "KO": `🌸 <b>[정산 내역 확인 부탁]</b>\n\n고생해서 번 소중한 돈입니다. 아직 내역을 확인하지 않으셨습니다. 오늘 퇴근 전까지 확인 부탁드리며, 미확인 시 동의한 것으로 간주됩니다.`,
        "VI": `🌸 <b>[Nhắc nhở kiểm tra quyết toán]</b>\n\nĐây là số tiền trân quý bạn đã vất vả làm ra. Vui lòng kiểm tra trước khi tan làm. Nếu không xác nhận, bạn sẽ bị coi là đã đồng ý.`,
        "TH": `🌸 <b>[การแจ้งเตือนการตรวจสอบ]</b>\n\nโปรดตรวจสอบรายละเอียดก่อนเลิกงานวันนี้ หากไม่ยืนยันภายในกำหนดจะถือว่ายอมรับ`,
        "KH": `🌸 <b>[ការរំលឹកការពិនិត្យ]</b>\n\nសូមពិនិត្យមើលវាឱ្យបានមុនចេញពីធ្វើការថ្ងៃនេះ។ បើមិនពិនិត្យតាមកំណត់ វានឹងត្រូវចាត់ទុកថាអ្នកយល់ព្រម។`,
        "PH": `🌸 <b>[Paalala sa pag-check]</b>\n\nPakisuri ang detalye bago ang uwian ngayong araw. Ituturing na sang-ayon ka kung hindi mo ito i-confirm.`
      };
      Telegram.sendMessage(user.chatId, pushMsg[lang] || pushMsg["KO"]);
    });

    return Telegram.sendMessage(adminChatId, `🔔 ${unread.length}명에게 독촉 알림을 전송했습니다.`);
  },

  /**
   * 7. 직원 명부 로드 유틸리티
   */
  getWorkerList: function() {
    const ss = getSS();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.WORKERS);
    const data = sheet.getDataRange().getValues();
    return data.slice(1).map(row => ({
      name: row[CONFIG.COL.W_NAME],
      chatId: String(row[CONFIG.COL.W_CHATID]),
      lang: row[CONFIG.COL.W_LANG] || "KO"
    })).filter(w => w.chatId);
  }
};
