/**
 * [모듈 01] 01_Human.gs
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: 인력 정보 식별, 숙련도 조회 및 5개국어 지능형 도움말 제공
 * 최종 업데이트: 2026-02-24 (병행 표기명 및 자연어기록 연동 반영)
 */

/**
 * 🌐 5개국어 상세 도움말 데이터베이스
 */
const HELP_PACK = {
  'KO': {
    'in': "📍 <b>출근 인증 안내</b>\n\n현재 위치가 기록됩니다. 현장 반경(200m) 내에 있어야 출근이 인정됩니다.",
    'out': "🚩 <b>퇴근 정산 안내</b>\n\n작업 종료 시 누르세요. 미입력 시 운영설정 마감 시간에 자동 퇴근 처리됩니다.",
    'leave': "📅 <b>휴가 신청 안내</b>\n\nAI가 사유를 번역하여 관리자에게 승인을 요청합니다.",
    'sos': "🆘 <b>긴급 구조 안내</b>\n\n위험 상황에서만 누르세요. 즉시 관리자에게 위치가 전송됩니다."
  },
  'VI': { 
    'in': "📍 <b>Hướng dẫn điểm danh</b>\n\nVị trí của bạn sẽ được ghi lại. Bạn phải ở trong phạm vi công trường (200m).",
    'out': "🚩 <b>Hướng dẫn kết thúc</b>\n\nBấm khi hết giờ. Nếu quên, hệ thống sẽ tự động điểm danh ra.",
    'leave': "📅 <b>Hướng dẫn xin nghỉ</b>\n\nAI sẽ dịch lý do của bạn để gửi cho quản lý phê duyệt.",
    'sos': "🆘 <b>Hướng dẫn khẩn cấp</b>\n\nChỉ bấm khi gặp nguy hiểm. Vị trí sẽ được gửi ngay cho quản lý."
  },
  'TH': { 
    'in': "📍 <b>คำแนะนำการลงชื่อเข้างาน</b>\n\nตำแหน่งของคุณจะถูกบันทึกไว้ คุณต้องอยู่ในระยะ 200 เมตรจากหน้างาน",
    'out': "🚩 <b>คำแนะนำการเลิกงาน</b>\n\nกดเมื่อเสร็จงาน หากลืมระบบจะลงเวลาออกให้อัตโนมัติ",
    'leave': "📅 <b>คำแนะนำการลา</b>\n\nAI จะแปลเหตุผลของคุณเพื่อขออนุมัติจากผู้จัดการ",
    'sos': "🆘 <b>คำแนะนำฉุกเฉิน</b>\n\nกดเมื่อมีอันตรายเท่านั้น ตำแหน่งของคุณจะถูกส่งให้ผู้จัดการทันที"
  },
  'KH': { 
    'in': "📍 <b>ការណែនាំអំពីការចូលធ្វើការ</b>\n\nទីតាំងរបស់អ្នកនឹងត្រូវបានកត់ត្រា។ អ្នកត្រូវតែស្ថิตក្នុងចម្ងាយ ២០០ម៉ែត្រ។",
    'out': "🚩 <b>ការណែនាំអំពីការចេញពីធ្វើការ</b>\n\nចុចពេលបញ្ចប់ការងារ។ ប្រសិនបើភ្លេច ប្រព័ន្ធនឹងធ្វើការចេញដោយស្វ័យប្រវត្តិ។",
    'leave': "📅 <b>ការណែនាំអំពីការសុំច្បាប់</b>\n\nAI នឹងបកប្រែមូលហេតុរបស់អ្នកដើម្បីសុំការអនុញ្ញាត។",
    'sos': "🆘 <b>ការណែនាំអំពីករណីបន្ទាន់</b>\n\nចុចតែពេលមានគ្រោះថ្នាក់ប៉ុណ្ណោះ។ ទីតាំងនឹងផ្ញើទៅអ្នកគ្រប់គ្រងភ្លាមៗ។"
  },
  'PH': { 
    'in': "📍 <b>Time-In Guide</b>\n\nYour location will be recorded. Must be within 200m of the site.",
    'out': "🚩 <b>Time-Out Guide</b>\n\nPress when finished. System will auto-out based on settings.",
    'leave': "📅 <b>Leave Request</b>\n\nAI will translate your reason for manager approval.",
    'sos': "🆘 <b>Emergency Guide</b>\n\nPress only in danger. Location will be sent to manager immediately."
  }
};

