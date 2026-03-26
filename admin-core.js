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

const adminState = (window.__ADMIN_STATE__ ||= {
  deletedJobsByUser: {},
  parsedFinalTables: null,
  currentTaskFilter: "ALL",
  tasksSignature: null,
});

function setMonthInput(val) {
  const el = document.getElementById("monthInput");
  if (el && val) el.value = val;
}

function getPluginRootBase() {
  const plugin = window.__PLUGIN__;
  if (!plugin?.paths?.scheduleImage) return "line/schedule/jgtjc";
  const ex = plugin.paths.scheduleImage("209901");
  const m = ex.match(/^(.*)\/schedule_image\/[^/]+$/);
  return m ? m[1] : "line/schedule/jgtjc";
}

function getEvangelisticDbPath() {
  return `${getPluginRootBase()}/evangelistic`;
}

function getEvangelisticStoragePath(file) {
  const ts = Date.now();
  const ext = (file?.name?.split(".").pop() || "jpg").toLowerCase();
  const year = new Date().getFullYear();
  return `public/evangelistic/${year}/${year}-${ts}.${ext}`;
}

function populateYearMonthSelect(selectEl, baseDate = new Date()) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  for (let i = -3; i <= 6; i++) {
    const d = new Date(baseDate.getFullYear(), baseDate.getMonth() + i, 1);
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

function splitTablesByEmptyRowsAndColumns(csvData) {
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

  const tables = [];
  blocks.forEach((block) => {
    const maxColumns = block.reduce((max, row) => Math.max(max, row.length), 0);
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
    return t === "" || /\d/.test(t);
  };

  tableBlocks.forEach((block) => {
    if (block.every((row) => String(row[0] ?? "").trim() === "")) {
      block.forEach((row) => row.shift());
    }

    let subTables = [];
    let currentSubTable = [];
    let emptyLineCount = 0;
    let inSubTable = false;
    let currentMode = null;

    block.forEach((row) => {
      const rowIsEmpty = isRowEmpty(row);
      emptyLineCount = rowIsEmpty ? emptyLineCount + 1 : 0;

      const rowHasHeader = hasHeader(row);
      if (rowHasHeader) {
        if (inSubTable && currentSubTable.length > 0) {
          subTables.push(currentSubTable);
          currentSubTable = [];
        }
        inSubTable = true;
        currentMode = isDateHeaderRow(row) ? "date" : "week";
        currentSubTable.push(row);
        return;
      }

      if (inSubTable) {
        if (
          !rowIsEmpty &&
          currentMode === "date" &&
          !firstCellIsNumberOrEmpty(row)
        ) {
          if (currentSubTable.length > 0) {
            subTables.push(currentSubTable);
          }
          currentSubTable = [];
          currentMode = "notes";
          currentSubTable.push(row);
          return;
        }

        if (!rowIsEmpty) currentSubTable.push(row);

        if (emptyLineCount >= 2) {
          if (currentSubTable.length > 0) subTables.push(currentSubTable);
          currentSubTable = [];
          inSubTable = false;
          currentMode = null;
        }
      }
    });

    if (currentSubTable.length > 0) subTables.push(currentSubTable);
    if (subTables.length === 0) subTables.push(block);

    finalSubTables.push(subTables);
  });

  console.log("二次切割結果：", finalSubTables);
  return finalSubTables;
}

function getWeekdayFromDate(year, month, dateNum) {
  const dt = new Date(year, month - 1, dateNum);
  return dt.getDay();
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

  function getWeekdayFromDateInner(y, m, d) {
    return new Date(y, m - 1, d).getDay();
  }

  function getDatesForWeekdayInner(y, m, weekdayNum) {
    const dates = [];
    const daysInMonth = new Date(y, m, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      if (new Date(y, m - 1, d).getDay() === weekdayNum) dates.push(d);
    }
    return dates;
  }

  finalTables.forEach((table) => {
    if (table[0][0] === "日期") {
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
                : validWeekdays[getWeekdayFromDateInner(year, month, dateVal)],
              work: table[0][j],
            });
          });
        }
      }
    } else if (table[0][0] === "星期") {
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
          const possibleDates = getDatesForWeekdayInner(
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

function transformWorkSheet(workSheet) {
  const transformedSheet = {};
  for (const personName in workSheet) {
    const cleanPersonName = personName.replace(/\//g, "");
    transformedSheet[cleanPersonName] = workSheet[personName].reduce(
      (acc, item) => {
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

const makeJobId = (job) => `${job.date}__${job.timeSlot}__${job.task}`;
window.__ACTIVE_SHEET_PARSE_TAB__ = "general";

function normTask(s) {
  return String(s || "").replace(/\s+/g, "").trim();
}

function collectVisibleTasks() {
  if (!window.__FINAL__) return [];
  const tasks = new Set();
  for (const [user, jobs] of Object.entries(window.__FINAL__)) {
    const delSet = adminState.deletedJobsByUser[user] || new Set();
    jobs.forEach((job) => {
      if (!delSet.has(makeJobId(job))) tasks.add(normTask(job.task));
    });
  }
  return Array.from(tasks).sort();
}

function refreshTaskFilterOptions() {
  const sel = document.getElementById("jobFilterSelect");
  if (!sel) return;

  const tasks = collectVisibleTasks();
  const prev = adminState.currentTaskFilter;

  sel.innerHTML = `<option value="ALL">（全部工作）</option>`;
  tasks.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    sel.appendChild(opt);
  });

  sel.disabled = false;

  const values = new Set(tasks.concat(["ALL"]));
  if (!values.has(normTask(prev))) {
    adminState.currentTaskFilter = "ALL";
    sel.value = "ALL";
  } else {
    sel.value = prev;
  }

  console.log("[refreshTaskFilterOptions] tasks=", tasks);
  console.log("[refreshTaskFilterOptions] disabled=", sel.disabled);
  console.log("[refreshTaskFilterOptions] sel.value=", sel.value);

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
  if (!adminState.deletedJobsByUser[user]) {
    adminState.deletedJobsByUser[user] = new Set();
  }
}

function buildUploadPayload() {
  if (!window.__FINAL__) return null;
  const result = {};
  for (const [user, jobs] of Object.entries(window.__FINAL__)) {
    const delSet = adminState.deletedJobsByUser[user] || new Set();
    const kept = jobs.filter((job) => !delSet.has(makeJobId(job)));
    if (kept.length > 0) result[user] = kept;
  }
  return result;
}

function renderUserJobs() {
  console.log("[render] currentTaskFilter =", adminState.currentTaskFilter);
  const container = document.getElementById("userJobs");
  container.innerHTML = "";
  if (!window.__FINAL__) {
    container.innerHTML =
      '<div style="text-align:center;color:var(--muted);padding:20px">尚未產生工作清單</div>';
    refreshTaskFilterOptions();
    return;
  }

  const visibleByUser = {};
  for (const [user, jobs] of Object.entries(window.__FINAL__)) {
    const delSet = adminState.deletedJobsByUser[user] || new Set();
    visibleByUser[user] = jobs.filter((job) => !delSet.has(makeJobId(job)));
  }

  const taskFilter = adminState.currentTaskFilter;
  const filteredUsers = Object.entries(visibleByUser).filter(([_, jobs]) => {
    if (taskFilter === "ALL") return true;
    return jobs.some((j) => normTask(j.task) === normTask(taskFilter));
  });

  if (filteredUsers.length === 0) {
    container.innerHTML =
      '<div style="text-align:center;color:var(--muted);padding:20px">沒有符合條件的成員</div>';
    refreshTaskFilterOptions();
    return;
  }

  filteredUsers.forEach(([user, visibleJobs]) => {
    const card = document.createElement("div");
    card.className = "user-card";
    const title = document.createElement("h4");
    title.textContent = user;
    card.appendChild(title);

    const jobsForDisplay =
      taskFilter === "ALL"
        ? visibleJobs
        : visibleJobs.filter((j) => normTask(j.task) === normTask(taskFilter));

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

  const nowSig = collectVisibleTasks().join("|");
  if (nowSig !== adminState.tasksSignature) {
    adminState.tasksSignature = nowSig;
    refreshTaskFilterOptions();
  }
}

function renderDeletedJobs() {
  const container = document.getElementById("deletedJobs");
  container.innerHTML = "";

  const blocks = [];
  for (const [user, jobs] of Object.entries(window.__FINAL__ || {})) {
    const delSet = adminState.deletedJobsByUser[user] || new Set();
    const deletedList = jobs.filter((job) => delSet.has(makeJobId(job)));
    if (deletedList.length > 0) {
      blocks.push({ user, deletedList });
    }
  }

  if (blocks.length === 0) {
    container.innerHTML =
      '<div style="text-align:center;color:var(--muted);padding:20px">尚無已刪除的工作</div>';
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

function showToast(message, type = "info", duration = 3000) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, duration);
}

function initializeImageUpload() {
  const select = document.getElementById("imageMonthSelect");
  const currentDate = new Date();

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

    if (i === 0) {
      option.selected = true;
    }

    select.appendChild(option);
  }

  populateSpiritualEventSelect(document.getElementById("spiritualEventSelect"));
}

function populateSpiritualEventSelect(selectEl, baseDate = new Date()) {
  if (!selectEl) return;
  const year = baseDate.getFullYear();
  const options = [
    { value: `${year}_spring`, label: `${year}_spring` },
    { value: `${year}_autumn`, label: `${year}_autumn` },
  ];

  selectEl.innerHTML = "";
  options.forEach((item, index) => {
    const opt = document.createElement("option");
    opt.value = item.value;
    opt.textContent = item.label;
    if (index === 0) opt.selected = true;
    selectEl.appendChild(opt);
  });
}

function initializeUploadTypeHandler() {
  const uploadTypeSelect = document.getElementById("uploadTypeSelect");
  const monthSelectContainer = document.getElementById("monthSelectContainer");
  const evgFields = document.getElementById("evangelisticFields");

  uploadTypeSelect.addEventListener("change", function () {
    const selectedType = this.value;

    if (selectedType === "schedule") {
      monthSelectContainer.style.display = "block";
      evgFields.style.display = "none";
    } else if (selectedType === "evangelistic") {
      monthSelectContainer.style.display = "none";
      evgFields.style.display = "block";
    } else {
      monthSelectContainer.style.display = "none";
      evgFields.style.display = "none";
    }
  });

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

document.addEventListener("DOMContentLoaded", function () {
  initializeImageUpload();
  initializeUploadTypeHandler();
  updatePluginInfo();

  loadCurrentImageFromDB();
  const sel = document.getElementById("jobFilterSelect");
  if (sel) {
    const onSelectChange = () => {
      adminState.currentTaskFilter = sel.value || "ALL";
      console.log("[filter changed:direct]", adminState.currentTaskFilter);
      renderUserJobs();
    };
    sel.addEventListener("change", onSelectChange);
    sel.addEventListener("input", onSelectChange);
    refreshTaskFilterOptions();
  }

  document.addEventListener(
    "change",
    (e) => {
      const t = e.target;
      if (t && t.id === "jobFilterSelect") {
        adminState.currentTaskFilter = t.value || "ALL";
        console.log("[filter changed:delegated]", adminState.currentTaskFilter);
        renderUserJobs();
      }
    },
    true
  );
});

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
    if (e.key === "Escape" && backdrop.style.display === "flex") closeModal();
  });

  function openJsonIfParsed() {
    if (!adminState.parsedFinalTables) {
      showToast("尚未進行資料解析，請先點擊『抓取資料並解析』。", "error");
      return;
    }
    updateJsonModalContent(adminState.parsedFinalTables);
    openModal();
  }

  ["openJsonModalBtn", "openJsonModalBtnSpiritual"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", openJsonIfParsed);
  });
})();
