/**
 * [모듈 02] 02_Finance.gs
 * 프로젝트: 2026 Smart Field ERP (AI 비서 통합형)
 * 역할: 지출 영수증 처리, 현장 성격 결정(자체/파견), 정산 금액 산출 및 '단가 고정' 장부 기록
 * 최종 업데이트: 2026-02-16
 * 수정자: Gemini (강성묵 과장 시스템 설계 최종 합의안 반영 - 버튼 직렬화 오염 제거)
 */

/**
 * 📸 1. 영수증 사진 처리 및 지출 청구
 */
function handleExpense(chatId, photoArray) {
  const admin = getAdminInfo(chatId); 
  if (!admin) {
    Telegram.sendMessage(chatId, "⚠️ 관리자 권한이 확인되지 않습니다.");
    return;
  }

  const allowedTitles = ["대표", "오너", "이사", "과장", "마스터"];
  const hasAuth = allowedTitles.some(t => admin.title.includes(t));
  if (!hasAuth) {
    Telegram.sendMessage(chatId, "⚠️ 지출 청구 권한이 없습니다.");
    return;
  }

  Telegram.sendMessage(chatId, "⏳ 영수증 분석 및 업로드 중입니다...");

  const fileId = photoArray[photoArray.length - 1].file_id;
  let photoUrl = "";
  try {
    const fileInfo = Telegram.call('getFile', { file_id: fileId });
    if (fileInfo && fileInfo.result) {
      photoUrl = `https://api.telegram.org/file/bot${CONFIG.BOT_TOKEN}/${fileInfo.result.file_path}`;
    }
  } catch(e) { photoUrl = "URL 생성 실패"; }
  
  saveExpenseLog(admin, photoUrl);
  Telegram.sendMessage(chatId, `✅ 영수증이 접수되었습니다.\n오너 승인 후 최종 반영됩니다.`);
  
  const ownerMsg = `💰 <b>[지출 승인 요청]</b>\n━━━━━━━━━━━━━━━\n` +
                   `👤 청구자: ${admin.title} ${admin.name}\n` +
                   `📂 항목: 현장 경비\n` +
                   `━━━━━━━━━━━━━━━\n승인 여부를 선택하세요.`;
                   
  const ownerButtons = {
    inline_keyboard: [[
      { text: "✅ 승인", callback_data: `exp_auth_ok_${chatId}` },
      { text: "❌ 거절", callback_data: `exp_auth_no_${chatId}` }
    ]]
  };
  notifyOwnersWithPhoto(ownerMsg, fileId, ownerButtons);
}

function saveExpenseLog(adminInfo, photoUrl) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEETS.EXPENSE);
  if (!sheet) return;
  
  sheet.appendRow([
    new Date(), 
    "현장지출", 
    0, 
    photoUrl, 
    "오너대기", 
    `${adminInfo.title} ${adminInfo.name}`
  ]);
}

/**
 * 오너/대표 권한자에게 사진과 함께 인터랙티브 승인 버튼 전송
 */
function notifyOwnersWithPhoto(text, fileId, buttons) {
  const adminSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEETS.ADMINS);
  if (!adminSheet) return;
  const adminData = adminSheet.getDataRange().getValues();
  
  for(let i = 1; i < adminData.length; i++) {
    const adminChatId = adminData[i][CONFIG.COL.A_ID];
    if (!adminChatId) continue;

    const role = getUserRole(adminChatId); 
    
    if (role.isOwner && role.payAlert) {
      // 🚀 교정: 00번 통신 엔진 규격에 맞춰 JSON.stringify 제거 후 객체로 전달
      Telegram.call('sendPhoto', { 
        chat_id: String(adminChatId), 
        photo: fileId, 
        caption: text, 
        parse_mode: 'HTML', 
        reply_markup: buttons 
      });
    }
  }
}

/**
 * 💰 2. 정산 로직 (기록 시점의 단가를 Snapshot으로 고정)
 */
const Settlement = {
  prepareFinalCheck: function(chatId, siteName) {
    const cache = CacheService.getUserCache();
    const dateStr = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd");
    const counts = this.countWorkersAtSite(siteName, dateStr);
    
    const sData = { siteName: siteName, date: dateStr, male: counts.male, female: counts.female, type: 'MAIN' };
    cache.put("SETTLE_DATA_" + chatId, JSON.stringify(sData), 3600);
    
    const msg = `<b>[ 📊 정산 기초 확인 ]</b>\n━━━━━━━━━━━━━━━\n` +
                `📍 현장: <b>${siteName}</b>\n` +
                `👥 인원: 남 ${counts.male} / 여 ${counts.female}\n\n` +
                `현장 성격을 선택하세요. 단가가 다르게 적용됩니다.`;

    const buttons = {
      inline_keyboard: [
        [{ text: "🏠 자체농사", callback_data: `settle_set_type_MAIN` },
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

    const typeLabel = (sData.type === 'DISP') ? "🚚 외부파견" : "🏠 자체작업";
    const msg = `<b>[ 💰 정산 내역 요약 ]</b>\n━━━━━━━━━━━━━━━\n` +
                `📍 현장: ${sData.siteName}\n` +
                `🚩 구분: ${typeLabel}\n` +
                `💸 단가: 남 ${currentMRate.toLocaleString()} / 여 ${currentFRate.toLocaleString()}\n` +
                `💰 <b>총액: ${sData.totalAmount.toLocaleString()}원</b>\n━━━━━━━━━━━━━━━\n` +
                `※ 확인 클릭 시 이 단가로 장부에 영구 고정됩니다.`;
                
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
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEETS.REVENUE);
    if (!sheet) return;

    sheet.appendRow([
      new Date(),
      sData.siteName,
      sData.male,
      sData.female,
      sData.totalAmount, 
      "정산완료",
      (sData.type === 'DISP') ? "외주파견" : "자체작업",
      `단가고정 - 남:${sData.mRateSnapshot.toLocaleString()}, 여:${sData.fRateSnapshot.toLocaleString()}`
    ]);

    Telegram.sendMessage(chatId, "✅ 정산장부 기록 완료. 과거 단가 소급 적용 걱정 없이 보존됩니다.");
    cache.remove("SETTLE_DATA_" + chatId);
  },

  countWorkersAtSite: function(siteName, dateStr) {
    const logSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEETS.LOG);
    if (!logSheet) return { male: 0, female: 0 };

    const data = logSheet.getDataRange().getValues();
    const c = CONFIG.COL;
    let male = 0, female = 0;

    for (let i = 1; i < data.length; i++) {
      const rowDate = (data[i][c.L_DATE] instanceof Date) ? 
                      Utilities.formatDate(data[i][c.L_DATE], "GMT+9", "yyyy-MM-dd") : String(data[i][c.L_DATE]);
      
      if (rowDate === dateStr && data[i][c.L_SITE] === siteName) {
        const nation = String(data[i][c.L_NATION]);
        if (nation.includes("_M") || nation.includes("남")) male++; 
        else female++;
      }
    }
    return { male: male, female: female };
  }
};

function getPaySetting(key) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEETS.SETTINGS);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]).trim() === key) return data[i][2];
    }
  } catch (e) { return 0; }
  return 0;
}