      /*******************************************************
       * 1. Firebase 初始化 (請換成你自己的 Firebase config)
       *******************************************************/
      const firebaseConfig = {
        apiKey: "AIzaSyCGAdNce7wCJLPmqPZ4ID3PxvBDFDD8uSY",
        authDomain: "tjc-tw.firebaseapp.com",
        databaseURL:
          "https://tjc-tw-default-rtdb.asia-southeast1.firebasedatabase.app",
        projectId: "tjc-tw",
        storageBucket: "tjc-tw.firebasestorage.app",
        messagingSenderId: "857954351277",
        appId: "1:857954351277:web:448c392836ef137e44ee24",
        measurementId: "G-Y3T47ZWQCB",
      };
      firebase.initializeApp(firebaseConfig);
      const database = firebase.database();
      const storage = firebase.storage();

      // 供 plugin [前處理] 填回月份用（可選）
      function setMonthInput(val) {
        const el = document.getElementById("monthInput");
        if (el && val) el.value = val;
      }

      /*******************************************************
       * 靈恩佈道會相關工具函式
       *******************************************************/
      // 從 plugin 的 scheduleImage 路徑回推出根 base，確保與 class 同層
      function getPluginRootBase() {
        const plugin = window.__PLUGIN__;
        if (!plugin?.paths?.scheduleImage) return "line/schedule/jgtjc";
        const ex = plugin.paths.scheduleImage("209901");
        const m = ex.match(/^(.*)\/schedule_image\/[^/]+$/);
        return m ? m[1] : "line/schedule/jgtjc";
      }

      // DB：固定寫在 .../evangelistic（不分年）
      function getEvangelisticDbPath() {
        return `${getPluginRootBase()}/evangelistic`;
      }

      // Storage：自訂一個目錄，方便管理（不影響 DB 結構）
      function getEvangelisticStoragePath(file) {
        const ts = Date.now();
        const ext = (file?.name?.split(".").pop() || "jpg").toLowerCase();
        const year = new Date().getFullYear();
        return `public/evangelistic/${year}/${year}-${ts}.${ext}`;
      }

      // 產生 YYYYMM 選項（-3 ~ +6 月，與你現有一致）
      function populateYearMonthSelect(selectEl, baseDate = new Date()) {
        if (!selectEl) return;
        selectEl.innerHTML = "";
        for (let i = -3; i <= 6; i++) {
          const d = new Date(
            baseDate.getFullYear(),
            baseDate.getMonth() + i,
            1
          );
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, "0");
          const yyyymm = `${y}${m}`;
          const opt = document.createElement("option");
          opt.value = yyyymm;
          opt.textContent = `${y}年${m}月 (${yyyymm})`;
          if (i === 0) opt.selected = true;
          selectEl.appendChild(opt);
        }
      }

      // 讀取 UI：若勾選跨月→自動加入起始月的「下一個月」
      function getEvangelisticMonthsFromUI() {
        const start = document.getElementById("evgMonthStart").value;
        const cross = document.getElementById("evgCrossMonth").checked;
        const months = [];
        if (start) {
          months.push(start);
          if (cross) {
            const y = parseInt(start.slice(0, 4), 10);
            const m = parseInt(start.slice(4), 10);
            const ny = m === 12 ? y + 1 : y;
            const nm = m === 12 ? 1 : m + 1;
            months.push(`${ny}${String(nm).padStart(2, "0")}`);
          }
        }
        return months;
      }

      /*******************************************************
       * 2. 解析 Google 試算表網址，取得 sheetId 與 gid
       *******************************************************/
      function parseSpreadsheetUrl(url) {
        let sheetId = "";
        let gid = "";
        const idMatch = url.match(/\/d\/([^/]+)/);
        if (idMatch && idMatch[1]) {
          sheetId = idMatch[1];
        }
        const gidMatch = url.match(/gid=([^&]+)/);
        if (gidMatch && gidMatch[1]) {
          gid = gidMatch[1];
        }
        return { sheetId, gid };
      }

      // ===== 原本你的工具函式（splitTablesByEmptyRowsAndColumns / splitTablesByDateKeyword / getWeekdayFromDate 等）都可原封不動放這裡 =====

      /*******************************************************
       * 3. 依水平空白行、垂直空白欄切割 CSV
       *******************************************************/
      function splitTablesByEmptyRowsAndColumns(csvData) {
        // 1) 水平空白行
        const blocks = [];
        let currentBlock = [];
        csvData.forEach((row) => {
          const isRowEmpty = row.every((cell) => cell.trim() === "");
          if (isRowEmpty) {
            if (currentBlock.length > 0) {
              blocks.push(currentBlock);
              currentBlock = [];
            }
          } else {
            currentBlock.push(row);
          }
        });
        if (currentBlock.length > 0) {
          blocks.push(currentBlock);
        }

        // 2) 垂直空白欄
        const tables = [];
        blocks.forEach((block) => {
          const maxColumns = block.reduce(
            (max, row) => Math.max(max, row.length),
            0
          );
          let boundary = -1;
          for (let col = 1; col < maxColumns - 1; col++) {
            let emptyCount = 0;
            block.forEach((row) => {
              if (!row[col] || row[col].trim() === "") {
                emptyCount++;
              }
            });
            const threshold = Math.ceil(block.length * 1);
            if (emptyCount >= threshold) {
              boundary = col;
              break;
            }
          }
          if (boundary === -1) {
            tables.push(block);
          } else {
            const leftTable = block.map((row) => row.slice(0, boundary));
            const rightTable = block.map((row) => row.slice(boundary));
            tables.push(leftTable, rightTable);
          }
        });

        console.log("分區後的結果：", tables);
        return tables;
      }

      /*******************************************************
       * 4. 依「日期/星期」關鍵字進一步分割（含日期模式的首欄檢查）
       *******************************************************/
      function splitTablesByDateKeyword(tableBlocks) {
        const finalSubTables = [];

        const isDateHeaderRow = (row) =>
          row.some((cell) => String(cell ?? "").includes("日期"));
        const isWeekHeaderRow = (row) =>
          row.some((cell) => String(cell ?? "").includes("星期"));
        const hasHeader = (row) => isDateHeaderRow(row) || isWeekHeaderRow(row);
        const isRowEmpty = (row) =>
          row.every((cell) => String(cell ?? "").trim() === "");
        const firstCellIsNumberOrEmpty = (row) => {
          const t = String(row?.[0] ?? "").trim();
          return t === "" || /\d/.test(t); // 空字串或含任一數字
        };

        tableBlocks.forEach((block) => {
          // 若第一欄全空，移除第一欄（保留原有行為）
          if (block.every((row) => String(row[0] ?? "").trim() === "")) {
            block.forEach((row) => row.shift());
          }

          let subTables = [];
          let currentSubTable = [];
          let emptyLineCount = 0;
          let inSubTable = false;
          let currentMode = null; // 'date' | 'week' | 'notes' | null

          block.forEach((row) => {
            const rowIsEmpty = isRowEmpty(row);
            emptyLineCount = rowIsEmpty ? emptyLineCount + 1 : 0;

            const rowHasHeader = hasHeader(row);
            if (rowHasHeader) {
              // 關掉前一個子表，開新子表
              if (inSubTable && currentSubTable.length > 0) {
                subTables.push(currentSubTable);
                currentSubTable = [];
              }
              inSubTable = true;
              currentMode = isDateHeaderRow(row) ? "date" : "week";
              currentSubTable.push(row);
              return; // 下一列
            }

            if (inSubTable) {
              // ★ 新規則：日期模式下，首欄必須是數字或空；否則切出新子表
              if (
                !rowIsEmpty &&
                currentMode === "date" &&
                !firstCellIsNumberOrEmpty(row)
              ) {
                // 先結束目前的日期子表
                if (currentSubTable.length > 0) {
                  subTables.push(currentSubTable);
                }
                // 開一個「notes」子表，把這行起算獨立出去（之後會被過濾，不影響解析）
                currentSubTable = [];
                currentMode = "notes";
                currentSubTable.push(row);
                return;
              }

              // 子表內：非空行就收
              if (!rowIsEmpty) currentSubTable.push(row);

              // 連續兩個空白行 → 結束目前子表
              if (emptyLineCount >= 2) {
                if (currentSubTable.length > 0) subTables.push(currentSubTable);
                currentSubTable = [];
                inSubTable = false;
                currentMode = null;
              }
            } else {
              // 不在子表：如果不是表頭但想保留異常段落，可選擇忽略；這裡維持略過
            }
          });

          if (currentSubTable.length > 0) subTables.push(currentSubTable);
          if (subTables.length === 0) subTables.push(block);

          finalSubTables.push(subTables);
        });

        console.log("二次切割結果：", finalSubTables);
        return finalSubTables;
      }

      // ====== ★ [中處理]：從表頭抓 yyyy年mm月（交給 plugin）======
      // 原本的 extractYearMonth 函數已移至 plugin.extractYearMonthFromHeaderRow

      // ====== ★ [中處理]：欄位補值/標頭整併等（交給 plugin.normalizeTables）======
      // 原本的 fillDateAndSixDown 函數已移至 plugin.normalizeTables

      /*******************************************************
       * 7. 計算特定日期的星期 & 計算某星期對應之所有日期
       *******************************************************/
      function getWeekdayFromDate(year, month, dateNum) {
        const dt = new Date(year, month - 1, dateNum);
        return dt.getDay(); // 0=日,1=一,...,6=六
      }
      function getDatesForWeekday(year, month, weekdayNum) {
        const dates = [];
        const daysInMonth = new Date(year, month, 0).getDate();
        for (let d = 1; d <= daysInMonth; d++) {
          const dt = new Date(year, month - 1, d);
          if (dt.getDay() === weekdayNum) {
            dates.push(d);
          }
        }
        return dates;
      }

      // ====== ★ [中處理]：tablesToWork 加一個「nameSplitter」入口，讓 plugin 控制名字切分 ======
      function tablesToWork(finalTables, { year, month }, nameSplitter) {
        const workSheet = {};
        const validWeekdays = ["日", "一", "二", "三", "四", "五", "六"];
        const weekdayMapping = {
          日: 0,
          一: 1,
          二: 2,
          三: 3,
          四: 4,
          五: 5,
          六: 6,
        };

        function getWeekdayFromDate(year, month, d) {
          return new Date(year, month - 1, d).getDay();
        }
        function getDatesForWeekday(year, month, weekdayNum) {
          const dates = [];
          const daysInMonth = new Date(year, month, 0).getDate();
          for (let d = 1; d <= daysInMonth; d++) {
            if (new Date(year, month - 1, d).getDay() === weekdayNum)
              dates.push(d);
          }
          return dates;
        }

        finalTables.forEach((table) => {
          // 檢查第一列第一格，判斷模式
          if (table[0][0] === "日期") {
            // 日期模式
            let hasWeekday = false;
            if (table[0][1] === "星期") {
              hasWeekday = true;
            }
            const workStartIndex = hasWeekday ? 2 : 1;

            for (let i = 1; i < table.length; i++) {
              const dateVal = table[i][0];
              for (let j = workStartIndex; j < table[i].length; j++) {
                const cellVal = String(table[i][j] ?? "").trim();
                if (cellVal === "" || cellVal === "-") continue;

                // 交給 plugin 的 nameSplitter
                const people = nameSplitter(cellVal);
                people.forEach((personName) => {
                  const clean = personName.trim().replace(/\s+/g, "");
                  if (!clean) return;
                  const key = clean;
                  if (!workSheet[key]) workSheet[key] = [];
                  workSheet[key].push({
                    date: dateVal,
                    weekDay: hasWeekday
                      ? table[i][1]
                      : validWeekdays[getWeekdayFromDate(year, month, dateVal)],
                    work: table[0][j],
                  });
                });
              }
            }
          } else if (table[0][0] === "星期") {
            // 星期模式
            for (let i = 1; i < table.length; i++) {
              for (let j = 1; j < table[i].length; j++) {
                const person = String(table[i][j] ?? "")
                  .trim()
                  .replace(/\s+/g, "");
                if (person === "" || person === "-") continue;
                const targetWeekday = table[i][0];
                if (!validWeekdays.includes(targetWeekday[0])) {
                  console.warn("偵測到無效星期:", targetWeekday);
                  continue;
                }
                const possibleDates = getDatesForWeekday(
                  year,
                  month,
                  weekdayMapping[targetWeekday[0]]
                );
                possibleDates.forEach((d) => {
                  if (!workSheet[person]) {
                    workSheet[person] = [];
                  }
                  workSheet[person].push({
                    date: d.toString(),
                    weekDay: targetWeekday,
                    work: table[0][j],
                  });
                });
              }
            }
          } else {
            console.error(
              "表格第一列第一格既不是『日期』也不是『星期』，忽略處理：",
              table[0]
            );
          }
        });
        return workSheet;
      }

      /**
       * 將 workSheet 中每個人的工作項目，
       * 從 { date, weekDay, work } 轉為 { date, timeSlot, task }，
       * 並跳過任何有 undefined 欄位的項目。
       *
       * @param {Object} workSheet - 原始的工作表物件，例如：
       * {
       *   "王小明": [
       *     { date: "12", weekDay: "三", work: "會前領詩" },
       *     { date: "12", weekDay: "三", work: "翻譯" },
       *     { date: undefined, weekDay: "三", work: "其他" } // 這筆會被跳過
       *   ],
       *   "李大華": [
       *     { date: "15", weekDay: "六下", work: "司琴" }
       *   ]
       * }
       * @returns {Object} - 轉換後的工作表物件，結構為：
       * {
       *   "王小明": [
       *     { date: "12", timeSlot: "三", task: "會前領詩" },
       *     { date: "12", timeSlot: "三", task: "翻譯" }
       *   ],
       *   "李大華": [
       *     { date: "15", timeSlot: "六下", task: "司琴" }
       *   ]
       * }
       */
      function transformWorkSheet(workSheet) {
        const transformedSheet = {};
        for (const personName in workSheet) {
          // 去除 personName 中的所有斜線
          const cleanPersonName = personName.replace(/\//g, "");
          transformedSheet[cleanPersonName] = workSheet[personName].reduce(
            (acc, item) => {
              // 檢查是否有任何欄位為 undefined
              if (
                item.date !== undefined &&
                item.weekDay !== undefined &&
                item.work !== undefined
              ) {
                acc.push({
                  date: item.date,
                  timeSlot: item.weekDay,
                  task: item.work,
                });
              }
              return acc;
            },
            []
          );
        }
        return transformedSheet;
      }

      // ====== ★ 全域變數：儲存「最終的轉換後工作表物件」（現在使用 window.__FINAL__）======

      // === 刪除/復原的全域狀態 ===
      let deletedJobsByUser = {}; // { userName: Set<jobIdString> }
      const makeJobId = (job) => `${job.date}__${job.timeSlot}__${job.task}`; // 穩定ID

      // 供 JSON Modal 使用
      let parsedFinalTables = null; // 解析後的 Table 陣列
      /** @type {'general'|'spiritual'} 目前使用哪個試算表分頁解析（日後靈恩會可分支邏輯） */
      window.__ACTIVE_SHEET_PARSE_TAB__ = "general";

      // 篩選狀態
      let currentTaskFilter = "ALL";

      // 記錄目前可見工作集合的簽章，避免不必要的選單重建
      let __TASKS_SIGNATURE__ = null;

      // 字串正規化工具函式，避免空白或全形字造成不相等
      function normTask(s) {
        return String(s || "")
          .replace(/\s+/g, "") // 移除所有空白（含全形空白）
          .trim();
      }

      // 依目前可見工作（排除已刪除）收集所有工作項目
      function collectVisibleTasks() {
        if (!window.__FINAL__) return [];
        const tasks = new Set();
        for (const [user, jobs] of Object.entries(window.__FINAL__)) {
          const delSet = deletedJobsByUser[user] || new Set();
          jobs.forEach((job) => {
            if (!delSet.has(makeJobId(job))) tasks.add(normTask(job.task));
          });
        }
        return Array.from(tasks).sort();
      }

      // 更新下拉選項
      function refreshTaskFilterOptions() {
        const sel = document.getElementById("jobFilterSelect");
        if (!sel) return;

        const tasks = collectVisibleTasks();
        const prev = currentTaskFilter;

        sel.innerHTML = `<option value="ALL">（全部工作）</option>`;
        tasks.forEach((t) => {
          const opt = document.createElement("option");
          opt.value = t; // 值用原字串
          opt.textContent = t; // 顯示也用原字串
          sel.appendChild(opt);
        });

        sel.disabled = false; // 保持可互動，事件才會觸發

        const values = new Set(tasks.concat(["ALL"]));
        if (!values.has(normTask(prev))) {
          currentTaskFilter = "ALL";
          sel.value = "ALL";
        } else {
          currentTaskFilter = prev;
          sel.value = prev;
        }

        // 🔍 debug
        console.log("[refreshTaskFilterOptions] tasks=", tasks);
        console.log("[refreshTaskFilterOptions] disabled=", sel.disabled);
        console.log("[refreshTaskFilterOptions] sel.value=", sel.value);

        // 確保至少有兩個可選值，方便測試事件
        if (document.getElementById("jobFilterSelect").options.length === 1) {
          const opt = document.createElement("option");
          opt.value = "DEBUG_TASK";
          opt.textContent = "（測試）DEBUG_TASK";
          document.getElementById("jobFilterSelect").appendChild(opt);
        }
      }

      function updateJsonModalContent(content) {
        const pre = document.getElementById("jsonOutput");
        if (!pre) return;
        if (typeof content === "string") {
          pre.textContent = content;
        } else {
          try {
            pre.textContent = JSON.stringify(content, null, 2);
          } catch {
            pre.textContent = String(content ?? "（無內容）");
          }
        }
      }

      function ensureDeletedSet(user) {
        if (!deletedJobsByUser[user]) deletedJobsByUser[user] = new Set();
      }

      // 過濾：把 window.__FINAL__ 中被刪除的工作排除，回傳要上傳的 payload
      function buildUploadPayload() {
        if (!window.__FINAL__) return null;
        const result = {};
        for (const [user, jobs] of Object.entries(window.__FINAL__)) {
          const delSet = deletedJobsByUser[user] || new Set();
          const kept = jobs.filter((job) => !delSet.has(makeJobId(job)));
          if (kept.length > 0) result[user] = kept;
        }
        return result;
      }

      // UI：渲染使用者的「可見工作」
      function renderUserJobs() {
        console.log("[render] currentTaskFilter =", currentTaskFilter);
        const container = document.getElementById("userJobs");
        container.innerHTML = "";
        if (!window.__FINAL__) {
          container.innerHTML = `<div style="text-align:center;color:var(--muted);padding:20px">尚未產生工作清單</div>`;
          // 沒資料時同步更新選單狀態
          refreshTaskFilterOptions();
          return;
        }

        // 先算出每位使用者的可見工作（排除已刪除）
        const visibleByUser = {};
        for (const [user, jobs] of Object.entries(window.__FINAL__)) {
          const delSet = deletedJobsByUser[user] || new Set();
          visibleByUser[user] = jobs.filter(
            (job) => !delSet.has(makeJobId(job))
          );
        }

        // 若有篩選：只留下「有該工作」的使用者
        const taskFilter = currentTaskFilter;
        const filteredUsers = Object.entries(visibleByUser).filter(
          ([_, jobs]) => {
            if (taskFilter === "ALL") return true;
            return jobs.some((j) => normTask(j.task) === normTask(taskFilter));
          }
        );

        if (filteredUsers.length === 0) {
          container.innerHTML = `<div style="text-align:center;color:var(--muted);padding:20px">沒有符合條件的成員</div>`;
          refreshTaskFilterOptions();
          return;
        }

        filteredUsers.forEach(([user, visibleJobs]) => {
          const card = document.createElement("div");
          card.className = "user-card";
          const title = document.createElement("h4");
          title.textContent = user;
          card.appendChild(title);

          // ⭐ 這裡依選單再過濾一次「要顯示的工作」
          const jobsForDisplay =
            taskFilter === "ALL"
              ? visibleJobs
              : visibleJobs.filter(
                  (j) => normTask(j.task) === normTask(taskFilter)
                );

          if (jobsForDisplay.length === 0) {
            const empty = document.createElement("div");
            empty.textContent = "（本月無工作）";
            card.appendChild(empty);
          } else {
            const ul = document.createElement("ul");
            ul.className = "user-job-list";
            jobsForDisplay.forEach((job) => {
              const li = document.createElement("li");
              li.innerHTML = `📅 ${job.date}｜${job.timeSlot}｜${job.task}
                <button class="btn danger" 
                        data-action="delete" 
                        data-user="${user}"
                        data-id="${makeJobId(job)}"
                        style="float:right;padding:4px 8px;font-size:12px;">刪除</button>`;
              ul.appendChild(li);
            });
            card.appendChild(ul);
          }

          container.appendChild(card);
        });

        // 每次重繪後，只有在可選項目實際有變動時才重建下拉
        const nowSig = collectVisibleTasks().join("|");
        if (nowSig !== __TASKS_SIGNATURE__) {
          __TASKS_SIGNATURE__ = nowSig;
          refreshTaskFilterOptions();
        }
      }

      // UI：渲染「已刪除工作區域」（可復原）
      function renderDeletedJobs() {
        const container = document.getElementById("deletedJobs");
        container.innerHTML = "";

        // 蒐集每位使用者的已刪除項目
        const blocks = [];
        for (const [user, jobs] of Object.entries(window.__FINAL__ || {})) {
          const delSet = deletedJobsByUser[user] || new Set();
          const deletedList = jobs.filter((job) => delSet.has(makeJobId(job)));
          if (deletedList.length > 0) {
            blocks.push({ user, deletedList });
          }
        }

        if (blocks.length === 0) {
          container.innerHTML = `<div style="text-align:center;color:var(--muted);padding:20px">尚無已刪除的工作</div>`;
          return;
        }

        blocks.forEach(({ user, deletedList }) => {
          const card = document.createElement("div");
          card.className = "user-card";
          const title = document.createElement("h4");
          title.textContent = `${user}（已刪除）`;
          card.appendChild(title);

          const ul = document.createElement("ul");
          ul.className = "user-job-list";
          deletedList.forEach((job) => {
            const li = document.createElement("li");
            li.innerHTML = `📅 ${job.date}｜${job.timeSlot}｜${job.task}
              <button class="btn" 
                      data-action="restore" 
                      data-user="${user}"
                      data-id="${makeJobId(job)}"
                      style="float:right;padding:4px 8px;font-size:12px;">復原</button>`;
            ul.appendChild(li);
          });
          card.appendChild(ul);
          container.appendChild(card);
        });
      }

      /*******************************************************
       * Toast 訊息系統
       *******************************************************/
      function showToast(message, type = "info", duration = 3000) {
        const toast = document.getElementById("toast");
        toast.textContent = message;
        toast.className = `toast ${type}`;
        toast.classList.add("show");

        setTimeout(() => {
          toast.classList.remove("show");
        }, duration);
      }

      /*******************************************************
       * 初始化圖片上傳功能：生成年月下拉選單
       *******************************************************/
      function initializeImageUpload() {
        const select = document.getElementById("imageMonthSelect");
        const currentDate = new Date();

        // 生成 -3 到 +6 個月的選項
        for (let i = -3; i <= 6; i++) {
          const targetDate = new Date(
            currentDate.getFullYear(),
            currentDate.getMonth() + i,
            1
          );
          const year = targetDate.getFullYear();
          const month = (targetDate.getMonth() + 1).toString().padStart(2, "0");
          const yearMonth = `${year}${month}`;

          const option = document.createElement("option");
          option.value = yearMonth;
          option.textContent = `${year}年${month}月 (${yearMonth})`;

          // 如果是當前月份，設為預設選項
          if (i === 0) {
            option.selected = true;
          }

          select.appendChild(option);
        }

        // Evangelistic 欄位初始化
        populateYearMonthSelect(document.getElementById("evgMonthStart"));
        document
          .getElementById("evgCrossMonth")
          .addEventListener("change", () => {
            // 只需重讀目前圖片（若有）
            document.getElementById("currentImageContainer").style.display =
              "none";
            loadCurrentImageFromDB();
          });
      }

      // 頁面載入時初始化
      document.addEventListener("DOMContentLoaded", function () {
        initializeImageUpload();
        initializeUploadTypeHandler();
        updatePluginInfo(); // 初始化 plugin 資訊顯示

        // Plugin 選擇器事件已在 initPlugin() 中綁定
        // 綁定篩選下拉事件

        // 讓使用者一打開就看到「目前 Firebase 圖片」
        loadCurrentImageFromDB();
        const sel = document.getElementById("jobFilterSelect");
        if (sel) {
          const onSelectChange = () => {
            currentTaskFilter = sel.value || "ALL";
            console.log("[filter changed:direct]", currentTaskFilter);
            renderUserJobs();
          };
          sel.addEventListener("change", onSelectChange);
          sel.addEventListener("input", onSelectChange); // ← 部分環境 change 不穩就用這個補
          refreshTaskFilterOptions(); // 首次刷新
        }

        // 委派（保險）：就算 select 之後被替換/重建，仍能接到事件
        document.addEventListener(
          "change",
          (e) => {
            const t = e.target;
            if (t && t.id === "jobFilterSelect") {
              currentTaskFilter = t.value || "ALL";
              console.log("[filter changed:delegated]", currentTaskFilter);
              renderUserJobs();
            }
          },
          true // capture 階段，避免被其它 handler 攔掉
        );
      });

      // JSON Modal 開關
      (function setupJsonModal() {
        const backdrop = document.getElementById("jsonModalBackdrop");
        const closeBtn = document.getElementById("jsonModalCloseBtn");
        const closeBtn2 = document.getElementById("jsonModalCloseBtn2");
        function openModal() {
          backdrop.style.display = "flex";
          backdrop.setAttribute("aria-hidden", "false");
        }
        function closeModal() {
          backdrop.style.display = "none";
          backdrop.setAttribute("aria-hidden", "true");
        }
        closeBtn.addEventListener("click", closeModal);
        closeBtn2.addEventListener("click", closeModal);
        backdrop.addEventListener("click", (e) => {
          if (e.target === backdrop) closeModal();
        });
        document.addEventListener("keydown", (e) => {
          if (e.key === "Escape" && backdrop.style.display === "flex")
            closeModal();
        });

        function openJsonIfParsed() {
          if (!parsedFinalTables) {
            showToast(
              "尚未進行資料解析，請先點擊『抓取資料並解析』。",
              "error"
            );
            return;
          }
          updateJsonModalContent(parsedFinalTables);
          openModal();
        }
        ["openJsonModalBtn", "openJsonModalBtnSpiritual"].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.addEventListener("click", openJsonIfParsed);
        });
      })();

      /*******************************************************
       * 初始化上傳類型變更處理
       *******************************************************/
      function initializeUploadTypeHandler() {
        const uploadTypeSelect = document.getElementById("uploadTypeSelect");
        const monthSelectContainer = document.getElementById(
          "monthSelectContainer"
        );
        const evgFields = document.getElementById("evangelisticFields");

        // 設定變更事件監聽器
        uploadTypeSelect.addEventListener("change", function () {
          const selectedType = this.value;

          if (selectedType === "schedule") {
            // 選擇安排表時顯示年月選項
            monthSelectContainer.style.display = "block";
            evgFields.style.display = "none";
          } else if (selectedType === "evangelistic") {
            // 選擇靈恩佈道會時顯示專用區塊
            monthSelectContainer.style.display = "none";
            evgFields.style.display = "block";
          } else {
            // 選擇班級時隱藏年月選項
            monthSelectContainer.style.display = "none";
            evgFields.style.display = "none";
          }
        });

        // 初始化時根據預設值設定顯示狀態
        const initialType = uploadTypeSelect.value;
        if (initialType === "schedule") {
          monthSelectContainer.style.display = "block";
          evgFields.style.display = "none";
        } else if (initialType === "evangelistic") {
          monthSelectContainer.style.display = "none";
          evgFields.style.display = "block";
        } else {
          monthSelectContainer.style.display = "none";
          evgFields.style.display = "none";
        }
      }

      /*******************************************************
       * Firebase 圖片預覽工具函式
       *******************************************************/
      // 依畫面現況計算「目前要看的 Firebase 路徑」
      function getCurrentImagePathByUI() {
        const plugin = window.__PLUGIN__;
        const uploadType = document.getElementById("uploadTypeSelect").value;
        if (!plugin || !plugin.paths) return null;

        if (uploadType === "schedule") {
          const yyyymm = document.getElementById("imageMonthSelect").value;
          if (!yyyymm) return null;
          return plugin.paths.scheduleImage(yyyymm);
        } else if (uploadType === "evangelistic") {
          return getEvangelisticDbPath(); // 固定節點
        } else {
          return plugin.paths.classImage(uploadType);
        }
      }

      // 新增：依目前 UI，決定「Storage 檔案放哪個路徑」
      function getStorageObjectPathByUI(file) {
        const plugin = window.__PLUGIN__;
        const uploadType = document.getElementById("uploadTypeSelect").value;

        // 你目前 Storage 有個 public/ 目錄；我們把檔案整理到子資料夾
        // 命名：避免覆蓋，補上時間戳記
        const ts = Date.now();
        const safeExt = (file?.name?.split(".").pop() || "jpg").toLowerCase();

        if (uploadType === "schedule") {
          const yyyymm = document.getElementById("imageMonthSelect").value;
          // e.g. public/schedule/202503/202503-1737112233445.jpg
          return `public/schedule/${yyyymm}/${yyyymm}-${ts}.${safeExt}`;
        } else {
          // e.g. public/class/中級班/中級班-1737112233445.jpg
          return `public/class/${uploadType}/${uploadType}-${ts}.${safeExt}`;
        }
      }

      // 上傳檔案到 Storage → 取得 downloadURL → 寫回你原本的 DB 路徑
      async function uploadSelectedFileAndWriteDB() {
        const fileInput = document.getElementById("imageFileInput");
        const file = fileInput?.files?.[0];
        if (!file) {
          showToast("請先選擇一張圖片檔！", "error");
          return;
        }

        const uploadType = document.getElementById("uploadTypeSelect").value;
        let objectPath, dbPath, payloadToWrite;

        if (uploadType === "evangelistic") {
          const months = getEvangelisticMonthsFromUI();
          if (!months.length) {
            showToast("請至少選擇一個活動月份。", "error");
            return;
          }
          objectPath = getEvangelisticStoragePath(file);
          dbPath = getEvangelisticDbPath();
          payloadToWrite = { url: null, months }; // 先占位，等拿到 downloadURL
        } else {
          // 1) 決定 Storage 物件路徑
          objectPath = getStorageObjectPathByUI(file);
          if (!objectPath) {
            showToast("請先選好上傳類型與年月/班級！", "error");
            return;
          }

          // 2) 決定 DB 路徑（你原本用的）
          dbPath = getCurrentImagePathByUI();
          if (!dbPath) {
            showToast("無法取得 DB 路徑，請確認上傳類型與年月/班級。", "error");
            return;
          }
        }

        try {
          showToast("開始上傳檔案...", "info");

          // 3) 上傳到 Storage（含 contentType）
          const storageRef = storage.ref(objectPath);
          const metadata = { contentType: file.type || "image/jpeg" };

          // 使用 put（compat）或 putString/base64 皆可；這裡用 put 檔案物件
          const task = storageRef.put(file, metadata);

          // 可選：監聽進度
          task.on(
            "state_changed",
            (snap) => {
              // 你要顯示進度條可以在這裡處理
              // const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
              // console.log('Upload', pct + '%');
            },
            (err) => {
              showToast("上傳失敗：" + err.message, "error");
            },
            async () => {
              // 4) 成功 → 拿到 downloadURL
              const downloadURL = await task.snapshot.ref.getDownloadURL();

              // 5) 寫回你原本的 DB 路徑（保持和貼網址流程一致）
              if (uploadType === "evangelistic") {
                payloadToWrite.url = downloadURL;
                await database.ref(dbPath).set(payloadToWrite);
              } else {
                await database.ref(dbPath).set(downloadURL);
              }

              showToast("上傳完成！已寫回圖片網址。", "success");

              // 清空檔案選擇並刷新右側「目前 Firebase 圖片」
              document.getElementById("imageFileInput").value = "";
              loadCurrentImageFromDB();
            }
          );
        } catch (e) {
          showToast("上傳失敗：" + e.message, "error");
        }
      }

      // 把某個 URL 渲染到「目前 Firebase 圖片」區塊
      function renderCurrentImage(urlOrObj, path) {
        const wrap = document.getElementById("currentImageContainer");
        const box = document.getElementById("currentImageBox");
        wrap.style.display = "block";

        let url = null,
          meta = "";
        console.log("urlOrObj", urlOrObj);
        if (typeof urlOrObj === "string") {
          url = urlOrObj;
        } else if (urlOrObj && typeof urlOrObj === "object") {
          url = urlOrObj.url || null;
          const months = Array.isArray(urlOrObj.months) ? urlOrObj.months : [];
          meta = `<br><small style='color:#666;'>months: [${months.join(
            ", "
          )}]</small>`;
        }

        if (!url) {
          box.innerHTML = `
            <div style="text-align:center; color:#ef6c00;">
              ⚠️ 這個路徑目前沒有存到圖片網址<br>
              <small style="color:#666">路徑：${path || "(未知)"}${meta}</small>
            </div>
          `;
          return;
        }

        // 與你預覽新圖時相同的「成功/失敗」視覺提示
        box.innerHTML = `
          <div style="border: 1px solid #2196f3; padding: 10px; border-radius: 4px; background: #e3f2fd;">
            <img 
              src="${url}" 
              style="max-width: 100%; max-height: 200px; border-radius: 4px; display: block; margin: 0 auto;" 
              onload="this.parentElement.style.borderColor='#4caf50'; this.parentElement.style.backgroundColor='#e8f5e8';
                       this.nextElementSibling.innerHTML='✅ 讀取成功<br><small style=\\'color:#666;\\'>路徑：${path}</small><br><small style=\\'color:#666;\\'>網址：${url}</small>${meta}';
                       this.nextElementSibling.style.color='#2e7d32';"
              onerror="this.style.display='none'; this.parentElement.style.borderColor='#ff9800'; this.parentElement.style.backgroundColor='#fff3e0';
                       this.nextElementSibling.innerHTML='⚠️ 圖片載入失敗<br><small>路徑：${path}</small><br><small>網址：${url}</small>${meta}';
                       this.nextElementSibling.style.color='#ef6c00';" />
            <div style="margin-top: 5px; font-size: 0.9em; color: #1976d2; text-align: center;">
              🔄 嘗試載入 Firebase 目前圖片...
            </div>
          </div>
        `;
      }

      /*******************************************************
       * 左欄：試算表分頁切換（一般安排表 / 靈恩會安排表）
       *******************************************************/
      (function setupSheetParseTabs() {
        const tabGeneral = document.getElementById("tabSheetGeneral");
        const tabSpiritual = document.getElementById("tabSheetSpiritual");
        const panelGeneral = document.getElementById("panelSheetGeneral");
        const panelSpiritual = document.getElementById("panelSheetSpiritual");
        if (!tabGeneral || !tabSpiritual || !panelGeneral || !panelSpiritual) {
          return;
        }
        function activate(which) {
          const isSpiritual = which === "spiritual";
          panelGeneral.hidden = isSpiritual;
          panelSpiritual.hidden = !isSpiritual;
          tabGeneral.classList.toggle("active", !isSpiritual);
          tabSpiritual.classList.toggle("active", isSpiritual);
          tabGeneral.setAttribute(
            "aria-selected",
            (!isSpiritual).toString()
          );
          tabSpiritual.setAttribute(
            "aria-selected",
            isSpiritual.toString()
          );
        }
        tabGeneral.addEventListener("click", () => activate("general"));
        tabSpiritual.addEventListener("click", () => activate("spiritual"));
      })();

      function inputsFromParsePanel(panel) {
        if (panel && panel.dataset.sheetParsePanel === "spiritual") {
          return {
            urlInput: document.getElementById("urlInputSpiritual"),
            sheetIdInput: document.getElementById("sheetIdInputSpiritual"),
            gidInput: document.getElementById("gidInputSpiritual"),
          };
        }
        return {
          urlInput: document.getElementById("urlInput"),
          sheetIdInput: document.getElementById("sheetIdInput"),
          gidInput: document.getElementById("gidInput"),
        };
      }

      function parsePanelMode(panel) {
        return panel && panel.dataset.sheetParsePanel === "spiritual"
          ? "spiritual"
          : "general";
      }

      /*******************************************************
       * 事件：解析網址 → 填入 sheetId/gid
       *******************************************************/
      function wireParseUrlButton(btn) {
        if (!btn) return;
        btn.addEventListener("click", function () {
          const panel = this.closest("[data-sheet-parse-panel]");
          const { urlInput, sheetIdInput, gidInput } =
            inputsFromParsePanel(panel);
          const url = (urlInput && urlInput.value.trim()) || "";
          if (!url) {
            alert("請貼上有效的 Google 試算表網址或 Sheet ID！");
            return;
          }
          const { sheetId, gid } = parseSpreadsheetUrl(url);
          if (!sheetId) {
            alert("無法解析出 sheetId，請確認網址是否正確。");
            return;
          }
          if (sheetIdInput) sheetIdInput.value = sheetId;
          if (gidInput) gidInput.value = gid;
        });
      }
      wireParseUrlButton(document.getElementById("parseButton"));
      wireParseUrlButton(document.getElementById("parseButtonSpiritual"));

      // ====== ★ 抓取並解析（一般／靈恩會暫共用 plugin 流程；日後可依 __ACTIVE_SHEET_PARSE_TAB__ 分支）======
      async function runFetchAndParseFromPanel(panel) {
        const plugin = window.__PLUGIN__;
        window.__ACTIVE_SHEET_PARSE_TAB__ = parsePanelMode(panel);

        const { sheetIdInput, gidInput } = inputsFromParsePanel(panel);
        const sheetId = (sheetIdInput && sheetIdInput.value.trim()) || "";
        const gid =
          (gidInput && gidInput.value.trim()) || "0";
        if (!sheetId) return alert("請先填入 sheetId！");

        showToast("解析中...", "info");

        const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&id=${sheetId}&gid=${gid}`;
        try {
          const csvText = await fetch(csvUrl).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.text();
          });

          const parsed = Papa.parse(csvText).data;

          // ====== ★ [前處理]：交給 plugin.preprocess ======
          const { csv2d, hints } = plugin.preprocess(parsed, {
            setMonthInput,
          });

          // 你原本的「切表」流程（空白行/欄 → 日期/星期二次切割 → 攤平 → 移除空欄）
          const tableBlocks = splitTablesByEmptyRowsAndColumns(csv2d);
          const dateSubTables = splitTablesByDateKeyword(tableBlocks);
          const flatTables = [];
          dateSubTables.forEach((blocks) =>
            blocks.forEach((t) => flatTables.push(t))
          );

          const removeEmptyColumns = (table) => {
            if (!table.length) return table;
            const colCount = table[0].length;
            const emptyCols = [];
            for (let c = 0; c < colCount; c++) {
              let allEmpty = true;
              for (let r = 0; r < table.length; r++) {
                if (String(table[r][c] ?? "").trim() !== "") {
                  allEmpty = false;
                  break;
                }
              }
              if (allEmpty) emptyCols.push(c);
            }
            return table.map((row) =>
              row.filter((_, idx) => !emptyCols.includes(idx))
            );
          };

          const validFlatTables = flatTables
            .map(removeEmptyColumns)
            .filter((t) =>
              t.some((row) => row.some((cell) => String(cell ?? "") !== ""))
            );

          // 從第一個子表格抓 yyyymm（若 plugin 有給 hints.month 就優先用）
          const ymFromHeader = plugin.extractYearMonthFromHeaderRow(
            validFlatTables?.[0]?.[0]
          );
          const yyyymm =
            hints?.month ||
            (ymFromHeader ? ymFromHeader.year + ymFromHeader.month : null);
          if (yyyymm) setMonthInput(yyyymm);

          // 只留第一格為「日期/星期」
          const validTables = validFlatTables.filter((t) => {
            const head = (t[0]?.[0] || "").trim();
            return head === "日期" || head === "星期";
          });

          // ====== ★ [有效表格數量]：plugin.validate ======
          const errors = plugin.validate({ validTables });
          if (errors.length) alert(errors.join("\n"));

          // ====== ★ [中處理]：欄位補值/標頭整併等 ======
          const finalTables = plugin.normalizeTables(validTables, { yyyymm });

          // 轉工作表 → 轉最終資料結構
          const ym = yyyymm
            ? { year: yyyymm.slice(0, 4), month: yyyymm.slice(4) }
            : ymFromHeader || { year: "", month: "" };

          const workSheet = tablesToWork(finalTables, ym, (x) =>
            plugin.nameSplitter(x)
          );
          let finalTransformedSheet = transformWorkSheet(workSheet);

          // ====== ★ [後處理]：JGC 的「清掃區域→環境清潔」關聯等 ======
          finalTransformedSheet = plugin.postprocess(finalTransformedSheet, {
            yyyymm,
          });

          // 先存起來，供下游使用
          window.__FINAL__ = finalTransformedSheet;

          // 🔍 關鍵 debug：確認解析結果
          console.log(
            "[FINAL keys] users =",
            Object.keys(window.__FINAL__ || {})
          );
          console.log(
            "[FINAL sample]",
            window.__FINAL__ &&
              window.__FINAL__[Object.keys(window.__FINAL__)[0]]
          );
          console.log(
            "[sheet parse tab]",
            window.__ACTIVE_SHEET_PARSE_TAB__
          );

          // 解析完成：重繪 UI（可刪除/復原）
          deletedJobsByUser = {}; // 清空之前的刪除狀態
          renderUserJobs();
          renderDeletedJobs();

          // 🔧 保險：強制刷新一次篩選選單（並啟用它）
          __TASKS_SIGNATURE__ = null;
          refreshTaskFilterOptions();
          console.log("[after parse] options=", collectVisibleTasks());

          // 更新 JSON Modal 的資料
          parsedFinalTables = finalTables;
          updateJsonModalContent(parsedFinalTables);
          showToast("解析完成！", "success");
        } catch (e) {
          console.error(e);
          parsedFinalTables = null;
          updateJsonModalContent("抓取或解析資料時發生錯誤：" + e.message);
          showToast("抓取或解析失敗", "error");
        }
      }

      function wireFetchButton(btn) {
        if (!btn) return;
        btn.addEventListener("click", async function () {
          const panel = this.closest("[data-sheet-parse-panel]");
          await runFetchAndParseFromPanel(panel);
        });
      }
      wireFetchButton(document.getElementById("fetchButton"));
      wireFetchButton(document.getElementById("fetchButtonSpiritual"));

      // ====== ★ UI 事件：上傳工作表（使用 plugin.paths）======
      document
        .getElementById("uploadBtn")
        .addEventListener("click", function () {
          const plugin = window.__PLUGIN__;
          const month = document.getElementById("monthInput").value.trim();
          if (!month || !/^\d{6}$/.test(month)) {
            alert("請輸入正確格式的月份 (yyyymm)");
            return;
          }
          if (!window.__FINAL__) {
            alert("尚未生成工作表資料，請先『抓取資料並解析』！");
            return;
          }

          const path = plugin.paths.scheduleData(month); // ====== ★ [上傳路徑] ======
          const payload = buildUploadPayload();
          if (!payload || Object.keys(payload).length === 0) {
            return alert("目前沒有可上傳的工作（可能全部被刪除）");
          }
          database.ref(path).set(payload, function (error) {
            if (error) {
              alert("上傳失敗：" + error);
            } else {
              alert("成功上傳（已自動排除已刪除的工作）！");
            }
          });
        });

      /*******************************************************
       * 刪除功能選單（Modal）邏輯
       *******************************************************/
      (function setupDeleteMenu() {
        const backdrop = document.getElementById("deleteModalBackdrop");
        const openBtn = document.getElementById("openDeleteMenuBtn");
        const closeBtn = document.getElementById("deleteModalCloseBtn");
        const cancelBtn = document.getElementById("deleteModalCancelBtn");
        const doDeleteBtn = document.getElementById("doDeleteBtn");

        const modeSelect = document.getElementById("deleteModeSelect");
        const monthRow = document.getElementById("deleteMonthRow");
        const monthInput = document.getElementById("deleteMonthInput2");
        const classRow = document.getElementById("deleteClassRow");
        const classSelect = document.getElementById("deleteClassSelect");

        function openModal() {
          backdrop.style.display = "flex";
          backdrop.setAttribute("aria-hidden", "false");
          // 預設帶入畫面上已有的月份選擇（若有）
          const monthFromMain =
            document.getElementById("monthInput")?.value?.trim() ||
            document.getElementById("imageMonthSelect")?.value?.trim() ||
            "";
          if (!monthInput.value && monthFromMain)
            monthInput.value = monthFromMain;

          // 動態更新路徑提示（使用 plugin.paths）
          const p = window.__PLUGIN__.paths;
          const hintElement = document.querySelector(
            "#deleteModalBackdrop .hint"
          );
          if (hintElement) {
            hintElement.innerHTML = `
              <div><strong>資料路徑對照：</strong></div>
              <div>安排表資料：<code>${p.scheduleData("{yyyymm}")}</code></div>
              <div>安排表圖片：<code>${p.scheduleImage("{yyyymm}")}</code></div>
              <div>班級圖片：<code>${p.classImage("{班級名}")}</code></div>
            `;
          }
        }
        function closeModal() {
          backdrop.style.display = "none";
          backdrop.setAttribute("aria-hidden", "true");
        }

        // 顯示欄位隨模式切換
        function refreshFields() {
          const mode = modeSelect.value;
          if (mode === "scheduleData" || mode === "scheduleImage") {
            monthRow.style.display = "block";
            classRow.style.display = "none";
          } else if (mode === "classImage") {
            monthRow.style.display = "none";
            classRow.style.display = "block";
          }
        }

        // 外層互動
        openBtn.addEventListener("click", openModal);
        closeBtn.addEventListener("click", closeModal);
        cancelBtn.addEventListener("click", closeModal);
        backdrop.addEventListener("click", (e) => {
          if (e.target === backdrop) closeModal();
        });
        document.addEventListener("keydown", (e) => {
          if (e.key === "Escape" && backdrop.style.display === "flex")
            closeModal();
        });
        modeSelect.addEventListener("change", refreshFields);
        refreshFields();

        // 實際刪除（使用 plugin.paths）
        doDeleteBtn.addEventListener("click", async function () {
          const plugin = window.__PLUGIN__;
          const mode = modeSelect.value;

          try {
            if (mode === "scheduleData") {
              const m = monthInput.value.trim();
              if (!/^\d{6}$/.test(m))
                return alert("請輸入正確格式的月份 (yyyymm)");
              const path = plugin.paths.scheduleData(m);
              if (!confirm(`確定刪除「安排表資料」？\n路徑：${path}`)) return;
              await database.ref(path).remove();
              alert(`已刪除：${path}`);
            } else if (mode === "scheduleImage") {
              const m = monthInput.value.trim();
              if (!/^\d{6}$/.test(m))
                return alert("請輸入正確格式的月份 (yyyymm)");
              const path = plugin.paths.scheduleImage(m);
              if (!confirm(`確定刪除「安排表圖片網址」？\n路徑：${path}`))
                return;
              await database.ref(path).remove();
              alert(`已刪除：${path}`);
            } else if (mode === "classImage") {
              const cls = classSelect.value;
              if (!cls) return alert("請選擇班級");
              const path = plugin.paths.classImage(cls);
              if (!confirm(`確定刪除「${cls}」的圖片網址？\n路徑：${path}`))
                return;
              await database.ref(path).remove();
              alert(`已刪除：${path}`);
            } else {
              return alert("未知的刪除模式");
            }
            closeModal();
          } catch (err) {
            alert(`刪除失敗：${err.message}`);
            return;
          }
        });
      })();

      /*******************************************************
       * 事件：檢視圖片預覽
       *******************************************************/
      document
        .getElementById("previewImageBtn")
        .addEventListener("click", function () {
          const imageUrl = document
            .getElementById("imageUrlInput")
            .value.trim();

          if (!imageUrl) {
            showToast("請先輸入圖片網址！", "error");
            return;
          }

          // 簡單的網址格式驗證
          try {
            new URL(imageUrl);
          } catch (e) {
            showToast("請輸入有效的網址格式！", "error");
            return;
          }

          const previewContainer = document.getElementById(
            "imagePreviewContainer"
          );

          // 直接顯示圖片，不進行預先載入測試
          previewContainer.style.display = "block";
          previewContainer.innerHTML = `
            <div style="border: 1px solid #2196f3; padding: 10px; border-radius: 4px; background: #e3f2fd;">
              <img 
                src="${imageUrl}" 
                style="max-width: 100%; max-height: 200px; border-radius: 4px; display: block; margin: 0 auto;" 
                onload="this.parentElement.style.borderColor='#4caf50'; this.parentElement.style.backgroundColor='#e8f5e8'; this.nextElementSibling.innerHTML='✅ 圖片載入成功<br><small style=\\'color:#666;\\'>網址：${imageUrl}</small>'; this.nextElementSibling.style.color='#2e7d32';"
                onerror="this.style.display='none'; this.parentElement.style.borderColor='#ff9800'; this.parentElement.style.backgroundColor='#fff3e0'; this.nextElementSibling.innerHTML='⚠️ 瀏覽器預覽失敗<br><small style=\\'font-size:0.8em;\\'>常見於 imgur 等服務的安全限制<br><strong>網址本身可能是正確的，建議直接上傳！</strong><br><br>網址：${imageUrl}</small>'; this.nextElementSibling.style.color='#ef6c00';"
              />
              <div style="margin-top: 5px; font-size: 0.9em; color: #1976d2; text-align: center;">
                🔄 載入圖片中...
              </div>
            </div>
          `;
        });

      // ====== ★ 從 Realtime DB 讀取現有圖片網址並預覽 ======
      async function loadCurrentImageFromDB() {
        const path = getCurrentImagePathByUI();
        if (!path) {
          showToast("請先選擇正確的類型與年月/班級！", "error");
          return;
        }

        try {
          showToast("讀取中...", "info");
          // 使用 once('value') 讀取資料
          const snap = await database.ref(path).once("value");
          const val = snap.val();

          // val 可能是字串（單一 URL）或物件（你之後想擴充多欄位的情況）
          const hasUrl = typeof val === "string" ? !!val : !!val?.url;
          renderCurrentImage(val, path);

          if (hasUrl) {
            showToast("已載入目前圖片網址", "success");
          } else {
            showToast("這個路徑目前沒有圖片網址", "info");
          }
        } catch (err) {
          console.error(err);
          showToast("讀取失敗：" + err.message, "error");
        }
      }

      // 綁定「載入目前圖片」按鈕
      document
        .getElementById("loadCurrentImageBtn")
        .addEventListener("click", loadCurrentImageFromDB);

      // 綁定「上傳檔案到 Storage」按鈕
      document
        .getElementById("uploadFileToStorageBtn")
        .addEventListener("click", uploadSelectedFileAndWriteDB);

      // 當類型或月份改變時，自動刷新（可選）
      document
        .getElementById("uploadTypeSelect")
        .addEventListener("change", () => {
          // 切換顯示 schedule/class 的 UI 你已處理；這裡順手清畫面 & 嘗試讀
          document.getElementById("currentImageContainer").style.display =
            "none";
          loadCurrentImageFromDB();
        });

      document
        .getElementById("imageMonthSelect")
        .addEventListener("change", () => {
          document.getElementById("currentImageContainer").style.display =
            "none";
          loadCurrentImageFromDB();
        });

      // 靈恩佈道會相關事件監聽器
      document
        .getElementById("evgMonthStart")
        .addEventListener("change", () => {
          document.getElementById("currentImageContainer").style.display =
            "none";
          loadCurrentImageFromDB();
        });
      document
        .getElementById("evgCrossMonth")
        .addEventListener("change", () => {
          document.getElementById("currentImageContainer").style.display =
            "none";
          loadCurrentImageFromDB();
        });

      // ====== ★ 上傳圖片（使用 plugin.paths）======
      document
        .getElementById("uploadImageBtn")
        .addEventListener("click", function () {
          const plugin = window.__PLUGIN__;
          const imageUrl = document
            .getElementById("imageUrlInput")
            .value.trim();
          const selectedMonth =
            document.getElementById("imageMonthSelect").value;
          const uploadType = document.getElementById("uploadTypeSelect").value;

          if (!imageUrl) {
            alert("請輸入圖片網址！");
            return;
          }

          // 簡單的網址格式驗證
          try {
            new URL(imageUrl);
          } catch (e) {
            alert("請輸入有效的網址格式！");
            return;
          }

          if (!uploadType) {
            alert("請選擇上傳類型！");
            return;
          }

          // 如果是安排表但沒選擇年月，提示錯誤
          if (uploadType === "schedule" && !selectedMonth) {
            alert("請選擇年月！");
            return;
          }

          // 如果是靈恩佈道會但沒選擇月份，提示錯誤
          if (uploadType === "evangelistic") {
            const months = getEvangelisticMonthsFromUI();
            if (!months.length) {
              alert("請至少選擇一個活動月份！");
              return;
            }
          }

          // 根據上傳類型決定路徑（使用 plugin.paths）
          let path, payload;
          if (uploadType === "schedule") {
            path = plugin.paths.scheduleImage(selectedMonth);
            payload = imageUrl;
          } else if (uploadType === "evangelistic") {
            const months = getEvangelisticMonthsFromUI();
            path = getEvangelisticDbPath();
            payload = { url: imageUrl, months };
          } else {
            path = plugin.paths.classImage(uploadType);
            payload = imageUrl;
          }

          database.ref(path).set(payload, function (error) {
            if (error) {
              alert("上傳失敗：" + error);
            } else {
              alert(
                `成功上傳圖片網址至 Firebase！\n類型：${
                  uploadType === "schedule"
                    ? "安排表"
                    : uploadType === "evangelistic"
                    ? "靈恩佈道會"
                    : uploadType
                }\n路徑：${path}\n網址：${imageUrl}`
              );
              // 清空輸入框和預覽
              document.getElementById("imageUrlInput").value = "";
              document.getElementById("imagePreviewContainer").style.display =
                "none";
              // 上傳成功後自動重新載入目前圖片
              loadCurrentImageFromDB();
            }
          });
        });

      // 「使用者工作情形」區塊：刪除
      document.getElementById("userJobs").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-action='delete']");
        if (!btn) return;
        const user = btn.getAttribute("data-user");
        const id = btn.getAttribute("data-id");
        ensureDeletedSet(user);
        deletedJobsByUser[user].add(id);
        renderUserJobs();
        renderDeletedJobs();
      });

      // 「已刪除工作區域」：復原
      document.getElementById("deletedJobs").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-action='restore']");
        if (!btn) return;
        const user = btn.getAttribute("data-user");
        const id = btn.getAttribute("data-id");
        ensureDeletedSet(user);
        deletedJobsByUser[user].delete(id);
        renderUserJobs();
        renderDeletedJobs();
      });
    