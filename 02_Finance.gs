/**
 * [모듈 02] 02_Finance.gs
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: 지출 처리, 정산 금액 산출 및 '단가 고정' 장부 기록 엔진
 * 최종 업데이트: 2026-02-24 (수당설정 연동 및 단가 스냅샷 고정 반영)
 */

/**
 * 📸 1. 영수증 사진 처리
 */
function handleExpense(chatId, photoArray) {
  const role = getUserRole(chatId); 
  if (!role.isAdmin && !role.isOwner && !role.isMaster) {
    return Telegram.sendMessage(chatId, "⚠️ 지출 청구 권한이 없습니다.");
  }

  const fileId = photoArray[photoArray.length - 1].file_id;
  if (typeof startExpenseRequest === 'function') {
    CacheService.getUserCache().put("TEMP_EXP_PHOTO_" + chatId, fileId, 600);
    return startExpenseRequest(chatId);
  }
}

/**
 * 💰 2. 정산 로직
 */
const Settlement = {
  prepareFinalCheck: function(chatId, siteName) {
    const cache = CacheService.getUserCache();
    const dateStr = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd");
    const counts = this.countWorkersAtSite(siteName, dateStr);
    
    const sData = { siteName: siteName, date: dateStr, male: counts.male, female: counts.female, type: 'MAIN' };
    cache.put("SETTLE_DATA_" + chatId, JSON.stringify(sData), 3600);
    
    const msg = `<b>[ 📊 ${siteName} 정산 확인 ]</b>\n━━━━━━━━━━━━━━━\n` +
                `👥 인원: 남 ${counts.male} / 여 ${counts.female}\n\n` +
                `현장 성격을 선택하세요. 단가가 적용됩니다.`;

    const buttons = {
      inline_keyboard: [
        [{ text: "🏠 자체작업", callback_data: `settle_set_type_MAIN` },
         { text: "🚚 외부파견", callback_data: `settle_set_type_DISP` }],
        [{ text: "🏠 메인메뉴", callback_data: "go_main" }]
      ]
    };
    return Telegram.sendMessage(chatId, msg, { reply_markup: buttons });
  },

  showSettleSummary: function(chatId, sData) {
    const mRateKey = (sData.type === 'DISP') ? "남성_파견단가" : "남성_기본단가";
    const fRateKey = (sData.type === 'DISP') ? "여성_파견단가" : "여성_기본단가";
    
    const currentMRate = Number(getPaySetting(mRateKey)) || 0;
    const currentFRate = Number(getPaySetting(fRateKey)) || 0;
    
    sData.mRateSnapshot = currentMRate; 
    sData.fRateSnapshot = currentFRate;
    sData.totalAmount = (sData.male * currentMRate) + (sData.female * currentFRate);
    
    CacheService.getUserCache().put("SETTLE_DATA_" + chatId, JSON.stringify(sData), 3600);

    const msg = `<b>[ 💰 정산 내역 요약 ]</b>\n━━━━━━━━━━━━━━━\n` +
                `📍 현장: ${sData.siteName}\n` +
                `💸 단가: 남 ${currentMRate.toLocaleString()} / 여 ${currentFRate.toLocaleString()}\n` +
                `💰 <b>총액: ${sData.totalAmount.toLocaleString()}원</b>\n━━━━━━━━━━━━━━━\n` +
                `※ 확인 시 위 단가로 장부에 고정됩니다.`;
                
    const buttons = {
      inline_keyboard: [[{ text: "✅ 장부 기록 (단가고정)", callback_data: "settle_final_confirm" }]]
    };
    return Telegram.sendMessage(chatId, msg, { reply_markup: buttons });
  },

  finalCommitToSheet: function(chatId) {
    const cache = CacheService.getUserCache();
    const raw = cache.get("SETTLE_DATA_" + chatId);
    if (!raw) return;

    const sData = JSON.parse(raw);
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEETS.REVENUE);
    if (!sheet) return;

    sheet.appendRow([
      new Date(), sData.siteName, sData.male, sData.female, sData.totalAmount, 
      "정산완료", (sData.type === 'DISP') ? "외주파견" : "자체작업",
      `단가고정 - 남:${sData.mRateSnapshot}, 여:${sData.fRateSnapshot}`
    ]);

    Telegram.sendMessage(chatId, "✅ 정산장부 기록 완료.");
    if (typeof logToNaturalLanguage === 'function') logToNaturalLanguage(chatId, "정산마감", sData.siteName);
    cache.remove("SETTLE_DATA_" + chatId);
  },

  countWorkersAtSite: function(siteName, dateStr) {
    const logSheet = SpreadsheetApp.openById(CONFIG.SS_ID).getSheetByName(CONFIG.SHEETS.LOG);
    if (!logSheet) return { male: 0, female: 0 };
    const data = logSheet.getDataRange().getValues();
    let male = 0, female = 0;
    for (let i = 1; i < data.length; i++) {
      if (Utilities.formatDate(new Date(data[i][0]), "GMT+9", "yyyy-MM-dd") === dateStr && data[i][4] === siteName) {
        if (String(data[i][3]).includes("남")) male++; else female++;
      }
    }
    return { male: male, female: female };
  }
};

function getPaySetting(key) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    const sheet = ss.getSheetByName("수당설정");
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]).trim() === key) return data[i][2];
    }
  } catch (e) { return 0; }
  return 0;
}