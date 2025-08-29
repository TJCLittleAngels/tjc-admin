import { PluginBase } from "./base.js";

export class JgcPlugin extends PluginBase {
  id = "jgc";
  label = "莒光教會";
  namespace = "jgtjc"; // ====== [上傳路徑] 覆蓋 namespace ======
  passcode = "jgc-2025"; // ← 你想要的簡單密碼（前端曝光可接受）
  defaultUrl =
    "https://docs.google.com/spreadsheets/d/1Nq0bEIs905vg_KPralAU5lLjT1XTdabW/edit?gid=1901547883#gid=1901547883";
  expectedTableCount = 2;

  // ====== [前處理]：接待人員/炊事補格 + 自動帶入民國年轉西元 yyyymm（回傳 hints.month）======
  preprocess(csv2d, ctx) {
    const filled = csv2d.map((row) => {
      const arr = [...row];
      for (let i = 0; i < arr.length - 1; i++) {
        const cur = String(arr[i] ?? "").trim();
        const next = String(arr[i + 1] ?? "").trim();
        if (cur === "接待人員" && (next === "" || next === "-"))
          arr[i + 1] = "接待人員";
        if (cur === "炊事") {
          if (
            (arr[i + 1] ?? "").trim() === "" ||
            (arr[i + 1] ?? "").trim() === "-"
          )
            arr[i + 1] = "炊事";
          if (
            (arr[i + 2] ?? "").trim() === "" ||
            (arr[i + 2] ?? "").trim() === "-"
          )
            arr[i + 2] = "炊事";
        }
      }
      return arr;
    });

    // 自動抓「民國年xx月」轉西元
    let hintedMonth = null;
    outer: for (const row of filled) {
      for (const cell of row) {
        const s = String(cell ?? "");
        const m = s.match(/(\d{3,4})年(\d{1,2})月/);
        if (m) {
          const west = (parseInt(m[1], 10) + 1911).toString();
          hintedMonth = `${west}${m[2].padStart(2, "0")}`;
          break outer;
        }
      }
    }
    if (hintedMonth && ctx?.setMonthInput) ctx.setMonthInput(hintedMonth); // 提供 UI 回填（可選）

    return { csv2d: filled, hints: { month: hintedMonth } };
  }

  // ====== [中處理]：JGC 名字切分（兩個漢字中間一個空格視為單一人名）======
  nameSplitter(text) {
    let s = String(text ?? "")
      .trim()
      .replace(/\s+/g, " ");
    const twoHanOneSpace = /^[\p{Script=Han}]\s[\p{Script=Han}]$/u;
    if (twoHanOneSpace.test(s)) return [s.replace(" ", "")];
    return s
      .split(/[∣\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  // ====== [有效表格數量]：JGC 強化版（會回錯誤字串）======
  validate({ validTables }) {
    const errs = super.validate({ validTables });
    if (validTables.length !== this.expectedTableCount) {
      errs.push(
        `（JGC）有效安排表必須為 ${this.expectedTableCount} 份，請檢查原始試算表。`
      );
    }
    return errs;
  }

  // ====== [後處理]：把「環境清潔」補上同日的「清掃區域：成員名單」======
  postprocess(sheet, ctx) {
    const byDateAreas = {};
    for (const person in sheet) {
      for (const job of sheet[person]) {
        if (job.task === "清掃區域") {
          if (!byDateAreas[job.date]) byDateAreas[job.date] = [];
          byDateAreas[job.date].push(person);
        }
      }
    }
    for (const person in sheet) {
      for (const job of sheet[person]) {
        if (job.task === "環境清潔" && byDateAreas[job.date]?.length) {
          job.task = `環境清潔-區域：${byDateAreas[job.date].join("、")}`;
        }
      }
    }
    return sheet;
  }
}
