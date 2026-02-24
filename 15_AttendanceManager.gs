/**
 * [모듈 15] 15_AttendanceManager.gs
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: 지능형 근태 관제, 자국어 이름 등록, 병행 표기명 생성 및 지시 배포
 * 최종 업데이트: 2026-02-24 (병행 표기명 자동화 및 자연어기록 연동)
 */

const AttendanceManager = {
  
  /** 🕒 1. 시간대별 가변 메인 메뉴 사출 */
  renderDynamicMenu: function(chatId, role) {
    const now = new Date();
    const hour = now.getHours() + (now.getMinutes() / 60);
    
    // 운영설정에서 업무 시간 가져오기 (기본값 06:30 ~ 17:30)
    const startTime = 6.5; 
    const endTime = 17.5;  
    
    const isWorkTime = (hour >= startTime && hour < endTime); 
    const lang = role.lang || "KO";

    const labels = {
      "KO": { in: "📍 출근 인증", out: "🏠 업무 종료", navi: "🚗 현장 길안내", pay: "💰 정산/수당 확인", sos: "🆘 SOS 긴급 구조" },
      "VI": { in: "📍 Điểm danh", out: "🏠 Kết thúc việc", navi: "🚗 Chỉ đường", pay: "💰 Quyết toán", sos: "🆘 Cấp cứu SOS" },
      "TH": { in: "📍 ลงชื่อเข้างาน", out: "🏠 เลิกงาน", navi: "🚗 นำทาง", pay: "💰 ตรวจสอบเงิน", sos: "🆘 ขอความช่วยเหลือ" },
      "KH": { in: "📍 ចុះឈ្មោះចូល", out: "🏠 បញ្ចប់ការងារ", navi: "🚗 នាំផ្លូវ", pay: "💰 ពិនិត្យប្រក់ខែ", sos: "🆘 ជំនួយបន្ទាន់" },
      "PH": { in: "📍 Mag-check in", out: "🏠 Tapusin", navi: "🚗 Lokasyon", pay: "💰 Sweldo", sos: "🆘 SOS tulong" }
    };
    const p = labels[lang] || labels["KO"];

    let msg = "";
    let keyboard = [];

    if (isWorkTime) {
      msg = `👷 <b>${this.getGreeting(lang)} ${role.name}</b>\n안전하게 작업을 시작하세요.`;
      keyboard = [
        [{ text: p.in, callback_data: "job_in" }, { text: p.out, callback_data: "job_out" }],
        [{ text: p.navi, callback_data: "find_my_site" }, { text: p.pay, callback_data: "staff_settle_check" }],
        [{ text: p.sos, callback_data: "sos_request" }] // UIHandler와 규격 통일
      ];
    } else {
      msg = `🌙 <b>[야간 보안 모드]</b>\n현재는 업무 시간이 아닙니다. 급한 상황은 SOS 버튼을 누르세요.`;
      keyboard = [
        [{ text: `🆘 🆘 [${p.sos}] 🆘 🆘`, callback_data: "sos_request" }],
        [{ text: "🏠 메인메뉴", callback_data: "go_main" }]
      ];
    }

    return Telegram.sendMessage(chatId, msg, { inline_keyboard: keyboard });
  },

  /** ✅ 2. 자국어 이름 최종 등록 및 병행 표기명(P열) 생성 */
  finalizeRegistration: function(chatId, nativeName, stateStr) {
    try {
      const info = stateStr.split("_");
      const rowIdx = parseInt(info[3]);
      const oldNickname = info[4]; // 시트 C열 기존 별명

      const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
      const sheet = ss.getSheetByName(CONFIG.SHEETS.WORKERS);
      
      // 1. AI 정석 발음 추출 (00번 모듈 SmartTalk 활용)
      const correctPhonetic = SmartTalk.extractPhonetic(nativeName);
      
      // 2. 강 과장님 설계 핵심: 병행 표기명 조립 (기존별명 / 자국어(발음))
      const combinedName = `${oldNickname} / ${nativeName}(${correctPhonetic})`;

      // 3. 시트 업데이트 (N:자국어, O:정석발음, P:병행표기명, F:ChatID)
      sheet.getRange(rowIdx, CONFIG.COL.W_NATIVE + 1).setValue(nativeName);
      sheet.getRange(rowIdx, CONFIG.COL.W_PHONETIC + 1).setValue(correctPhonetic);
      sheet.getRange(rowIdx, CONFIG.COL.W_COMBINED + 1).setValue(combinedName);
      sheet.getRange(rowIdx, CONFIG.COL.W_CHATID + 1).setValue(chatId);

      // 4. [자연어기록]에 흔적 남기기
      logToNaturalLanguage(chatId, "회원가입", `신규등록: ${combinedName}`);

      // 5. 관리자 보고
      const reportMsg =
        `🔔 <b>신규 근로자 등록 완료</b>\n` +
        `━━━━━━━━━━━━━━━\n` +
        `기존 호칭: ${oldNickname}\n` +
        `자국 성함: ${nativeName}\n` +
        `정석 발음: ${correctPhonetic}\n` +
        `━━━━━━━━━━━━━━━\n` +
        `✅ <b>병행 표기명 사출 완료</b>\n` +
        `[ ${combinedName} ]`;

      Telegram.sendMessage(CONFIG.ADMIN_ID, reportMsg);

      return Telegram.sendMessage(chatId, `✅ <b>Success!</b>\nWelcome, ${nativeName}(${correctPhonetic})!`);
    } catch (e) {
      return Telegram.sendMessage(chatId, "❌ Registration Error. Please try again.");
    }
  },

  /** 📍 3. 출근 인증 처리 (GPS 거리 대조) */
  processCheckIn: function(chatId, location, role) {
    const sites = this.getSiteData();
    const userLat = location.latitude;
    const userLon = location.longitude;
    const radiusLimit = 200; // 과장님 지침: 200m 반경 허용

    let targetSite = null;
    for (let site of sites) {
      const distance = CommonUtils.getDistance(userLat, userLon, site.lat, site.lon);
      if (distance <= radiusLimit) {
        targetSite = site;
        break;
      }
    }

    if (targetSite) {
      const lock = LockService.getScriptLock();
      try {
        if (!lock.tryLock(1000)) return;
        
        const lang = role.lang || "KO";
        const phoneticName = targetSite.phonetics[lang] || targetSite.name;

        // 04_SystemLogic의 FieldService를 호출하여 시트에 기록
        if (typeof FieldService !== 'undefined') {
          FieldService.recordLog(chatId, targetSite.name, "IN", role);
        }

        const successMsg = {
          "KO": `✅ <b>${targetSite.name}</b> 출근 완료!`,
          "VI": `✅ Điểm danh tại <b>${phoneticName}</b> thành công!`,
          "TH": `✅ ลงชื่อเข้างานที่ <b>${phoneticName}</b> เรียบร้อย!`,
          "KH": `✅ ចុះឈ្មោះចូលនៅ <b>${phoneticName}</b> រួចរាល់!`,
          "PH": `✅ Check-in success sa <b>${phoneticName}</b>!`
        };

        return Telegram.sendMessage(chatId, successMsg[lang] || successMsg["KO"], { parse_mode: "HTML" });
      } finally {
        lock.releaseLock();
      }
    } else {
      return Telegram.sendMessage(chatId, "📍 현장 반경 밖입니다. 현장 근처에서 다시 시도하세요.");
    }
  },

  /** 🗺️ 4. 현장 GPS 정보 로드 및 캐싱 */
  getSiteData: function() {
    const cache = CacheService.getScriptCache();
    const cached = cache.get("FIELD_SITES_CACHE_2026");
    if (cached) return JSON.parse(cached);

    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEETS.FIELDS);
    const data = sheet.getDataRange().getValues();
    
    const siteList = data.slice(1).map(row => ({
      name: String(row[0]).trim(),
      lat: parseFloat(row[2]),
      lon: parseFloat(row[3]),
      phonetics: { 'VI': row[8], 'TH': row[10], 'PH': row[12], 'KH': row[14] }
    })).filter(s => !isNaN(s.lat));

    cache.put("FIELD_SITES_CACHE_2026", JSON.stringify(siteList), 600);
    return siteList;
  },

  getGreeting: function(lang) {
    const dict = { "KO": "안녕하세요", "VI": "Xin chào", "TH": "สวัสดี", "KH": "សួស្តី", "PH": "Kumusta" };
    return dict[lang] || dict["KO"];
  }
};