/**
 * 인력 정보 및 권한 식별 (전역 호출용)
 */
function getUserRole(chatId) {
  const idStr = String(chatId).trim();
  const adminInfo = getAdminInfo(idStr); 
  const workerInfo = getWorkerInfoByChatId(idStr);
  
  const isMaster = (idStr === String(CONFIG.ADMIN_ID).trim());
  const isOwner = adminInfo && (adminInfo.isMaster === true || adminInfo.title === "오너" || adminInfo.title === "대표");
  const isAdmin = adminInfo && !isOwner;
  const isWorker = workerInfo && workerInfo.name !== "미등록";

  return {
    chatId: idStr,
    name: adminInfo ? adminInfo.name : workerInfo.name,
    combinedName: workerInfo ? (workerInfo.combinedName || workerInfo.name) : (adminInfo ? adminInfo.name : "미등록"),
    title: adminInfo ? adminInfo.title : "직원",
    lang: workerInfo ? workerInfo.lang : "KO",
    isMaster: isMaster,
    isOwner: isOwner,
    isAdmin: isAdmin,
    isWorker: isWorker,
    basicPay: workerInfo ? workerInfo.basicPay : 0,
    skills: workerInfo ? workerInfo.skills : null
  };
}

/**
 * 직원명부 데이터 조회 (숙련도 및 병행표기명 포함)
 */
function getWorkerInfoByChatId(chatId) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEETS.WORKERS);
    if (!sheet) return { name: "미등록", lang: "KO" };
    
    const data = sheet.getDataRange().getValues();
    const c = CONFIG.COL;
    const idStr = String(chatId).trim();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][c.W_CHATID]).trim() === idStr) {
        return {
          name: data[i][c.W_NAME],
          combinedName: data[i][c.W_COMBINED], // P열: 병행표기명
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
  } catch(e) { return { name: "미등록", lang: "KO" }; }
  return { name: "미등록", lang: "KO" };
}

/**
 * 🛰️ 출퇴근 및 현장 인식 처리 엔진
 */
const Attendance = {
  handleLocation: function(chatId, loc, role) {
    if (role.isMaster || role.isOwner || role.isAdmin) {
      return this.handleAdminAttendance(chatId, loc, role);
    } 
    
    if (role.isWorker) {
      if (typeof AttendanceManager !== 'undefined') {
        return AttendanceManager.processCheckIn(chatId, loc, role);
      }
    }
    return Telegram.sendMessage(chatId, "🚫 등록되지 않은 사용자입니다. 관리자에게 문의하세요.");
  },

  handleAdminAttendance: function(chatId, loc, role) {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEETS.FIELDS);
    if (!sheet) return;
    
    const data = sheet.getDataRange().getValues();
    let bestField = null;
    let minDict = 999999;

    for (let i = 1; i < data.length; i++) {
      const fLat = Number(data[i][2]); // C열: 위도
      const fLon = Number(data[i][3]); // D열: 경도
      if (!fLat || !fLon) continue;

      const dist = this.getDistance(loc.latitude, loc.longitude, fLat, fLon);
      const rad = 200; // 관리자 인증 반경 200m 고정

      if (dist < minDict) {
        minDict = dist;
        bestField = { name: data[i][0], dist: Math.round(dist), rad: rad };
      }
    }

    let buttons = [];
    let msg = `📍 <b>관리자 현장 관제 (${role.name} ${role.title})</b>\n\n`;

    if (bestField && bestField.dist <= bestField.rad) {
      msg += `현재 위치 인식: <b>${bestField.name}</b>\n인증 거리: ${bestField.dist}m\n\n현장 업무를 시작하거나 종료하시겠습니까?`;
      buttons.push([{ text: `✅ ${bestField.name} 출근 기록`, callback_data: `in_admin_${bestField.name}` }]);
      buttons.push([{ text: `🚪 ${bestField.name} 퇴근 기록`, callback_data: `out_admin_${bestField.name}` }]);
    } else {
      msg += "🔍 인근에 등록된 공식 현장이 없습니다.\n현재 위치를 새로운 현장으로 등록하시겠습니까?";
      if (role.isMaster || role.isOwner) {
        buttons.push([{ text: "➕ 신규 현장 등록 (GPS 저장)", callback_data: `reg_new_field` }]);
      }
    }
    
    buttons.push([{ text: "🏠 메인메뉴", callback_data: "go_main" }]);

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