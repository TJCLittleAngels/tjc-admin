// plugins/slc.js
import { PluginBase } from "./base.js";

export class SlcPlugin extends PluginBase {
  id = "slc";
  label = "雙連教會";
  namespace = "sltjc";
  passcode = "slc-2026"; // ← 需要進入碼就打開這行（可改字串）
  defaultUrl =
    "https://docs.google.com/spreadsheets/d/1pt1x6NrIFwlZJ6RrreRIpxzI_jNQiUwl9qpo0dD06Y8/edit?gid=42274030#gid=42274030"; // ← 有預設網址就填
  expectedTableCount = 4; // ← 若有效表格數量與通用不同就解註並調整

  // ====== [前處理]：影音控制/接待/炊事/餐廳整理補格 ======
  preprocess(csv2d, ctx) {
    let activityFilled = false; // 追蹤「活動」是否已經補過
    let responsibleReplaced = false; // 追蹤「負責」是否已經替換過
    let readingReplaced = false; // 追蹤「讀經」是否已經替換過
    let prayerReplaced = false; // 追蹤「禱告」是否已經替換過

    const filled = csv2d.map((row) => {
      const arr = [...row];

      // 文字替換：負責、讀經、禱告（只發生一次，重複出現要示警）
      for (let i = 0; i < arr.length; i++) {
        const cell = String(arr[i] ?? "").trim();

        if (cell === "負責") {
          if (responsibleReplaced) {
            alert("警告：「負責」出現兩次或以上，請檢查資料！");
          } else {
            arr[i] = "安息日會後報告負責";
            responsibleReplaced = true;
          }
        } else if (cell === "讀經") {
          if (readingReplaced) {
            alert("警告：「讀經」出現兩次或以上，請檢查資料！");
          } else {
            arr[i] = "讀經團契";
            readingReplaced = true;
          }
        } else if (cell === "禱告") {
          if (prayerReplaced) {
            alert("警告：「禱告」出現兩次或以上，請檢查資料！");
          } else {
            arr[i] = "禱告團契";
            prayerReplaced = true;
          }
        }
      }

      // 檢查任何一行是否出現「日期、時間、活動」模式，且尚未補過
      if (!activityFilled && arr.length >= 4) {
        for (let i = 0; i <= arr.length - 4; i++) {
          const col0 = String(arr[i] ?? "").trim();
          const col1 = String(arr[i + 1] ?? "").trim();
          const col2 = String(arr[i + 2] ?? "").trim();
          const col3 = String(arr[i + 3] ?? "").trim();

          if (col0 === "日期" && col1 === "時間" && col2 === "活動") {
            // 如果「活動」後面一格是空的，就補上「活動」
            if (col3 === "" || col3 === "-") {
              arr[i + 3] = "活動";
              activityFilled = true; // 標記已補過，之後不再補
              break; // 找到就停止檢查這一行
            }
          }
        }
      }

      for (let i = 0; i < arr.length - 1; i++) {
        const cur = String(arr[i] ?? "").trim();
        const next = String(arr[i + 1] ?? "").trim();

        // 影音控制、1樓接待、2樓接待：往後補1次
        if (
          (cur === "影音控制" || cur === "1樓接待" || cur === "2樓接待") &&
          (next === "" || next === "-")
        ) {
          arr[i + 1] = cur;
        }

        // 午餐炊事：往後補3次（只補連續的空格，遇到非空就停止）
        if (cur === "午餐炊事") {
          for (let offset = 1; offset <= 3; offset++) {
            if (i + offset < arr.length) {
              const nextVal = String(arr[i + offset] ?? "").trim();
              if (nextVal === "" || nextVal === "-") {
                arr[i + offset] = "午餐炊事";
              } else {
                // 遇到非空值就停止，不再繼續補
                break;
              }
            }
          }
        }

        // 晚餐炊事：往後補3次（只補連續的空格，遇到非空就停止）
        if (cur === "晚餐炊事") {
          for (let offset = 1; offset <= 3; offset++) {
            if (i + offset < arr.length) {
              const nextVal = String(arr[i + offset] ?? "").trim();
              if (nextVal === "" || nextVal === "-") {
                arr[i + offset] = "晚餐炊事";
              } else {
                // 遇到非空值就停止，不再繼續補
                break;
              }
            }
          }
        }

        // 餐廳整理：往後補1次
        if (cur === "餐廳整理" && (next === "" || next === "-")) {
          arr[i + 1] = cur;
        }
      }
      return arr;
    });
    return { csv2d: filled, hints: {} };
  }

  // 如需客製邏輯可視需要覆寫以下方法（先沿用通用行為即可）：
  // nameSplitter(text) { return super.nameSplitter(text); }
  // validate({ validTables }) { return super.validate({ validTables }); }

  // ====== [後處理]：處理「翻譯/詩頌」工作，依星期時段判斷 ======
  postprocess(sheet, ctx) {
    for (const person in sheet) {
      for (const job of sheet[person]) {
        if (job.task === "翻譯/詩頌") {
          const timeSlot = String(job.timeSlot ?? "").trim();

          // 如果是「三」或「四」，改為「詩頌」
          if (timeSlot === "三" || timeSlot === "四") {
            job.task = "詩頌";
          }
          // 如果是「六上」或「六下」，改為「翻譯」
          else if (timeSlot === "六上" || timeSlot === "六下") {
            job.task = "翻譯";
          }
          // 都沒對應到，跳出示警並保持原樣
          else {
            alert(
              `警告：發現「翻譯/詩頌」工作，但星期時段「${timeSlot}」無法對應。\n` +
                `人員：${person}，日期：${job.date}，時段：${timeSlot}\n` +
                `請檢查資料！`
            );
            // 保持原樣，不做修改
          }
        }
      }
    }
    return sheet;
  }
}
