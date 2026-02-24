/**
 * 2026 Smart Field ERP - 24_FIN_ID_Generator
 * [수정 이력] 2026-02-21: 지출(LAB) 및 수입(OUT) 통합 ID 생성 로직 확정
 * [작동 원리]
 * 1. 외부인력정산(D열) 또는 파견인력매출(B열) 입력 감지 시 작동
 * 2. 시트별 접두어(LAB/OUT) 분리 및 날짜-순번(Sequential) 기반 생성
 * 3. 중복 방지 및 이미 생성된 ID 수정 방지 로직 적용
 */

function onEdit(e) {
  // 1. 이벤트 객체 안전성 검사
  if (!e) return;
  
  const ss = e.source;
  const sheet = ss.getActiveSheet();
  const range = e.range;
  const sheetName = sheet.getName();
  
  const row = range.getRow();
  const col = range.getColumn();
  
  // 제목행(1행) 제외
  if (row <= 1) return;

  let prefix = "";
  let targetCol = 0;

  // 2. 시트별 감시 대상 및 접두어 설정
  if (sheetName === "외부인력정산") {
    prefix = "LAB";
    targetCol = 4; // D열: 성명/업체명
  } else if (sheetName === "파견인력매출") {
    prefix = "OUT";
    targetCol = 2; // B열: 거래처
  } else {
    return; // 감시 대상 시트가 아니면 종료
  }

  // 설정된 대상 열 입력이 아니면 종료
  if (col !== targetCol) return;

  const idCell = sheet.getRange(row, 1); // A열 (ID 열)

  // 3. 데이터 무결성 보호: 이미 ID가 있는 경우 새로 생성하지 않음 (수정 방지)
  if (idCell.getValue() !== "") return;

  try {
    // 4. 오늘 날짜 및 순번 계산 준비
    const today = Utilities.formatDate(new Date(), "GMT+9", "yyyyMMdd");
    const lastRow = sheet.getLastRow();
    let sequence = 1;

    // 5. 기존 ID 목록 전수 조사하여 다음 순번 결정
    if (lastRow > 1) {
      // A2부터 데이터가 있는 마지막 행까지의 ID 값들을 가져옴
      const idValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
      
      idValues.forEach(id => {
        if (id && typeof id === "string" && id.includes(today) && id.startsWith(prefix)) {
          const parts = id.split("-");
          // ID 규격(PREFIX-YYYYMMDD-NNN) 확인
          if (parts.length === 3) {
            const num = Number(parts[2]); // 마지막 순번 추출
            if (!isNaN(num) && num >= sequence) {
              sequence = num + 1;
            }
          }
        }
      });
    }

    // 6. 최종 고유 ID 생성 (3자리 패딩 적용)
    const newId = prefix + "-" + today + "-" + String(sequence).padStart(3, "0");
    
    // 7. 시트 A열에 고유 ID 기록
    idCell.setValue(newId);
    
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.error("24_FIN_ID_Generator Error: " + err.toString());
    }
  }
}