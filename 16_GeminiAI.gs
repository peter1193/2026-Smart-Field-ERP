/**
 * [모듈 16] 16_GeminiAI.gs
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: Gemini 모델 기반 시각 분석, 다국어 번역, 소통사전 지능형 연동
 * 최종 업데이트: 2026-02-24 (소통사전 가속 및 시스템 설정 연동)
 */

const GeminiAI = {

  // 시스템 설정 시트(B4, B5)에서 동적으로 로드
  get API_KEY() { return getSystemSetting("GEMINI_API_KEY"); },
  get MODEL() { return getSystemSetting("GEMINI_MODEL") || "gemini-1.5-flash"; },

  /**
   * 📸 1. 자재 명세서 사진 정밀 분석 (BOM 자동 입고 연동)
   */
  analyzeMaterialPhoto: function(chatId, photoArray) {
    if (!this.API_KEY) return Telegram.sendMessage(chatId, "⚠️ AI API 키가 설정되지 않았습니다.");

    const fileId = photoArray[photoArray.length - 1].file_id;
    const fileRes = Telegram.call('getFile', { file_id: fileId });
    if (!fileRes || !fileRes.ok) return;

    const fileUrl = `https://api.telegram.org/file/bot${CONFIG.BOT_TOKEN}/${fileRes.result.file_path}`;
    const imageBlob = UrlFetchApp.fetch(fileUrl).getBlob();

    const prompt = "명세서 이미지에서 '품목명', '규격', '수량'을 추출하여 JSON 형식으로 응답하라. JSON 키: item, spec, qty";

    try {
      const rawText = this.callGeminiVision(prompt, imageBlob);
      const mat = JSON.parse(rawText.replace(/```json|```/g, "").trim());

      if (mat.item) {
        const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
        const matSheet = ss.getSheetByName(CONFIG.SHEETS.MATERIALS);
        matSheet.appendRow([mat.item, mat.spec || "", mat.qty || 0, "EA", 10, new Date()]);

        const msg = `📦 <b>[자재 스캔 입고]</b>\n━━━━━━━━━━━━━━━\n🔹 품목: ${mat.item}\n🔹 규격: ${mat.spec || "-"}\n🔹 수량: ${mat.qty || 0}\n━━━━━━━━━━━━━━━\n기록이 완료되었습니다.`;
        Telegram.sendMessage(chatId, msg, { parse_mode: "HTML" });
        
        // 자연어기록 연동
        if (typeof logToNaturalLanguage === 'function') {
          logToNaturalLanguage(chatId, "자재스캔", `${mat.item} 스캔 입고`);
        }
      }
    } catch (e) {
      Telegram.sendMessage(chatId, "❌ 사진 분석 중 오류가 발생했습니다.");
    }
  },

  /**
   * 🗣️ 2. 지능형 번역 엔진 (소통사전 우선 조회)
   */
  smartTranslate: function(text, targetLang, mode) {
    // 1단계: 소통사전 캐시 확인 (속도 최적화)
    if (typeof SmartTalk !== 'undefined' && SmartTalk.translate) {
      const cached = SmartTalk.translate(text, targetLang);
      if (cached) return cached;
    }

    // 2단계: 사전 없을 시 Gemini 호출
    const prompt = (mode === "TO_KO") 
      ? `다음 문장을 한국어로 번역하라: ${text}`
      : `다음 한국어 문장을 ${targetLang} 언어로 번역하라: ${text}`;
    
    const result = this.callGemini(prompt);
    
    // 3단계: 새로운 번역 결과는 자연어기록에 남겨 추후 사전에 등록 유도
    return result;
  },

  /**
   * ⚙️ Gemini Text API 호출 엔진
   */
  callGemini: function(prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.MODEL}:generateContent?key=${this.API_KEY}`;
    const payload = { contents: [{ parts: [{ text: prompt }] }] };
    const options = { method: "post", contentType: "application/json", payload: JSON.stringify(payload), muteHttpExceptions: true };

    try {
      const res = UrlFetchApp.fetch(url, options);
      const json = JSON.parse(res.getContentText());
      return json.candidates[0].content.parts[0].text.trim();
    } catch (e) { return "AI 번역 일시 오류"; }
  },

  /**
   * ⚙️ Gemini Vision API 호출 엔진
   */
  callGeminiVision: function(prompt, blob) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.MODEL}:generateContent?key=${this.API_KEY}`;
    const payload = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) } }
        ]
      }]
    };
    const options = { method: "post", contentType: "application/json", payload: JSON.stringify(payload), muteHttpExceptions: true };

    const res = UrlFetchApp.fetch(url, options);
    return JSON.parse(res.getContentText()).candidates[0].content.parts[0].text;
  }
};