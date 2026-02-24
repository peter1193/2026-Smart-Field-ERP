/**
 * [모듈 08] 08_LanguageExtra.gs
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: 5개국어 안전 지시, 실시간 위치 추적(Live Location), 긴급 대피/복귀 및 영상통화 연결
 * 최종 업데이트: 2026-02-17
 * 수정자: Gemini (강성묵 과장 시스템 설계 최종 합의안 반영 - 규격 보정 및 시트 참조 무결성 확보)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🛡️ [강 과장 전용 시스템 운영 매뉴얼: 08번]
 * 1. 실시간 위치 추적 (executeSafetyBroadcast): 대피 발령 시 one_time_keyboard를 false로 설정하여 상황 종료 전까지 계속 위치를 보고받습니다.
 * 2. 규격 준수: Telegram.sendMessage의 세 번째 인자로 reply_markup 객체를 직접 전달하여 이중 래핑 오류를 차단합니다.
 * 3. 무결성 유지: SpreadsheetApp.openById(CONFIG.SS_ID)를 사용하여 웹훅 환경에서도 시트 데이터를 정확히 로드합니다.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

/**
 * 📢 1. 관리자용 안전 지시 전송 (전체 외국인 대상)
 */
function sendSafetyInstruction(chatId, typeCode) {
  // 🚀 [보정] openById로 명시적 참조
  const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  const workerSheet = ss.getSheetByName(CONFIG.SHEETS.WORKERS);
  if (!workerSheet) return;
  
  const data = workerSheet.getDataRange().getValues();
  let count = 0;

  Telegram.answerCallbackQuery(chatId, "📡 안전 지시 전송 중...");

  for (let i = 1; i < data.length; i++) {
    const workerChatId = data[i][CONFIG.COL.W_CHATID];
    const lang = (data[i][CONFIG.COL.W_LANG] || "KO").toUpperCase();
    
    if (workerChatId && workerChatId !== "") {
      const msg = SAFETY_LANG_PACK[lang][`admin_msg_${typeCode}`] || SAFETY_LANG_PACK['KO'][`admin_msg_${typeCode}`];
      Telegram.sendMessage(workerChatId, `<b>[🚨 SAFETY ALERT]</b>\n\n${msg}`);
      count++;
    }
  }
  return Telegram.sendMessage(chatId, `✅ 총 ${count}명에게 지시를 전송했습니다.`);
}

/**
 * 🚑 2. 근로자용 긴급 호출 처리 (영상통화 및 라이브 맵 링크 연동)
 */
function handleEmergencyCall(workerChatId, callCode) {
  const worker = getWorkerInfoByChatId(workerChatId); 
  const lang = worker.lang || 'KO';
  const msg = SAFETY_LANG_PACK[lang][`call_${callCode}`] || SAFETY_LANG_PACK['KO'][`call_${callCode}`];
  
  let icon = (callCode == '1') ? "🚑" : (callCode == '2') ? "⚙️" : (callCode == '3') ? "📦" : "🤝";

  const adminMsg = `${icon} <b>[현장 긴급 호출: ${msg}]</b>\n` +
                   `━━━━━━━━━━━━━━━\n` +
                   `👤 <b>발신자:</b> ${worker.name}\n` +
                   `🌐 <b>국적:</b> ${lang}\n` +
                   `━━━━━━━━━━━━━━━\n` +
                   `📢 담당자 확인 대기 중 (실시간 위치 추적 가동)`;

  const buttons = {
    inline_keyboard: [
      [{ text: "🙋 내가 처리하기 (수신 확인)", callback_data: `call_ack_${workerChatId}_${callCode}` }],
      [{ text: "📹 영상통화 연결 (현장확인)", url: `tg://user?id=${workerChatId}` }],
      [{ text: "📍 구글맵 실시간 경로 추적", url: `https://www.google.com/maps/search/?api=1&query=${workerChatId}` }]
    ]
  };

  const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  const adminSheet = ss.getSheetByName(CONFIG.SHEETS.ADMINS);
  if (adminSheet) {
    const adminData = adminSheet.getDataRange().getValues();
    for (let i = 1; i < adminData.length; i++) {
      let targetId = String(adminData[i][CONFIG.COL.A_ID]).trim();
      // 🚀 [보정] 00번 엔진 규격에 맞게 버튼 객체 직접 전달
      if (targetId) Telegram.sendMessage(targetId, adminMsg, buttons);
    }
  }
}

/**
 * ✍️ 3. 관리자의 호출 수신 확인 처리
 */
