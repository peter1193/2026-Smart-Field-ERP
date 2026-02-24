/**
 * [모듈 16] 16_GeminiAI.gs
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: Gemini Pro 모델 기반 음성/텍스트 분석, 자재 명세서 스캔 및 다국어 소통 지원
 * 최종 업데이트: 2026-02-18
 * 수정자: Gemini (슬림화 및 안정성 패치 적용)
 */

const GeminiAI = {

  // Gemini API 키 및 모델 로드
  get API_KEY() { return CONFIG.GEMINI_API_KEY; },
  get MODEL() { return getSystemSetting("GEMINI_MODEL") || "gemini-1.5-flash"; },

  /**
   * 📸 1. 자재 명세서 사진 정밀 분석 (안정성 강화 버전)
   */
  analyzeMaterialPhoto: function(chatId, photoArray) {

    if (!this.API_KEY) {
      return Telegram.sendMessage(chatId, "⚠️ AI 키가 설정되지 않았습니다. 시스템 설정(B4)을 확인하세요.");
    }

    if (!photoArray || photoArray.length === 0) {
      return Telegram.sendMessage(chatId, "⚠️ 사진 데이터가 감지되지 않았습니다.");
    }

    const role = getUserRole(chatId);
    const lang = role.lang || "KO";

    const loadingMsg = {
      "KO": "📸 <b>명세서 분석을 시작합니다.</b>\n잠시만 기다려 주세요.",
      "VI": "📸 <b>Bắt đầu phân tích hóa đơn.</b>",
      "TH": "📸 <b>เริ่มวิเคราะห์ใบแจ้งหนี้</b>",
      "KH": "📸 <b>ចាប់ផ្តើមវិភាគវិក្កយបត្រ</b>",
      "PH": "📸 <b>Nagsisimula ang pagsusuri ng invoice</b>"
    };

    Telegram.sendMessage(chatId, loadingMsg[lang] || loadingMsg["KO"]);

    try {

      const fileId = photoArray[photoArray.length - 1].file_id;
      const fileRes = Telegram.call('getFile', { file_id: fileId });

      if (!fileRes || !fileRes.ok) {
        throw new Error("파일 로드 실패");
      }

      const fileUrl = `https://api.telegram.org/file/bot${CONFIG.BOT_TOKEN}/${fileRes.result.file_path}`;
      const imageBlob = UrlFetchApp.fetch(fileUrl).getBlob();

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.MODEL}:generateContent?key=${this.API_KEY}`;

      const payload = {
        contents: [{
          parts: [
            {
              text: "이미지에서 '항목명', '규격', '수량', '단위'를 추출하여 JSON으로만 응답하라. 키값은 item, spec, qty, unit 고정."
            },
            {
              inline_data: {
                mime_type: imageBlob.getContentType(),
                data: Utilities.base64Encode(imageBlob.getBytes())
              }
            }
          ]
        }]
      };

      const response = UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });

      if (response.getResponseCode() !== 200) {
        throw new Error("AI 응답 오류");
      }

      const resJson = JSON.parse(response.getContentText());

      if (!resJson.candidates || !resJson.candidates[0].content) {
        throw new Error("AI 결과 없음");
      }

      let rawText = resJson.candidates[0].content.parts[0].text || "";
      rawText = rawText.replace(/```json|```/g, "").trim();

      const mat = JSON.parse(rawText);

      if (!mat.item) {
        throw new Error("JSON 파싱 실패");
      }

      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const matSheet = ss.getSheetByName(CONFIG.SHEETS.MATERIALS);

      if (!matSheet) {
        throw new Error("자재 시트 없음");
      }

      matSheet.appendRow([
        mat.item,
        mat.spec || "",
        mat.qty || "",
        mat.unit || "",
        10,
        new Date()
      ]);

      const successMsg =
        `📦 <b>[자재 입고 기록 완료]</b>\n` +
        `━━━━━━━━━━━━━━━\n` +
        `🔹 품목: ${mat.item}\n` +
        `🔹 규격: ${mat.spec || "-"}\n` +
        `🔹 수량: ${mat.qty || "-"} ${mat.unit || ""}\n` +
        `━━━━━━━━━━━━━━━\n` +
        `기록이 완료되었습니다.`;

      Telegram.sendMessage(chatId, successMsg);

      this.notifyStockToAdmins(mat.item, mat.qty);

    } catch (e) {

      const errorMsg = {
        "KO": "❌ 분석 중 오류가 발생했습니다. 다시 시도해 주세요.",
        "VI": "❌ Có lỗi xảy ra. Vui lòng thử lại.",
        "TH": "❌ เกิดข้อผิดพลาด กรุณาลองใหม่",
        "KH": "❌ មានកំហុស សូមព្យាយាមម្តងទៀត",
        "PH": "❌ Nagkaroon ng error. Pakisubukang muli."
      };

      Telegram.sendMessage(chatId, errorMsg[lang] || errorMsg["KO"]);
    }
  },

  /**
   * 🗣️ 2. 외국인 근로자 메시지 → 한국어 번역
   */
  translateToKo: function(text, userLang) {

    if (!text) return "";

    const prompt =
      `다음 ${userLang} 문장을 한국어로 번역하라. 번역문만 출력:\n` +
      text;

    return this.callGemini(prompt);
  },

  /**
   * 🗣️ 3. 관리자 지시 → 근로자 모국어 번역
   */
  translateToOwn: function(koText, userLang) {

    if (!koText) return "";

    const prompt =
      `다음 한국어 지시를 ${userLang} 언어로 번역하라. 번역문만 출력:\n` +
      koText;

    return this.callGemini(prompt);
  },

  /**
   * ⚙️ Gemini API 공통 호출 엔진 (슬림화 버전)
   */
  callGemini: function(prompt) {

    if (!this.API_KEY) return "AI 키 오류";

    try {

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.MODEL}:generateContent?key=${this.API_KEY}`;

      const payload = {
        contents: [{
          parts: [{ text: prompt }]
        }]
      };

      const response = UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });

      if (response.getResponseCode() !== 200) {
        return "AI 응답 오류";
      }

      const resJson = JSON.parse(response.getContentText());

      if (resJson.candidates && resJson.candidates[0].content) {
        return (resJson.candidates[0].content.parts[0].text || "").trim();
      }

      return "결과 없음";

    } catch (e) {
      return "AI 처리 실패";
    }
  },

  /**
   * 🚨 4. 재고 알림 설정자 푸시 발송
   */
  notifyStockToAdmins: function(itemName, qty) {

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const adminSheet = ss.getSheetByName(CONFIG.SHEETS.ADMINS);
    if (!adminSheet) return;

    const lastRow = adminSheet.getLastRow();
    if (lastRow < 2) return;

    const admins = adminSheet.getRange(1, 1, lastRow, 15).getValues();

    const alertMsg =
      `📦 <b>[자재 입고 알림]</b>\n` +
      `━━━━━━━━━━━━━━━\n` +
      `🔹 품목: ${itemName}\n` +
      `🔹 수량: ${qty}\n` +
      `AI 분석 기록 완료`;

    for (let i = 1; i < admins.length; i++) {

      if (String(admins[i][CONFIG.COL.A_STOCK_ALARM]).toUpperCase() === "ON") {

        const targetId = String(admins[i][CONFIG.COL.A_ID]);

        if (targetId) {
          Telegram.sendMessage(targetId, alertMsg);
        }
      }
    }
  }
};
