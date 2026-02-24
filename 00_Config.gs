/**
 * [모듈 00] 00_Config.gs
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: 전역 설정 및 지능형 소통 엔진 (기반 설정)
 * 최종 업데이트: 2026-02-19 (중복 권한 로직 제거 및 타입 안정성 강화)
 */

const CONFIG = {
  // 시스템 설정 (가변 데이터)
  get BOT_TOKEN() { return getSystemSetting("BOT_TOKEN"); }, 
  get GEMINI_API_KEY() { return getSystemSetting("GEMINI_API_KEY") || ""; },
  get GEMINI_MODEL() { return getSystemSetting("GEMINI_MODEL") || "gemini-1.5-flash"; },
  get WEBHOOK_URL() { return getSystemSetting("WEBHOOK_URL"); },
  get KMA_API_KEY() { return getSystemSetting("KMA_API_KEY"); },

  // 고정 설정 (물리적 ID) - ⚠️ 반드시 문자열로 관리하여 타입 오류 방지
  SS_ID: '1v-Tna27ppNSXCigOddg_LCW2YXPAFpuoTTfiwtoZ7mA', 
  SETTLE_SS_ID: '1v-Tna27ppNSXCigOddg_LCW2YXPAFpuoTTfiwtoZ7mA', 

  ADMIN_ID: '1158030965', 
  OWNER_IDS: ['1158030965'],
  GROUP_CHAT_ID: '-100XXXXXXXXXX',
  BOT_USERNAME: 'SmartField2026_Bot', 
  
  SHEETS: {
    WORKERS: '직원명부', LOG: '출근부', EXPENSE: '지출내역', SETTLE: '정산마감',
    FIELDS: '현장정보', ADMINS: '관리자명단', SCHEDULE: '작업일정', MSG_LOG: '메시지기록',
    SETTINGS: '수당설정', SYSTEM: '시스템설정', NLP_LOG: '자연어기록', REVENUE: '정산장부',
    OP_CONFIG: '운영설정', INVENTORY: '창고재고', MATERIALS: '자재관리', BOT_DB: '봇_대시보드',
    COMMUNICATION: '직원소통', MONITOR: '종합_상황판', DICT: '소통사전'
  },

  COL: {
    W_NAME: 0, W_NATION: 1, W_NICK: 2, W_PHONE: 4, W_CHATID: 5, W_LANG: 9,
    W_NATIVE: 13,
    W_PHONETIC: 14,
    W_COMBINED: 15,

    L_DATE: 0, L_ID: 1, L_NAME: 2, L_NATION: 3, L_SITE: 4, L_STATUS: 5, L_TOTAL: 10,
    L_WEATHER: 11, L_LAT: 12, L_LON: 13, L_LOC: 14, L_CHECK: 18,

    D_ID: 0, D_TYPE: 1, D_KO: 2, D_EMOJI: 3, 
    D_TH_T: 4, D_TH_P: 5, D_VI_T: 6, D_VI_P: 7, D_PH_T: 8, D_PH_P: 9, D_DATE: 10
  }
};


/**
 * 🤝 SmartTalk (AI 소통 엔진)
 */
const SmartTalk = {
  vault: null,

  init: function() {
    try {
      const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
      const sheet = ss.getSheetByName(CONFIG.SHEETS.DICT);
      if (!sheet) return;
      const data = sheet.getDataRange().getValues();
      this.vault = {};
      for (let i = 1; i < data.length; i++) {
        const koKey = String(data[i][CONFIG.COL.D_KO]).trim();
        if (koKey) {
          this.vault[koKey] = {
            id: data[i][CONFIG.COL.D_ID],
            emoji: data[i][CONFIG.COL.D_EMOJI],
            TH: { txt: data[i][CONFIG.COL.D_TH_T], phon: data[i][CONFIG.COL.D_TH_P] },
            VI: { txt: data[i][CONFIG.COL.D_VI_T], phon: data[i][CONFIG.COL.D_VI_P] },
            PH: { txt: data[i][CONFIG.COL.D_PH_T], phon: data[i][CONFIG.COL.D_PH_P] }
          };
        }
      }
    } catch (e) { console.error("사전 로드 실패"); }
  },

  extractPhonetic: function(nativeName) {
    const prompt = `주어진 이름 "${nativeName}"의 한국어 정석 발음을 한글로만 2~3글자로 요약해줘. JSON 형식으로만 응답: {"phon": "한글발음"}`;
    const response = this.callGeminiRaw(prompt);
    try {
      const cleanJson = response.replace(/```json|```/g, "").trim();
      return JSON.parse(cleanJson).phon;
    } catch (e) { return "발음확인"; }
  },

  callGeminiRaw: function(prompt) {
    const apiKey = CONFIG.GEMINI_API_KEY;
    if (!apiKey) return "";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const payload = { contents: [{ parts: [{ text: prompt }] }] };
    const options = { method: "post", contentType: "application/json", payload: JSON.stringify(payload), muteHttpExceptions: true };
    try {
      const res = UrlFetchApp.fetch(url, options);
      const json = JSON.parse(res.getContentText());
      if (json.candidates && json.candidates[0] && json.candidates[0].content) {
        return json.candidates[0].content.parts[0].text;
      }
      return "";
    } catch (e) {
      console.error("Gemini 통신 오류: " + e.toString());
      return "";
    }
  }
};


/**
 * 🔎 시스템 설정 조회 (Cache 연동)
 */
function getSystemSetting(key) {
  const cache = CacheService.getScriptCache();
  const cachedVal = cache.get("SETTING_" + key);
  if (cachedVal) return cachedVal;
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEETS.SYSTEM);
    if (!sheet) return null;
    const data = sheet.getDataRange().getValues();
    for (let i = 0; i < data.length; i++) { 
      if (String(data[i][0]).trim().toUpperCase() === key.toUpperCase()) {
        const val = String(data[i][1]).trim();
        cache.put("SETTING_" + key, val, 300); 
        return val; 
      } 
    }
  } catch (e) { return null; }
  return null;
}


/**
 * 🔐 관리자 정보 조회 (기본 정보 리턴)
 */
function getAdminInfo(chatId) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEETS.ADMINS);
    if (!sheet) return null;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][2]).trim() === String(chatId).trim()) {
        return {
          name: data[i][0],
          title: data[i][1], // role -> title로 명칭 통일 (13번 모듈 호환성)
          isMaster: data[i][3] === "마스터"
        };
      }
    }
  } catch (e) {
    return null;
  }
  return null;
}

// ⚠️ [중요] getUserRole 함수는 13_AuthManager.gs에서 단일 관리하므로 00번에서는 제거되었습니다.