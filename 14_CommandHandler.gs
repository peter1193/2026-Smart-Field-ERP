/**
 * [모듈 14] 14_CommandHandler.gs
 * 프로젝트: 2026 Smart Field ERP (통합 관제탑)
 * 역할: 오너 통제형 하단 6개 버튼 및 텍스트(음성) 명령어 통합 처리
 * 최종 업데이트: 2026-02-22 (Null 방어 로직 보강 및 공지 모드 트리거 완비)
 */

/**
 * 🛰️ 텍스트 명령어 및 대분류 버튼 통합 처리
 */
function handleTextMessage(chatId, text, roleInfo) {

  if (!chatId || !text) return;

  // 1. Role 정보 정규화 (과장님 지시: Null 방어 및 객체/문자열 완벽 대응)
  const userRole = (roleInfo && typeof roleInfo === "object") 
    ? roleInfo 
    : (typeof getUserRole === "function" ? getUserRole(chatId) : {});
    
  const cmd = String(text).trim();

  // 2. 시스템 잠금 상태 확인 (과장님 지시: 대소문자 및 트림 처리 안정화)
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settingSheet = ss.getSheetByName("시스템설정");
  const systemStatus = settingSheet 
    ? String(settingSheet.getRange("B8").getValue()).toUpperCase().trim() 
    : "OPEN";

  // 보안 판정 로직 (과장님 지시: 불확실한 undefined 판정 방지)
  if (systemStatus === "LOCK" && !(userRole.isOwner === true || userRole.isMaster === true)) {
    return Telegram.call('sendMessage', {
      chat_id: chatId,
      text: "🕒 <b>[시스템 보안 모드]</b>\n현재 관리가 제한됩니다. 해제는 오너 승인 필요.",
      parse_mode: "HTML"
    });
  }

  /* ==========================================================
   * 1️⃣ [확정안] 오너/관리자 하단 6개 고정 메뉴 처리 (최우선 순위)
   * ========================================================== */
  switch (cmd) {
    case '📊 현황':
      // 오너 성향 2번(꼼꼼함) 반영: 실시간 요약 브리핑 호출
      if (typeof FIN_getRealtimeStatus === 'function') {
        const statusReport = FIN_getRealtimeStatus();
        Telegram.call('sendMessage', {
          chat_id: chatId,
          text: statusReport,
          parse_mode: "Markdown"
        });
      } else {
        Telegram.sendMessage(chatId, "📊 실시간 경영 지표 및 자금 흐름을 분석 중입니다. 잠시만 기다려 주십시오.");
      }
      return; // 즉시 종료하여 하단 로직 중복 실행 방지

    case '💰 결재':
      if (typeof UIHandler !== "undefined" && UIHandler.결재_대기_목록_표시) {
        return UIHandler.결재_대기_목록_표시(chatId);
      }
      Telegram.sendMessage(chatId, "💰 승인 대기 중인 자금 결재 내역을 불러오고 있습니다.");
      return;

    case '🚜 운영':
      if (typeof UIHandler !== "undefined" && UIHandler.현장_메뉴_표시) {
        return UIHandler.현장_메뉴_표시(chatId);
      }
      Telegram.sendMessage(chatId, "🚜 현장 가동 인원 및 주요 작업 현황 보고입니다.");
      return;

    case '📦 재고':
      if (typeof UIHandler !== "undefined" && UIHandler.창고_메뉴_표시) {
        return UIHandler.창고_메뉴_표시(chatId);
      }
      Telegram.sendMessage(chatId, "📦 주요 자재 잔량 및 부족 알림 현황입니다.");
      return;

    case '🚨 비상':
      if (userRole.isOwner === true || userRole.isMaster === true) {
        if (typeof UIHandler !== "undefined" && UIHandler.발송_확인_UI) {
          return UIHandler.발송_확인_UI(chatId);
        }
      } else {
        Telegram.sendMessage(chatId, "⚠️ 해당 메뉴에 대한 지휘 권한이 없습니다.");
      }
      return;

    case '📢 공지':
      if (userRole.isOwner === true || userRole.isMaster === true) {
        Telegram.call('sendMessage', {
          chat_id: chatId,
          text: "📢 <b>공지사항 전파</b>\n대상을 선택하십시오.",
          parse_mode: "HTML",
          reply_markup: JSON.stringify({
            inline_keyboard: [
              [{ text: "👥 전 직원", callback_data: "notice_all" }],
              [{ text: "👨‍💼 관리자만", callback_data: "notice_admin" }],
              [{ text: "👷 근로자만", callback_data: "notice_worker" }]
            ]
          })
        });
      }
      return;
  }

  /* ==========================================================
   * 2️⃣ 메인 진입 및 시스템 특수 명령 (기존 로직 유지)
   * ========================================================== */
  if (cmd === "🏠 메인메뉴" || cmd === "/start" || cmd === "🔄 화면 새로고침" || cmd.includes("메인메뉴")) {
    if (typeof UIHandler !== "undefined" && UIHandler.마스터_대시보드_발송) {
      return UIHandler.마스터_대시보드_발송(chatId, userRole);
    }
    return Telegram.sendMessage(chatId, "🏠 메인메뉴 로직이 연결되지 않았습니다.");
  }

  /* 마스터/오너 전용 특수 관리 명령 */
  if (userRole.isOwner === true || userRole.isMaster === true) {
    if (cmd === "🔓 상황판 잠금해제") {
      if (settingSheet) settingSheet.getRange("B8").setValue("OPEN");
      return Telegram.sendMessage(chatId, "✅ <b>상황판 잠금이 해제되었습니다.</b>", { parse_mode: "HTML" });
    }

    if (cmd === "🔒 상황판 시계전환") {
      if (settingSheet) settingSheet.getRange("B8").setValue("LOCK");
      return Telegram.sendMessage(chatId, "🕒 <b>상황판이 시계 모드로 전환되었습니다.</b>", { parse_mode: "HTML" });
    }

    if (cmd === "💾 시스템백업") {
      if (typeof BackupManager !== "undefined") {
        BackupManager.runFullBackup();
        return Telegram.sendMessage(chatId, "💾 <b>시스템 백업 완료</b>", { parse_mode: "HTML" });
      }
    }
  }

  /* 3️⃣ 지능형 실무 분석 및 AI 지시 (PearManager 연동) */
  const isActionCmd = /등록|수정|취소|내일|오늘|모레|입고|출고|정산|인원|명/.test(cmd);
  if (isActionCmd && (userRole.isOwner === true || userRole.isMaster === true || userRole.isAdmin === true)) {
    if (typeof PearManager !== "undefined") {
      return PearManager.requestTaskApproval(chatId, cmd);
    }
  }

  /* 4️⃣ 근로자 전용 피드백 (과장님 지시: 안전한 언어 예외 처리) */
  if (userRole.isWorker === true) {
    const feedbackMsg = {
      KO: "✅ 메시지가 관리자에게 전달되었습니다.",
      VI: "✅ Tin nhắn đã được gửi đến quản lý.",
      TH: "✅ ข้อความถูกส่งไปยังผู้จัดการแล้ว",
      PH: "✅ Message has been sent to the manager."
    };
    const lang = (userRole.lang && feedbackMsg[userRole.lang]) ? userRole.lang : "KO";
    return Telegram.sendMessage(chatId, feedbackMsg[lang]);
  }

  /* 5️⃣ 기본 예외 처리 및 명령어 가이드 */
  return Telegram.sendMessage(
    chat_id = chatId,
    text = "❓ 알 수 없는 명령입니다. 하단 리모컨 메뉴를 이용하시거나 정확한 업무 지시를 입력해 주세요."
  );
}