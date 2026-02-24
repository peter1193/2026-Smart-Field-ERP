/**
 * [모듈 01] 01_Human.gs
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: 사용자 권한 식별, 숙련도(Skill) 조회 및 5개국어 '확인식' 도움말 제공
 * 최종 업데이트: 2026-02-16
 * 수정자: Gemini (강성묵 과장 시스템 설계 최종 합의안 반영 - 통신 규격 동기화)
 */

/**
 * 🌐 5개국어 상세 도움말 데이터베이스
 */
const HELP_PACK = {
  'KO': {
    'in': "📍 <b>출근 인증 안내</b>\n\n이 버튼을 누르면 현재 위치가 사장님께 전송됩니다.\n반드시 현장 반경 내에 있어야 출근이 인정됩니다.",
    'out': "🚩 <b>퇴근 정산 안내</b>\n\n업무를 마칠 때 누르세요. 17:30분 기준으로 급여가 자동 정산됩니다.\n오전 근무자라면 이 버튼을 누르지 않아도 자동으로 오전 정산됩니다.",
    'leave': "📅 <b>휴가 신청 안내</b>\n\n최소 2일 전에 신청해야 합니다. 음성으로 사유를 말씀하시면 AI가 번역하여 사장님께 승인을 요청합니다.",
    'sos': "🆘 <b>긴급 구조 안내</b>\n\n신변에 위협을 느낄 때만 누르세요. 3단계 확인을 거쳐 사장님께 실시간 위치가 전송됩니다."
  },
  'VI': { 
    'in': "📍 <b>Hướng dẫn điểm danh</b>\n\nBấm nút này để gửi vị trí cho Giám đốc.\nBạn phải ở trong công trường mới được chấp nhận đi làm.",
    'out': "🚩 <b>Hướng dẫn quyết toán</b>\n\nBấm khi kết thúc công việc. Lương sẽ tự động tính theo mốc 17:30.\nHệ thống tự động tính lương sáng nếu không bấm.",
    'leave': "📅 <b>Hướng dẫn xin nghỉ</b>\n\nPhải đăng ký trước ít nhất 2 ngày. AI sẽ dịch lời nói của bạn để gửi cho Giám đốc phê duyệt.",
    'sos': "🆘 <b>Hướng dẫn khẩn cấp</b>\n\nChỉ bấm khi gặp nguy hiểm. Vị trí của bạn sẽ được gửi cho Giám đốc sau 3 bước xác nhận."
  },
  'TH': { 
    'in': "📍 <b>คำแนะนำการลงชื่อเข้างาน</b>\n\nกดปุ่มนี้เพื่อส่งตำแหน่งปัจจุบันให้เถ้าแก่\nคุณต้องอยู่ในพื้นที่หน้างานเพื่อให้การเข้างานเสร็จสมบูรณ์",
    'out': "🚩 <b>คำแนะนำการคิดเงิน</b>\n\nกดเมื่อเลิกงาน ระบบจะคิดเงินอัตโนมัติตามเวลา 17:30 น.",
    'leave': "📅 <b>คำแนะนำการลาพักร้อน</b>\n\nต้องสมัครล่วงหน้าอย่างน้อย 2 วัน AI จะแปลคำพูดของคุณเพื่อขออนุมัติจากเถ้าแก่",
    'sos': "🆘 <b>คำแนะนำกรณีฉุกเฉิน</b>\n\nกดเมื่อมีอันตรายเท่านั้น ระบบจะส่งตำแหน่งของคุณให้เถ้าแก่หลังยืนยัน 3 ขั้นตอน"
  },
  'KH': { 
    'in': "📍 <b>ការណែនាំអំពីការចុះឈ្មោះចូលធ្វើការ</b>\n\nចុចប៊ូតុងនេះដើម្បីផ្ញើទីតាំងទៅថៅកែ។\nអ្នកត្រូវតែស្ថិតនៅក្នុងការដ្ឋានដើម្បីឱ្យការចូលធ្វើការមានសុពលភាព។",
    'out': "🚩 <b>ការណែនាំអំពីការទូទាត់ប្រាក់</b>\n\nចុចពេលបញ្ឈប់ការងារ។ ប្រាក់ឈ្នួលនឹងត្រូវគណនាដោយស្វ័យប្រវត្តិតាមម៉ោង ១៧:៣០។",
    'leave': "📅 <b>ការណែនាំអំពីការសុំច្បាប់សម្រាក</b>\n\nត្រូវដាក់ពាក្យយ៉ាងហោចណាស់ ២ ថ្ងៃមុន។ AI នឹងបកប្រែពាក្យសម្តីរបស់អ្នកដើម្បីសុំការអនុញ្ញាតពីថៅកែ។",
    'sos': "🆘 <b>ការណែនាំអំពីករណីបន្ទាន់</b>\n\nចុចតែពេលមានគ្រោះថ្នាក់ប៉ុណ្ណោះ។ ទីតាំងរបស់អ្នកនឹងត្រូវបានផ្ញើទៅថៅកែ។"
  },
  'PH': { 
    'in': "📍 <b>Time-In Guide</b>\n\nPress this to send your location to the Boss.\nYou must be within the site radius for it to be valid.",
    'out': "🚩 <b>Settlement Guide</b>\n\nPress kapag tapos na. Ang sweldo ay auto-calculated base sa 17:30.",
    'leave': "📅 <b>Leave Request Guide</b>\n\nMag-apply 2 days in advance. AI ang mag-tra-translate ng boses mo para sa Boss.",
    'sos': "🆘 <b>Emergency Guide</b>\n\nPress lang kung nasa panganib. Isesend ang location mo sa Boss pagkatapos ng 3 steps."
  }
};