function processCallAcknowledgment(adminChatId, messageId, workerChatId, callCode, adminName) {
  const worker = getWorkerInfoByChatId(workerChatId);
  const lang = worker.lang || 'KO';
  const msg = SAFETY_LANG_PACK[lang][`call_${callCode}`] || SAFETY_LANG_PACK['KO'][`call_${callCode}`];
  const now = Utilities.formatDate(new Date(), "GMT+9", "HH:mm:ss");

  const updatedMsg = `✅ <b>[호출 확인 완료]</b>\n` +
                       `━━━━━━━━━━━━━━━\n` +
                       `👤 <b>발신자:</b> ${worker.name} (${msg})\n` +
                       `👷 <b>담당자:</b> ${adminName} 과장\n` +
                       `🕒 <b>시간:</b> ${now}\n` +
                       `━━━━━━━━━━━━━━━\n` +
                       `📢 <i>담당자가 구글맵 궤적 분석을 통해 조치 중입니다.</i>`;

  Telegram.call('editMessageText', { chat_id: String(adminChatId), message_id: messageId, text: updatedMsg, parse_mode: 'HTML' });
  
  const workerConfirm = {
    'KO': `✅ 관리자(${adminName})가 확인했습니다. 실시간 위치를 계속 보내주세요.`,
    'VI': `✅ Quản lý (${adminName}) đã xác nhận. Tiếp tục gửi vị trí.`,
    'TH': `✅ ผู้จัดการ (${adminName}) ยืนยันแล้ว โปรดส่งตำแหน่งต่อไป`,
    'KH': `✅ អ្នកគ្រប់គ្រង (${adminName}) បានបញ្ជាក់ហើយ។ បន្តផ្ញើទីតាំង।`,
    'PH': `✅ Kinumpirma ni Manager (${adminName}). Ituloy ang pag-send ng location.`
  };
  Telegram.sendMessage(workerChatId, workerConfirm[lang] || workerConfirm['KO']);
}

/**
 * 🚨 4. 긴급 대피/복귀 공지 발송 (지속적 위치 추적 모드)
 */
function executeSafetyBroadcast(adminChatId, actionType) {
  const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  const workerSheet = ss.getSheetByName(CONFIG.SHEETS.WORKERS);
  const data = workerSheet.getDataRange().getValues();
  
  const langSet = {
    'KO': { 
      'evacuate': "🚨🚨<b>[긴급 대피 및 실시간 보고]</b>🚨🚨\n위험 상황입니다! 즉시 대피하세요.\n<b>이동할 때마다 아래 버튼을 눌러 위치를 계속 알려주세요.</b>", 
      'return': "✅✅<b>[안전 상황 해제]</b>✅✅\n현장으로 복귀하여 작업을 재개하십시오.", 
      'btn': "📍 [현재 위치] 실시간 보고하기" 
    },
    'VI': { 
      'evacuate': "🚨🚨<b>[THÔNG BÁO KHẨN CẤP]</b>🚨🚨\nDi chuyển đến nơi an toàn! <b>Nhấn nút bên dưới mỗi khi bạn di chuyển để cập nhật vị trí.</b>", 
      'return': "✅✅<b>[TÌNH TRẠNG AN TOÀN]</b>✅✅\nVui lòng quay lại làm việc.", 
      'btn': "📍 Báo cáo vị trí thời gian thực" 
    }
  };

  let count = 0;
  for (let i = 1; i < data.length; i++) {
    let workerChatId = String(data[i][CONFIG.COL.W_CHATID]).trim();
    let lang = String(data[i][CONFIG.COL.W_LANG] || "KO").toUpperCase();
    let set = langSet[lang] || langSet['KO'];
    
    if (workerChatId && workerChatId !== "") {
      let markup;
      if (actionType === 'evacuate') {
        // 🚀 [보정] 규격에 맞는 리플라이 키보드 객체 생성
        markup = { 
          keyboard: [[{ text: set.btn, request_location: true }]], 
          resize_keyboard: true, 
          one_time_keyboard: false 
        };
      } else {
        // 🚀 [보정] 유령 버튼 강제 삭제 명령
        markup = { remove_keyboard: true };
      }
      
      // 🚀 [핵심 수정] 00번 엔진 규격에 맞게 markup을 3번째 인자로 직접 전달
      Telegram.sendMessage(workerChatId, set[actionType], markup);
      count++;
    }
  }
  const resultTitle = actionType === 'evacuate' ? "🚨 실시간 추적 발령" : "✅ 상황 해제";
  Telegram.sendMessage(adminChatId, `🔔 <b>[${resultTitle}] 완료</b>\n총 ${count}명에게 실시간 관제 모드를 전파했습니다.`);
}

const SAFETY_LANG_PACK = {
  'KO': {
    'admin_msg_24': "📢 싸이렌이 울리면 즉시 현장을 벗어나 안전한 장소로 대피 후 위치 보고를 계속해 주세요",
    'call_1': "🚑 응급 사고 발생!", 'call_2': "⚙️ 장비 고장", 'call_3': "📦 자재 부족", 'call_4': "🤝 인원 지원", 'call_5': "💬 상담 요청"
  },
  'VI': {
    'admin_msg_24': "📢 Khi nghe còi báo động, hãy rời hiện trường ngay lập tức và liên tục cập nhật vị trí",
    'call_1': "🚑 Tai nạn khẩn cấp!", 'call_2': "⚙️ Hỏng thiết bị", 'call_3': "📦 Thiếu vật tư", 'call_4': "🤝 Cần hỗ trợ", 'call_5': "💬 Cần tư vấn"
  }
};