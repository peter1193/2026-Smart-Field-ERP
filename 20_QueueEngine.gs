/**
 * [모듈 20] 20_QueueEngine.gs
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: Slim Core + 배치 처리 + 발송 통로 단일화 (완전체 안정판)
 * 최종 업데이트: 2026-02-22 (리스크 제어 완성)
 */

const QueueEngine = {

  /* ==========================================================
     1️⃣ 큐에 작업 추가 (TTL 1800초 / 30분)
  ========================================================== */
  push: function(task) {
    const cache = CacheService.getScriptCache();
    let queue = JSON.parse(cache.get("SF_QUEUE") || "[]");

    queue.push({
      type: task.type,
      payload: task.payload,
      id: new Date().getTime()
    });

    cache.put("SF_QUEUE", JSON.stringify(queue), 1800);
  },

  /* ==========================================================
     2️⃣ 큐 처리 (Consumer - 통합 배치 처리)
  ========================================================== */
  process: function() {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(500)) return;

    try {
      const cache = CacheService.getScriptCache();
      let queue = JSON.parse(cache.get("SF_QUEUE") || "[]");

      if (queue.length === 0) return;

      const MAX_BATCH = 20; // 1분 트리거당 최대 처리 건수
      let processed = 0;

      while (queue.length > 0 && processed < MAX_BATCH) {
        const task = queue.shift();

        /* A) SETTLE_BROADCAST (과장님 지시: 개별 큐 재적재 방식으로 전환) */
        if (task.type === "SETTLE_BROADCAST") {
          const list = task.payload.targetList || [];
          list.forEach(user => {
            if (typeof SettlementAlert !== "undefined") {
              const msg = SettlementAlert.getWarmMessage(
                user.lang, user.name, task.payload.period, task.payload.deadline
              );
              // 직접 발송하지 않고 SMART_COMMAND로 개별 적재하여 부하 분산
              this.push({
                type: "SMART_COMMAND",
                payload: {
                  targetChatId: user.chatId,
                  message: msg
                }
              });
            }
          });
          // 대량 적재 후 다음 process 루프에서 처리되도록 유도 (processed 카운트 미증가)
          continue; 
        }

        /* B) SMART_COMMAND (통합 발송 통로) */
        else if (task.type === "SMART_COMMAND") {
          const payload = task.payload;
          if (payload) {
            const messageData = {
              chat_id: payload.targetChatId,
              text: payload.message,
              parse_mode: "Markdown"
            };

            if (payload.replyMarkup) {
              messageData.reply_markup = payload.replyMarkup;
            }

            Telegram.call('sendMessage', messageData);
            Utilities.sleep(60); // 텔레그램 안전 간격
          }
          processed++;
        }
      }

      cache.put("SF_QUEUE", JSON.stringify(queue), 1800);

    } catch (e) {
      console.error("QueueEngine 오류: " + e.toString());
    } finally {
      lock.releaseLock();
    }
  },

  /* ==========================================================
     3️⃣ 그룹 공지 발송 (SMART_COMMAND 개별 적재)
  ========================================================== */
  sendGroupNotice: function(senderChatId, target, messageText) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("직원명부");
    if (!sheet) {
      Telegram.sendMessage(senderChatId, "❌ 직원명부 시트가 없습니다.");
      return;
    }

    const data = sheet.getDataRange().getValues();
    let count = 0;

    for (let i = 1; i < data.length; i++) {
      const chatId = data[i][1];
      const role = String(data[i][2] || "").toUpperCase();

      if (!chatId) continue;

      let shouldSend = false;
      if (target === "all") shouldSend = true;
      if (target === "admin" && (role === "OWNER" || role === "MASTER" || role === "ADMIN")) shouldSend = true;
      if (target === "worker" && role === "WORKER") shouldSend = true;

      if (!shouldSend) continue;

      this.push({
        type: "SMART_COMMAND",
        payload: {
          targetChatId: chatId,
          message: "📢 *[공지사항]*\n\n" + messageText
        }
      });
      count++;
    }
    Telegram.sendMessage(senderChatId, `📢 공지 큐 적재 완료 (대상: ${count}명)`);
  },

  /* ==========================================================
     4️⃣ 싸이렌 (전원 대상 SMART_COMMAND 개별 적재)
  ========================================================== */
  broadcastSiren: function(senderChatId, alertText) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("직원명부");
    if (!sheet) {
      Telegram.sendMessage(senderChatId, "❌ 직원명부 시트가 없습니다.");
      return;
    }

    const data = sheet.getDataRange().getValues();
    let count = 0;

    for (let i = 1; i < data.length; i++) {
      const chatId = data[i][1];
      if (!chatId) continue;

      this.push({
        type: "SMART_COMMAND",
        payload: {
          targetChatId: chatId,
          message: "🚨 *[오너 긴급 지시]* 🚨\n\n" + alertText
        }
      });
      count++;
    }
    Telegram.sendMessage(senderChatId, `🚨 싸이렌 큐 적재 완료 (대상: ${count}명)`);
  }
};

/** 트리거 실행 통로 */
function runQueueEngineProcess() {
  QueueEngine.process();
}

/** 큐 강제 초기화 */
function clearQueue() {
  CacheService.getScriptCache().remove("SF_QUEUE");
}