/**
 * 인력 정보 및 권한 식별 (전역 호출용)
 */
function getUserRole(chatId) {
  const idStr = String(chatId).trim();
  const adminInfo = getAdminInfo(idStr); 
  const workerInfo = getWorkerInfoByChatId(idStr);
  
  const isMaster = (idStr === CONFIG.ADMIN_ID);
  const isOwner = adminInfo && (adminInfo.title === "오너" || adminInfo.title === "대표");
  const isAdmin = adminInfo && !isOwner;
  const isWorker = workerInfo && workerInfo.name !== "미등록";

  return {
    chatId: idStr,
    name: adminInfo ? adminInfo.name : workerInfo.name,
    title: adminInfo ? adminInfo.title : "직원",
    lang: workerInfo ? workerInfo.lang : "KO",
    isMaster: isMaster,
    isOwner: isOwner,
    isAdmin: isAdmin,
    isWorker: isWorker,
    basicPay: workerInfo ? workerInfo.basicPay : 0,
    stockAlert: adminInfo ? adminInfo.stockAlert : false,
    payAlert: adminInfo ? adminInfo.payAlert : false,
    attendAlert: adminInfo ? adminInfo.attendAlert : false,
    skills: workerInfo ? workerInfo.skills : null
  };
}

/**
 * 직원명부 데이터 조회 (숙련도 데이터 포함)
 */
function getWorkerInfoByChatId(chatId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.WORKERS);
  if (!sheet) return { name: "미등록", lang: "KO" };
  
  const data = sheet.getDataRange().getValues();
  const c = CONFIG.COL;
  const idStr = String(chatId).trim();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][c.W_CHATID]).trim() === idStr) {
      return {
        name: data[i][c.W_NAME],
        lang: (data[i][c.W_LANG] || "KO").toUpperCase(),
        basicPay: Number(data[i][c.W_BASIC_PAY]) || 0,
        skills: {
          saw: data[i][c.W_SKILL_SAW] || 0,
          pest: data[i][c.W_SKILL_PEST] || 0,
          fork: data[i][c.W_SKILL_FORK] || 0,
          ss: data[i][c.W_SKILL_SS] || 0
        }
      };
    }
  }
  return { name: "미등록", lang: "KO" };
}

/**
 * 🛰️ 출퇴근 및 현장 인식 처리 엔진
 */
const Attendance = {
  handleLocation: function(chatId, loc, role) {
    Telegram.sendLocation(chatId, loc.latitude, loc.longitude);

    if (role.isMaster || role.isOwner || role.isAdmin) {
      return this.handleAdminAttendance(chatId, loc, role);
    } 
    
    if (role.isWorker) {
      if (typeof AttendanceManager !== 'undefined') {
        return AttendanceManager.processLocation(chatId, loc, role);
      }
    }
    return Telegram.sendMessage(chatId, "🚫 등록되지 않은 사용자입니다.");
  },

  handleAdminAttendance: function(chatId, loc, role) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.FIELDS);
    if (!sheet) return;
    
    const data = sheet.getDataRange().getValues();
    let bestField = null;
    let minDict = 999999;

    for (let i = 1; i < data.length; i++) {
      const fLat = data[i][CONFIG.COL.F_LAT];
      const fLon = data[i][CONFIG.COL.F_LON];
      if (!fLat || !fLon) continue;

      const dist = this.getDistance(loc.latitude, loc.longitude, fLat, fLon);
      const rad = data[i][CONFIG.COL.F_RADIUS] || 200;

      if (dist < minDict) {
        minDict = dist;
        bestField = { name: data[i][CONFIG.COL.F_NAME], dist: Math.round(dist), rad: rad };
      }
    }

    let buttons = [];
    let msg = `📍 <b>관리자 현장 인증 (${role.title})</b>\n\n`;

    if (bestField && bestField.dist <= bestField.rad) {
      msg += `현재 위치: <b>${bestField.name}</b>\n인증 거리: ${bestField.dist}m\n\n출근/퇴근을 기록하거나 현장을 관리하세요.`;
      buttons.push([{ text: `✅ ${bestField.name} 출근`, callback_data: `in_admin_${bestField.name}` }]);
      buttons.push([{ text: `🚪 ${bestField.name} 퇴근`, callback_data: `out_admin_${bestField.name}` }]);
    } else {
      msg += "🔍 인근에 등록된 현장이 없습니다.";
      if (role.isMaster || role.isOwner) {
        buttons.push([{ text: "➕ 현재 위치를 신규 현장으로 등록", callback_data: `reg_new_field` }]);
      }
    }
    
    buttons.push([{ text: "🏠 메인메뉴", callback_data: "go_main" }]);

    // 🚀 교정: 00번 모듈의 통일된 규격에 따라 객체 상태로 reply_markup 전달
    return Telegram.sendMessage(chatId, msg, { reply_markup: { inline_keyboard: buttons } });
  },

  getDistance: function(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }
};