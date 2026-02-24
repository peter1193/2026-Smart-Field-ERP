/**
 * [모듈 10] 10_Telegram.gs
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: Telegram API 통신 코어 (완전 안정판)
 * 최종 업데이트: 2026-02-23 (Telegram.call 인터페이스 최적화 및 HTML 기본값 대응)
 */

const Telegram = {

  /**
   * 1️⃣ 통합 API 호출 (Telegram.call)
   * 모든 텔레그램 메서드(sendMessage, setWebhook 등)의 단일 게이트웨이
   */
  call: function(method, payload) {

    const token =
      (typeof CONFIG !== 'undefined' && CONFIG.BOT_TOKEN)
        ? CONFIG.BOT_TOKEN
        : "";

    if (!token) {
      Logger.log("❌ BOT_TOKEN을 찾을 수 없습니다.");
      return { ok: false, error: "NO_TOKEN" };
    }

    // 12번 UIHandler 리모델링 대응: sendMessage 호출 시 parse_mode가 없으면 HTML을 기본값으로 설정
    if (method === "sendMessage" && payload && !payload.parse_mode) {
      payload.parse_mode = "HTML";
    }

    const url = "https://api.telegram.org/bot" + token + "/" + method;

    const options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload || {}),
      muteHttpExceptions: true
    };

    try {

      const response = UrlFetchApp.fetch(url, options);
      const httpCode = response.getResponseCode();
      const resText = response.getContentText();

      if (httpCode !== 200) {
        Logger.log(`❌ Telegram [${method}] 오류: ${httpCode}`);
        Logger.log(resText);
        return {
          ok: false,
          http_code: httpCode,
          description: resText
        };
      }

      try {
        return JSON.parse(resText);
      } catch (parseError) {
        Logger.log("❌ Telegram JSON 파싱 오류: " + parseError);
        return {
          ok: false,
          error: "JSON_PARSE_ERROR",
          raw: resText
        };
      }

    } catch (e) {
      Logger.log(`❌ Telegram [${method}] 통신 예외: ${e.toString()}`);
      return {
        ok: false,
        error_code: 999,
        description: e.toString()
      };
    }
  },

  /**
   * 2️⃣ 메시지 발송 (sendMessage 전용 래퍼)
   * 12번 모듈 등 외부 모듈과의 호환성을 위해 유지하며, 내부적으로 call을 호출합니다.
   */
  sendMessage: function(chatId, text, options) {

    const payload = {
      chat_id: String(chatId),
      text: text
    };

    // 기본 parse_mode는 HTML (리모델링 UI 최적화)
    payload.parse_mode =
      (options && options.parse_mode)
        ? options.parse_mode
        : "HTML";

    // reply_markup 자동 정규화
    if (options && options.reply_markup) {

      if (typeof options.reply_markup === "string") {
        try {
          payload.reply_markup = JSON.parse(options.reply_markup);
        } catch (e) {
          Logger.log("⚠️ reply_markup JSON 파싱 실패");
        }
      } else {
        payload.reply_markup = options.reply_markup;
      }
    }

    return this.call("sendMessage", payload);
  },

  /**
   * 3️⃣ 콜백 쿼리 응답
   */
  answerCallbackQuery: function(callbackQueryId, text) {

    const payload = {
      callback_query_id: String(callbackQueryId)
    };

    if (text) {
      payload.text = text;
    }

    return this.call("answerCallbackQuery", payload);
  },

  /**
   * 4️⃣ 웹훅 설정
   */
  setWebhook: function(url) {
    return this.call("setWebhook", {
      url: url,
      drop_pending_updates: true
    });
  },

  getWebhookInfo: function() {
    return this.call("getWebhookInfo", {});
  },

  /**
   * 5️⃣ 봇 커맨드 설정
   */
  setMyCommands: function(commands) {

    return this.call("setMyCommands", {
      commands:
        commands ||
        [{ command: "start", description: "리모컨 호출" }]
    });
  }
};

/**
 * 🔎 시스템 진단용 함수
 */
function checkWebhookStatus() {

  const result = Telegram.getWebhookInfo();

  Logger.log("--- Webhook Info ---");
  Logger.log(JSON.stringify(result, null, 2));
}