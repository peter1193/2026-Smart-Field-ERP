/**
 * [모듈 12] 12_UIHandler.gs
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: 권한별 리모컨 UI 제어 및 지능형 항목 매칭 기반 현황판 출력
 * 최종 업데이트: 2026-02-24 (SOS 배치 최적화 및 재고 이원화 반영)
 */

/** 🛠️ [수동 실행] 마스터 대시보드 및 최종 리모델링 버튼 강제 로드 */
function 마스터_리모컨_강제로드() {
  const 마스터ID = CONFIG.ADMIN_ID;
  const 권한 = { isMaster: true, isAdmin: true, name: "강성묵" }; 
  return UIHandler.마스터_대시보드_발송(마스터ID, 권한);
}

const UIHandler = {

  /**
   * 📱 1. 메인 리모컨 구성 (권한별 맞춤형 버튼)
   * 과장님 운영 지침: 관리자는 실무 중심(재고/안전), 오너는 경영 중심(자금)
   */
  메인_리모컨_구성: function(권한) {
    if (권한.isMaster) { // 오너(Master)용
      return {
        keyboard: [
          [{ text: "📊 출석체크" }, { text: "💰 자금/외상" }, { text: "📅 일정관리" }],
          [{ text: "🚜 현장관제" }, { text: "🚨 긴급싸이렌" }, { text: "📦 재고관리" }], 
          [{ text: "📢 전체공지" }, { text: "💬 직원소통" }, { text: "⚙️ 시스템설정" }],
          [{ text: "🏠 메인메뉴" }]
        ],
        resize_keyboard: true,
        input_field_placeholder: "🎤 보고할 내용이나 지시사항을 말씀하세요"
      };
    } else { // 관리자(과장님)용
      return {
        keyboard: [
          [{ text: "📊 출석체크" }, { text: "🚜 현장관제" }, { text: "📅 일정관리" }],
          [{ text: "📦 재고관리" }, { text: "🚨 긴급싸이렌" }, { text: "💬 직원소통" }], 
          [{ text: "📝 작업일지" }, { text: "🏠 메인메뉴" }]
        ],
        resize_keyboard: true,
        input_field_placeholder: "🎤 현장 상황이나 재고 변동을 말씀하세요"
      };
    }
  },

  /**
   * 💻 2. 마스터 통합 관제 대시보드 발송
   */
  마스터_대시보드_발송: function(채팅ID, 권한) {
    const 데이터 = this.대시보드_데이터_수집();

    let 메시지 = 
      "🏗️ <b>[2026 SMART FIELD ERP 관제]</b>\n" +
      "━━━━━━━━━━━━━━━\n" +
      "👤 <b>관리자:</b> " + 권한.name + " 과장님\n" +
      "🍎 <b>창고재고:</b> " + 데이터.창고현황 + "\n" +
      "📅 <b>오늘 일정:</b> " + 데이터.일정요약 + "\n";
    
    // 오너 권한일 때만 민감한 금전 데이터 표시
    if (권한.isMaster) {
      메시지 += "💰 <b>미결/외상:</b> " + 데이터.정산요약 + "\n";
    }

    메시지 += 
      "🚨 <b>안전/자재:</b> " + 데이터.이상징후 + "\n" +
      "━━━━━━━━━━━━━━━\n" +
      "📡 <b>시스템 상태:</b> 실시간 감시 중";

    const 인라인_버튼 = {
      inline_keyboard: [
        [{ text: "📊 실시간 통계 분석", callback_data: "통계_조회" }],
        [{ text: "📂 ERP 시트 바로가기", url: "https://docs.google.com/spreadsheets/d/" + CONFIG.SS_ID }]
      ]
    };

    Telegram.call('sendMessage', {
      chat_id: 채팅ID,
      text: 메시지,
      parse_mode: "HTML",
      reply_markup: 인라인_버튼
    });

    return Telegram.call('sendMessage', {
      chat_id: 채팅ID,
      text: "⌨️ <b>스마트 현장 리모컨이 활성화되었습니다.</b>",
      parse_mode: "HTML",
      reply_markup: this.메인_리모컨_구성(권한)
    });
  },

  /**
   * 📦 3. [재고관리] 입출고 및 실사 메뉴
   */
  재고_메뉴_표시: function(chatId) {
    const 데이터 = this.대시보드_데이터_수집();
    const 메시지 = 
      "📦 <b>[재고 및 자재 관리]</b>\n" +
      "━━━━━━━━━━━━━━━\n" +
      "🍎 <b>재고현황:</b> " + 데이터.창고현황 + "\n" +
      "⚠️ <b>부족알림:</b> " + 데이터.이상징후 + "\n" +
      "━━━━━━━━━━━━━━━\n" +
      "원하시는 작업을 선택하십시오.";

    const inline = {
      inline_keyboard: [
        [{ text: "📥 단순 입고 (수확/자재)", callback_data: "stock_in" }],
        [{ text: "📤 출고 (완성품/BOM적용)", callback_data: "stock_out_bom" }],
        [{ text: "🔄 위치이동/실사", callback_data: "stock_move" }, { text: "📊 상세현황", callback_data: "stock_status" }]
      ]
    };

    return Telegram.call('sendMessage', {
      chat_id: chatId,
      text: 메시지,
      parse_mode: "HTML",
      reply_markup: inline
    });
  },

  /**
   * 📤 4. [고속입력] 수량 퀵 선택 메뉴
   */
  고속_수량_메뉴: function(chatId, actionType, itemType) {
    const inline = {
      inline_keyboard: [
        [{ text: "1 팔레트", callback_data: actionType + "_PL_1_" + itemType }, { text: "5 팔레트", callback_data: actionType + "_PL_5_" + itemType }],
        [{ text: "1 트럭 (10PL)", callback_data: actionType + "_TR_1_" + itemType }, { text: "직접 입력", callback_data: actionType + "_manual_" + itemType }],
        [{ text: "⬅️ 메인으로", callback_data: "inventory_main" }]
      ]
    };

    return Telegram.call('sendMessage', {
      chat_id: chatId,
      text: "🔢 <b>[" + itemType + "]</b> 수량을 선택하세요.",
      parse_mode: "HTML",
      reply_markup: inline
    });
  },

  /**
   * 🚨 5. [긴급싸이렌/SOS] 관리 메뉴
   */
  안전_메뉴_표시: function(chatId) {
    const 메시지 = 
      "🚨 <b>[안전 및 SOS 관제]</b>\n" +
      "━━━━━━━━━━━━━━━\n" +
      "비상 상황 전파 및 SOS 요청 기록을 확인합니다.\n" +
      "━━━━━━━━━━━━━━━";

    const inline = {
      inline_keyboard: [
        [{ text: "📢 전체 긴급싸이렌 울리기", callback_data: "siren_all" }],
        [{ text: "🆘 실시간 SOS 현황", callback_data: "sos_status" }],
        [{ text: "🔄 안전점검 공지발송", callback_data: "safety_notice" }]
      ]
    };

    return Telegram.call('sendMessage', {
      chat_id: chatId,
      text: 메시지,
      parse_mode: "HTML",
      reply_markup: inline
    });
  },

  /**
   * 👷 6. 근로자 전용 메뉴 (SOS 버튼 최우선 배치)
   */
  근로자_메뉴_발송: function(채팅ID, 권한) {
    const 언어 = 권한.lang || "KO";
    const 라벨 = {
      "KO": { sos: "🆘 긴급 SOS (도움요청)", in: "📍 출근등록", out: "🏠 퇴근마감", navi: "🚗 현장 길찾기" },
      "VI": { sos: "🆘 Cấp cứu SOS", in: "📍 Điểm danh", out: "🏠 Kết thúc", navi: "🚗 Chỉ đường" },
      "TH": { sos: "🆘 ขอความช่วยเหลือ SOS", in: "📍 ลงชื่อเข้า", out: "🏠 เลิกงาน", navi: "🚗 นำทาง" },
      "KH": { sos: "🆘 សង្គ្រោះបន្ទាន់ SOS", in: "📍 ចុះឈ្មោះចូល", out: "🏠 បញ្จบ", navi: "🚗 នាំផ្លូវ" },
      "PH": { sos: "🆘 Emergency SOS", in: "📍 Check-in", out: "🏠 Check-out", navi: "🚗 Navigate" }
    };

    const p = 라벨[언어] || 라벨["KO"];

    const 인라인_버튼 = {
      inline_keyboard: [
        [{ text: p.sos, callback_data: "sos_request" }],
        [{ text: p.in, callback_data: "job_in" }, { text: p.out, callback_data: "job_out" }],
        [{ text: p.navi, callback_data: "find_my_site" }]
      ]
    };

    return Telegram.call('sendMessage', {
      chat_id: 채팅ID,
      text: "👷 <b>스마트 현장 근로자 메뉴</b>",
      parse_mode: "HTML",
      reply_markup: 인라인_버튼
    });
  },

  /**
   * 📊 7. 대시보드 데이터 수집 (지능형 항목 매칭 방식)
   * A열의 항목명을 찾아 B열의 값을 가져오므로 줄 순서가 바뀌어도 안전합니다.
   */
  대시보드_데이터_수집: function() {
    const 결과 = { 
      창고현황: "데이터 없음", 일정요약: "일정없음", 이상징후: "정상",
      출석요약: "0명", 정산요약: "0원", 현장요약: "없음",
      갱신시간: Utilities.formatDate(new Date(), "GMT+9", "HH:mm:ss")
    };

    try {
      const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
      const 봇시트 = ss.getSheetByName(CONFIG.SHEETS.BOT_DB);

      if (봇시트) {
        const 데이터범위 = 봇시트.getRange("A1:B15").getValues();
        
        데이터범위.forEach(row => {
          const 항목명 = String(row[0]).trim();
          const 값 = String(row[1]).trim();
          const isValid = (v) => v && v !== "null" && v !== "undefined" && v.indexOf("#") === -1;

          if (항목명.includes("일정관리")) 결과.일정요약 = isValid(값) ? 값 : "일정없음";
          if (항목명.includes("재고") || 항목명.includes("창고")) 결과.창고현황 = isValid(값) ? 값 : "데이터 없음";
          if (항목명.includes("출석")) 결과.출석요약 = isValid(값) ? 값 : "0명";
          if (항목명.includes("정산") || 항목명.includes("자금")) 결과.정산요약 = isValid(값) ? 값 : "0원";
          if (항목명.includes("이상") || 항목명.includes("자재부족")) 결과.이상징후 = isValid(값) ? 값 : "정상";
          if (항목명.includes("현장")) 결과.현장요약 = isValid(값) ? 값 : "없음";
        });
      }
    } catch (e) {
      console.error("데이터 수집 오류: " + e.toString());
    }
    return 결과;
  }
};