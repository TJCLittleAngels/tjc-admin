(function setupSpiritualParserFlag() {
  window.USE_NEW_SPIRITUAL_SHEET_PARSER = true;
})();

function updateUploadKeyUI() {
  const label = document.getElementById("uploadKeyLabel");
  const input = document.getElementById("monthInput");
  const isSpiritual = window.__ACTIVE_SHEET_PARSE_TAB__ === "spiritual";
  if (!label || !input) return;

  if (isSpiritual) {
    label.textContent = "活動代號 (例如：2026_spring)";
    input.placeholder = "2026_spring";
  } else {
    label.textContent = "月份 (格式：yyyymm)";
    input.placeholder = "202503";
  }
}

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
    window.__ACTIVE_SHEET_PARSE_TAB__ = isSpiritual ? "spiritual" : "general";
    panelGeneral.hidden = isSpiritual;
    panelSpiritual.hidden = !isSpiritual;
    tabGeneral.classList.toggle("active", !isSpiritual);
    tabSpiritual.classList.toggle("active", isSpiritual);
    tabGeneral.setAttribute("aria-selected", (!isSpiritual).toString());
    tabSpiritual.setAttribute("aria-selected", isSpiritual.toString());
    const url = new URL(window.location.href);
    url.searchParams.set("tab", isSpiritual ? "spiritual" : "general");
    window.history.replaceState({}, "", url);
    updateUploadKeyUI();
  }

  tabGeneral.addEventListener("click", () => activate("general"));
  tabSpiritual.addEventListener("click", () => activate("spiritual"));

  const initialTab =
    new URLSearchParams(window.location.search).get("tab") === "spiritual"
      ? "spiritual"
      : "general";
  activate(initialTab);
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

function wireParseUrlButton(btn) {
  if (!btn) return;
  btn.addEventListener("click", function () {
    const panel = this.closest("[data-sheet-parse-panel]");
    const { urlInput, sheetIdInput, gidInput } = inputsFromParsePanel(panel);
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

async function runFetchAndParseFromPanel(panel) {
  const plugin = window.__PLUGIN__;
  window.__ACTIVE_SHEET_PARSE_TAB__ = parsePanelMode(panel);

  if (
    window.__ACTIVE_SHEET_PARSE_TAB__ === "spiritual" &&
    window.USE_NEW_SPIRITUAL_SHEET_PARSER &&
    typeof window.runFetchAndParseSpiritualPanelNew === "function"
  ) {
    return window.runFetchAndParseSpiritualPanelNew(panel);
  }

  const { sheetIdInput, gidInput } = inputsFromParsePanel(panel);
  const sheetId = (sheetIdInput && sheetIdInput.value.trim()) || "";
  const gid = (gidInput && gidInput.value.trim()) || "0";
  if (!sheetId) return alert("請先填入 sheetId！");

  showToast("解析中...", "info");

  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&id=${sheetId}&gid=${gid}`;
  try {
    const csvText = await fetch(csvUrl).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    });

    const parsed = Papa.parse(csvText).data;
    const { csv2d, hints } = plugin.preprocess(parsed, { setMonthInput });

    const tableBlocks = splitTablesByEmptyRowsAndColumns(csv2d);
    const dateSubTables = splitTablesByDateKeyword(tableBlocks);
    const flatTables = [];
    dateSubTables.forEach((blocks) => blocks.forEach((t) => flatTables.push(t)));

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
      return table.map((row) => row.filter((_, idx) => !emptyCols.includes(idx)));
    };

    const validFlatTables = flatTables
      .map(removeEmptyColumns)
      .filter((t) => t.some((row) => row.some((cell) => String(cell ?? "") !== "")));

    const ymFromHeader = plugin.extractYearMonthFromHeaderRow(validFlatTables?.[0]?.[0]);
    const yyyymm =
      hints?.month || (ymFromHeader ? ymFromHeader.year + ymFromHeader.month : null);
    if (yyyymm) setMonthInput(yyyymm);

    const validTables = validFlatTables.filter((t) => {
      const head = (t[0]?.[0] || "").trim();
      return head === "日期" || head === "星期";
    });

    const errors = plugin.validate({ validTables });
    if (errors.length) alert(errors.join("\n"));

    const finalTables = plugin.normalizeTables(validTables, { yyyymm });
    const ym = yyyymm
      ? { year: yyyymm.slice(0, 4), month: yyyymm.slice(4) }
      : ymFromHeader || { year: "", month: "" };

    const workSheet = tablesToWork(finalTables, ym, (x) => plugin.nameSplitter(x));
    let finalTransformedSheet = transformWorkSheet(workSheet);

    finalTransformedSheet = plugin.postprocess(finalTransformedSheet, { yyyymm });
    window.__FINAL__ = finalTransformedSheet;

    console.log("[FINAL keys] users =", Object.keys(window.__FINAL__ || {}));
    console.log(
      "[FINAL sample]",
      window.__FINAL__ && window.__FINAL__[Object.keys(window.__FINAL__)[0]]
    );
    console.log("[sheet parse tab]", window.__ACTIVE_SHEET_PARSE_TAB__);

    adminState.deletedJobsByUser = {};
    renderUserJobs();
    renderDeletedJobs();

    adminState.tasksSignature = null;
    refreshTaskFilterOptions();
    console.log("[after parse] options=", collectVisibleTasks());

    adminState.parsedFinalTables = finalTables;
    updateJsonModalContent(adminState.parsedFinalTables);
    showToast("解析完成！", "success");
  } catch (e) {
    console.error(e);
    adminState.parsedFinalTables = null;
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

document.getElementById("uploadBtn").addEventListener("click", function () {
  const plugin = window.__PLUGIN__;
  if (!window.__FINAL__) {
    alert("尚未生成工作表資料，請先『抓取資料並解析』！");
    return;
  }

  const inputValue = document.getElementById("monthInput").value.trim();
  const payload = buildUploadPayload();
  if (!payload || Object.keys(payload).length === 0) {
    return alert("目前沒有可上傳的工作（可能全部被刪除）");
  }

  if (window.__ACTIVE_SHEET_PARSE_TAB__ === "spiritual") {
    const eventKey = inputValue;
    if (!eventKey || !/^[a-zA-Z0-9_-]+$/.test(eventKey)) {
      alert("請輸入活動代號，例如：2026_spring");
      return;
    }

    const spiritualMeta = window.__SPIRITUAL_UPLOAD_META__ || {};
    const path = `line/schedule/${plugin.namespace}/spiritual/events/${eventKey}`;
    const spiritualPayload = {
      meta: {
        eventKey,
        label: spiritualMeta.label || eventKey,
        startDate: spiritualMeta.startDate || "",
        endDate: spiritualMeta.endDate || "",
      },
      jobs: payload,
    };

    database.ref(path).set(spiritualPayload, function (error) {
      if (error) {
        alert("上傳失敗：" + error);
      } else {
        alert(`成功上傳靈恩會工作表！\n路徑：${path}`);
      }
    });
    return;
  }

  const month = inputValue;
  if (!month || !/^\d{6}$/.test(month)) {
    alert("請輸入正確格式的月份 (yyyymm)");
    return;
  }

  const path = plugin.paths.scheduleData(month);
  database.ref(path).set(payload, function (error) {
    if (error) {
      alert("上傳失敗：" + error);
    } else {
      alert("成功上傳（已自動排除已刪除的工作）！");
    }
  });
});
