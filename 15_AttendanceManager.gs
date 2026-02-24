/**
 * [모듈 15] 15_AttendanceManager.gs
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: 지능형 근태 관제, [회원가입 자국어 등록], 병행 표기명 생성 및 지시 배포
 * 최종 업데이트: 2026-02-18
 * 수정자: 강성묵 과장 (병행 표기 및 자국어 등록 로직 통합)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🛡️ [강 과장 전용 시스템 운영 매뉴얼: 15번]
 * 1. 회원가입: 근로자가 입력한 자국어 이름을 바탕으로 AI 정석 발음을 추출하고 병행 표기명을 생성함.
 * 2. 병행 표기: P열(W_COMBINED)에 '기존별명 / 자국어(발음)' 형태로 조립하여 소통의 과도기를 지원함.
 * 3. 지능형 배포: 특정 현장에 출근 중인 인원만 추출하여 다국어 지시를 전파함.
 * 4. 지연 방지: 싱글톤 핸들 및 캐싱을 통해 시트 API 호출 부하를 최소화함.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

const AttendanceManager = {
  
  /** 🕒 1. 시간대별 가변 메인 메뉴 사출 */
  renderDynamicMenu: function(chatId, role) {
    const now = new Date();
    const hour = now.getHours() + (now.getMinutes() / 60);
    
    const ss = typeof getSS === "function" ? getSS() : SpreadsheetApp.openById(CONFIG.SS_ID);
    
    const startTime = 6.5; // 06:30
    const endTime = 17.5;  // 17:30
    
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
        [{ text: p.sos, callback_data: "sos_step1" }]
      ];
    } else {
      msg = `🌙 <b>[야간 보안 모드]</b>\n현재는 업무 시간이 아닙니다. 급여 및 정산 문의는 업무 시간 내에만 가능합니다.`;
      keyboard = [
        [{ text: `🆘 🆘 [${p.sos}] 🆘 🆘`, callback_data: "sos_step1" }],
        [{ text: "🏠 메인메뉴", callback_data: "go_main" }]
      ];
    }

    return Telegram.sendMessage(chatId, msg, { inline_keyboard: keyboard });
  },

  /** ✅ 2. 자국어 이름 최종 등록 및 병행 표기명(P열) 생성 */
  finalizeRegistration: function(chatId, nativeName, stateStr) {
    const info = stateStr.split("_");
    const rowIdx = parseInt(info[3]);
    const oldNickname = info[4]; // 시트 C열 기존 별명

    const ss = typeof getSS === "function" ? getSS() : SpreadsheetApp.openById(CONFIG.SS_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEETS.WORKERS);
    
    // 1. AI 정석 발음 추출 (00번 모듈 활용)
    const correctPhonetic = SmartTalk.extractPhonetic(nativeName);
    
    // 2. 강 과장님 설계 핵심: 병행 표기명 조립
    const combinedName = `${oldNickname} / ${nativeName}(${correctPhonetic})`;

    // 3. 시트 업데이트 (N:자국어, O:정석발음, P:병행표기명, F:ChatID)
    sheet.getRange(rowIdx, CONFIG.COL.W_NATIVE + 1).setValue(nativeName);
    sheet.getRange(rowIdx, CONFIG.COL.W_PHONETIC + 1).setValue(correctPhonetic);
    sheet.getRange(rowIdx, CONFIG.COL.W_COMBINED + 1).setValue(combinedName);
    sheet.getRange(rowIdx, CONFIG.COL.W_CHATID + 1).setValue(chatId);

    // 4. 관리자 보고
    const reportMsg =
      `🔔 <b>신규 회원 가입 완료</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `기존 호칭: ${oldNickname}\n` +
      `자국 성함: ${nativeName}\n` +
      `정석 발음: ${correctPhonetic}\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `✅ <b>병행 표기명 등록 완료</b>\n` +
      `[ ${combinedName} ]`;

    Telegram.sendMessage(CONFIG.ADMIN_ID, reportMsg);

    return Telegram.sendMessage(
      chatId,
      `✅ <b>Registration Success!</b>\nWelcome, ${nativeName}(${correctPhonetic})!`
    );
  },

  /** 📍 3. 출근 인증 처리 (GPS 거리 대조) */
  processCheckIn: function(chatId, location, role) {
    const sites = this.getSiteData();
    const userLat = location.latitude;
    const userLon = location.longitude;
    const radiusLimit = 20;

    let targetSite = null;
    for (let site of sites) {
      if (CommonUtils.getDistance(userLat, userLon, site.lat, site.lon) <= radiusLimit) {
        targetSite = site;
        break;
      }
    }

    if (targetSite) {
      const lock = LockService.getScriptLock();
      try {
        if (!lock.tryLock(500)) {
          return Telegram.sendMessage(chatId, "⏳ 사용자가 많습니다. 잠시 후 다시 시도해 주세요.");
        }
        
        const lang = role.lang || "KO";
        const phoneticName = targetSite.phonetics[lang] || targetSite.name;

        const successMsg = {
          "KO": `✅ <b>${targetSite.name}</b> 출근 완료!`,
          "VI": `✅ Đã điểm danh tại <b>${phoneticName}</b>!`,
          "TH": `✅ ลงชื่อเข้างานที่ <b>${phoneticName}</b>!`,
          "KH": `✅ បានចុះឈ្មោះចូលធ្វើការនៅ <b>${phoneticName}</b>!`,
          "PH": `✅ Check-in success sa <b>${phoneticName}</b>!`
        };

        return Telegram.sendMessage(chatId, successMsg[lang] || successMsg["KO"]);
      } catch (e) {
        return Telegram.sendMessage(chatId, "⚠️ 오류가 발생했습니다. 다시 시도해 주세요.");
      } finally {
        lock.releaseLock();
      }
    } else {
      return Telegram.sendMessage(chatId, "📍 현장 반경(20m) 밖입니다. 현장 근처에서 다시 시도하세요.");
    }
  },

  /** 👥 4. 특정 현장 출근 인원 리스트 추출 (병행 표기명 사출) */
  getActiveWorkersAtSite: function(siteName) {
    const ss = typeof getSS === "function" ? getSS() : SpreadsheetApp.openById(CONFIG.SS_ID);
    const logSheet = ss.getSheetByName(CONFIG.SHEETS.LOG);
    const workerSheet = ss.getSheetByName(CONFIG.SHEETS.WORKERS);
    
    const logData = logSheet.getDataRange().getValues();
    const workerData = workerSheet.getDataRange().getValues();
    
    const today = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd");
    let activeIds = [];

    for (let i = 1; i < logData.length; i++) {
      const rowDate = Utilities.formatDate(new Date(logData[i][CONFIG.COL.L_DATE]), "GMT+9", "yyyy-MM-dd");
      if (rowDate === today &&
          logData[i][CONFIG.COL.L_SITE] === siteName &&
          logData[i][CONFIG.COL.L_STATUS] === "출근") {
        activeIds.push(String(logData[i][CONFIG.COL.L_ID]));
      }
    }

    return workerData.slice(1).map(row => ({
      id: String(row[CONFIG.COL.W_NAME]),
      chatId: String(row[CONFIG.COL.W_CHATID]),
      lang: row[CONFIG.COL.W_LANG] || "KO",
      name: row[CONFIG.COL.W_COMBINED] || row[CONFIG.COL.W_NAME]
    })).filter(w => activeIds.includes(w.id));
  },

  /** 📢 5. 현장별 다국어 지시 실행 (큐 엔진 연동) */
  dispatchInstruction: function(siteName, inputText, translationResult) {
    const workers = this.getActiveWorkersAtSite(siteName);
    if (workers.length === 0) return 0;

    workers.forEach(worker => {
      QueueEngine.push({
        type: "SMART_COMMAND",
        payload: {
          targetChatId: worker.chatId,
          workerName: worker.name,
          text: inputText,
          translated: translationResult.txt,
          phonetic: translationResult.phon,
          lang: worker.lang,
          msgId: "CMD_" + new Date().getTime()
        }
      });
    });

    return workers.length;
  },

  /** 🗺️ 6. 현장 GPS 정보 캐싱 로드 */
  getSiteData: function() {
    const cache = CacheService.getScriptCache();
    const cached = cache.get("FIELD_SITES_CACHE_v2026");
    if (cached) return JSON.parse(cached);

    const ss = typeof getSS === "function" ? getSS() : SpreadsheetApp.openById(CONFIG.SS_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEETS.FIELDS);
    const data = sheet.getDataRange().getValues();
    
    const siteList = data.slice(1).map(row => ({
      name: row[CONFIG.COL.F_NAME],
      lat: parseFloat(row[CONFIG.COL.F_LAT]),
      lon: parseFloat(row[CONFIG.COL.F_LON]),
      phonetics: {
        'VI': row[CONFIG.COL.F_PHON_VI],
        'TH': row[CONFIG.COL.F_PHON_TH],
        'PH': row[CONFIG.COL.F_PHON_PH],
        'KH': row[CONFIG.COL.F_PHON_KH]
      },
      kakao: row[CONFIG.COL.F_KAKAOLINK],
      tmap: row[CONFIG.COL.F_TMAPLINK]
    })).filter(s => !isNaN(s.lat) && s.kakao);

    cache.put("FIELD_SITES_CACHE_v2026", JSON.stringify(siteList), 600);
    return siteList;
  },

  getGreeting: function(lang) {
    const dict = { "KO": "안녕하세요", "VI": "Xin chào", "TH": "สวัสดี", "KH": "សួស្តី", "PH": "Kumusta" };
    return dict[lang] || dict["KO"];
  }
};
