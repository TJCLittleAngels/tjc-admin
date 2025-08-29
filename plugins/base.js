export class PluginBase {
  // ====== [上傳路徑] 預設到 test 命名空間 ======
  id = "generic";
  label = "通用（測試）";
  namespace = "test";
  passcode = ""; // ← 預設不需要密碼

  // ====== [預設網址] Google 試算表預設網址 ======
  defaultUrl =
    "https://docs.google.com/spreadsheets/d/11aEzpISqIUOi6MiuETyPJ_fx5y4OWZhtH8BMQ0x9EWc/edit?gid=139917179#gid=139917179";

  // ====== [表格數量] 建議的有效安排表數量 ======
  expectedTableCount = 7;
  get paths() {
    return {
      scheduleData: (m) => `line/schedule/${this.namespace}/${m}`,
      scheduleImage: (m) =>
        `line/schedule/${this.namespace}/schedule_image/${m}`,
      classImage: (cls) => `line/schedule/${this.namespace}/class/${cls}`,
    };
  }

  // 提供 namespace setter，方便測試時切換
  setNamespace(ns) {
    this.namespace = ns;
  }

  // ====== [前處理]：CSV 進來後、任何切表前，可微調原始 csv2d ======
  // return { csv2d, hints }
  preprocess(csv2d, ctx) {
    return { csv2d, hints: {} }; // no-op
  }

  // ====== [中處理]：針對「已切出來的有效表格」做欄位補值/標頭整併等 ======
  // input: validTables (Array<table>)
  // output: finalTables (Array<table>)
  normalizeTables(validTables, ctx) {
    // 預設提供「六下/會後報告/標頭補值/移除換行」通用版
    const fillDateAndSixDown = (table) => {
      // 表頭兩行併入
      if (table.length >= 2 && (table[1][0] ?? "").trim() === "") {
        const second = table[1];
        for (let c = 0; c < second.length; c++) {
          const v = (second[c] ?? "").trim();
          if (v) table[0][c] = table[0][c] ? table[0][c].trim() + "/" + v : v;
        }
        table.splice(1, 1);
      }
      // 標頭補值
      if (table.length) {
        for (let c = 1; c < table[0].length; c++) {
          if (!table[0][c] || table[0][c].trim() === "")
            table[0][c] = table[0][c - 1];
        }
      }
      // 日期/六下補值
      for (let r = 1; r < table.length; r++) {
        const row = table[r];
        const prev = table[r - 1];
        if (
          (!row[0] || row[0].trim() === "") &&
          prev[0] &&
          !isNaN(prev[0].trim())
        ) {
          row[0] = prev[0];
        }
        if (row[1] && row[1].trim() === "六下") {
          if (!row[2] || row[2].trim() === "") {
            if (prev[2] && prev[2].trim() !== "") row[2] = prev[2];
          }
        }
      }
      // 移除換行
      for (let i = 0; i < table.length; i++) {
        for (let j = 0; j < table[i].length; j++) {
          table[i][j] = String(table[i][j] ?? "").replace(/\n\s*/g, "");
        }
      }
      // 會後報告的縱向補值
      if ((table[0][1] ?? "").replace("\n", "") === "會後報告") {
        for (let r = 1; r < table.length; r++) {
          if (!table[r][1] || table[r][1].trim() === "") {
            table[r][1] = table[r - 1][1] || "";
          }
        }
      }
      return table;
    };

    return validTables.map((t) => fillDateAndSixDown(t));
  }

  // ====== [中處理]：名字切分策略（對 tablesToWork 使用）======
  nameSplitter(text) {
    // 預設：空白/豎線皆可，移除多餘空白
    return String(text ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .split(/[∣\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // ====== [中處理]：從表頭抓 yyyy年mm月，抓不到就回 null ======
  extractYearMonthFromHeaderRow(headerRow) {
    const cell = String(headerRow?.[0] ?? "");
    // 先抓西元
    let m = cell.match(/(\d{4})年(\d{1,2})月/);
    if (m) return { year: m[1], month: m[2].padStart(2, "0") };
    // 再嘗試民國
    m = cell.match(/(\d{3})年(\d{1,2})月/);
    if (m) {
      const westYear = (parseInt(m[1], 10) + 1911).toString();
      return { year: westYear, month: m[2].padStart(2, "0") };
    }
    return null;
  }

  // ====== [有效表格數量]：預設警告（不阻擋）======
  // 回傳陣列 errors（字串訊息），空陣列代表沒意見
  validate({ validTables }) {
    const errors = [];
    if (validTables.length !== this.expectedTableCount) {
      errors.push(
        `有效安排表建議為 ${this.expectedTableCount} 份，當前為 ${validTables.length} 份。`
      );
    }
    return errors;
  }

  // ====== [後處理]：已經轉成 { person: [{date,timeSlot,task}, ...] } 後可再調整 ======
  postprocess(finalTransformedSheet, ctx) {
    return finalTransformedSheet; // no-op
  }
}
