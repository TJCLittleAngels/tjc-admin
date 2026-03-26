// 靈恩會安排表解析器。
// 目前先完整沿用舊解析流程，後續可直接在這份檔案上逐步修改。

const SPIRITUAL_EXPECTED_TABLE_COUNT = 5;
const spiritualTableMetaStore = new WeakMap();

function preprocessSpiritualSheetCsv(csv2d) {
  const next = csv2d.map((row) => [...row]);

  for (let r = 0; r < next.length; r++) {
    for (let c = 0; c < next[r].length; c++) {
      const raw = String(next[r][c] ?? "").trim();
      const splitMatch = raw.match(/^大門\s*\/\s*副堂$/);
      const rightCell = String(next[r][c + 1] ?? "").trim();
      if (splitMatch && rightCell === "") {
        next[r][c] = "大門";
        next[r][c + 1] = "副堂";
        console.log("[靈恩會前處理] 拆分斜線欄位", {
          row: r + 1,
          col: c + 1,
          left: next[r][c],
          right: next[r][c + 1],
        });
      }
    }
  }

  for (let r = 0; r < next.length - 1; r++) {
    for (let c = 0; c < next[r].length; c++) {
      const cell = String(next[r][c] ?? "").trim();
      if (cell !== "日期") continue;

      const below = String(next[r + 1]?.[c] ?? "").trim();
      if (below === "") {
        next[r + 1][c] = "-";
        console.log("[靈恩會前處理] v1 已補日期下方空白", {
          row: r + 2,
          col: c + 1,
          value: "-",
        });
      }
    }
  }

  return next;
}

function splitTablesByDateKeywordWithContext(tableBlocks) {
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

  const cloneRow = (row) => (Array.isArray(row) ? [...row] : null);
  const saveMeta = (table, meta) => {
    if (Array.isArray(table) && table.length > 0) {
      spiritualTableMetaStore.set(table, meta);
    }
  };

  tableBlocks.forEach((block, blockIndex) => {
    if (block.every((row) => String(row[0] ?? "").trim() === "")) {
      block.forEach((row) => row.shift());
    }

    let subTables = [];
    let currentSubTable = [];
    let emptyLineCount = 0;
    let inSubTable = false;
    let currentMode = null;
    let currentContextRow = null;
    let currentHeaderRowIndex = -1;

    block.forEach((row, rowIndex) => {
      const rowIsEmpty = isRowEmpty(row);
      emptyLineCount = rowIsEmpty ? emptyLineCount + 1 : 0;

      const rowHasHeader = hasHeader(row);
      if (rowHasHeader) {
        if (inSubTable && currentSubTable.length > 0) {
          saveMeta(currentSubTable, {
            blockIndex,
            contextRow: currentContextRow,
            headerRowIndex: currentHeaderRowIndex,
          });
          subTables.push(currentSubTable);
          currentSubTable = [];
        }
        inSubTable = true;
        currentMode = isDateHeaderRow(row) ? "date" : "week";
        currentHeaderRowIndex = rowIndex;
        currentContextRow =
          rowIndex > 0 && !isRowEmpty(block[rowIndex - 1])
            ? cloneRow(block[rowIndex - 1])
            : null;
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
            saveMeta(currentSubTable, {
              blockIndex,
              contextRow: currentContextRow,
              headerRowIndex: currentHeaderRowIndex,
            });
            subTables.push(currentSubTable);
          }
          currentSubTable = [];
          currentMode = "notes";
          currentSubTable.push(row);
          return;
        }

        if (!rowIsEmpty) currentSubTable.push(row);

        if (emptyLineCount >= 2) {
          if (currentSubTable.length > 0) {
            saveMeta(currentSubTable, {
              blockIndex,
              contextRow: currentContextRow,
              headerRowIndex: currentHeaderRowIndex,
            });
            subTables.push(currentSubTable);
          }
          currentSubTable = [];
          inSubTable = false;
          currentMode = null;
          currentContextRow = null;
          currentHeaderRowIndex = -1;
        }
      }
    });

    if (currentSubTable.length > 0) {
      saveMeta(currentSubTable, {
        blockIndex,
        contextRow: currentContextRow,
        headerRowIndex: currentHeaderRowIndex,
      });
      subTables.push(currentSubTable);
    }
    if (subTables.length === 0) {
      saveMeta(block, {
        blockIndex,
        contextRow: null,
        headerRowIndex: -1,
      });
      subTables.push(block);
    }

    finalSubTables.push(subTables);
  });

  console.log("二次切割結果：", finalSubTables);
  return finalSubTables;
}

function getSpiritualTableMeta(table) {
  return spiritualTableMetaStore.get(table) || null;
}

function setSpiritualTableMeta(table, meta) {
  if (Array.isArray(table) && table.length > 0 && meta) {
    spiritualTableMetaStore.set(table, meta);
  }
}

function getSpiritualTableDisplayName(table) {
  const meta = getSpiritualTableMeta(table);
  const contextValues = (meta?.contextRow || [])
    .map((cell) => String(cell ?? "").trim())
    .filter(Boolean);

  if (contextValues.length) {
    return contextValues.join(" / ");
  }

  const header = String(table?.[0]?.[0] ?? "").trim();
  if (header === "日期") return "日期表";
  if (header === "星期") return "星期表";
  return header || "未命名表格";
}

function parsePrayerMeetingTable(table, ym, nameSplitter) {
  const workSheet = {};
  const previewJobs = [];
  const weekdayText = ["日", "一", "二", "三", "四", "五", "六"];

  for (let i = 1; i < table.length; i++) {
    const parsedDate = parseSpiritualDateValue(table[i]?.[0], ym);
    const timeSlot = String(table[i]?.[1] ?? "").trim();
    if (!parsedDate || !timeSlot) continue;

    for (let j = 2; j < table[i].length; j++) {
      const task = String(table[0]?.[j] ?? "").trim();
      const rawNames = String(table[i]?.[j] ?? "").trim();
      if (!task || !rawNames || rawNames === "-") continue;

      splitSpiritualNames(rawNames, nameSplitter).forEach((person) => {
        const clean = String(person ?? "").trim().replace(/\s+/g, "");
        if (!clean) return;

        const job = {
          date: parsedDate.displayDate,
          weekDay: weekdayText[parsedDate.actualDate.getDay()],
          work: `${timeSlot}禱告會${task}`,
        };
        if (!workSheet[clean]) workSheet[clean] = [];
        workSheet[clean].push(job);
        previewJobs.push({
          person: clean,
          ...job,
        });
      });
    }
  }

  console.log("[靈恩會特別處理] 禱告會工作日期對照清單", previewJobs);

  return workSheet;
}

function cleanupSpiritualTableBlocks(tableBlocks) {
  return tableBlocks.map((block, blockIndex) =>
    block.filter((row, rowIndex) => {
      const firstNonEmptyIndex = row.findIndex(
        (cell) => String(cell ?? "").trim() !== "",
      );
      if (firstNonEmptyIndex === -1) return true;

      const firstCell = String(row[firstNonEmptyIndex] ?? "").trim();
      const restCells = row
        .slice(firstNonEmptyIndex + 1)
        .every((cell) => String(cell ?? "").trim() === "");
      const shouldRemove = firstCell.startsWith("-") && restCells;

      if (shouldRemove) {
        console.log("[靈恩會前處理] 移除無效列", {
          block: blockIndex + 1,
          row: rowIndex + 1,
          col: firstNonEmptyIndex + 1,
          firstCell,
        });
      }

      return !shouldRemove;
    }),
  );
}

function parseSpiritualDateValue(raw, fallbackYearMonth = {}) {
  const text = String(raw ?? "").trim();
  if (!text) return null;

  let m = text.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const month = String(parseInt(m[1], 10)).padStart(2, "0");
    const day = String(parseInt(m[2], 10)).padStart(2, "0");
    const year = String(fallbackYearMonth.year || "");
    if (!year) return null;
    return {
      raw: text,
      month,
      day,
      displayDate: `${parseInt(m[1], 10)}/${parseInt(m[2], 10)}`,
      actualDate: new Date(Number(year), Number(month) - 1, Number(day)),
    };
  }

  m = text.match(/^(\d{1,2})$/);
  if (m) {
    const year = String(fallbackYearMonth.year || "");
    const month = String(fallbackYearMonth.month || "");
    if (!year || !month) return null;
    const day = String(parseInt(m[1], 10)).padStart(2, "0");
    return {
      raw: text,
      month,
      day,
      displayDate: String(parseInt(m[1], 10)),
      actualDate: new Date(Number(year), Number(month) - 1, Number(day)),
    };
  }

  return null;
}

function splitSpiritualNames(rawNames, nameSplitter) {
  const normalized = String(rawNames ?? "")
    .replace(/[|｜│]+/g, " ")
    .trim();
  return nameSplitter(normalized);
}

function normalizeSpiritualWorkName(work) {
  const text = String(work ?? "").trim();
  if (text === "1樓/大門") return "1樓接待(大門)";
  if (text === "副堂") return "1樓接待(副堂)";
  if (text === "2樓/記錄") return "2樓接待(記錄)";
  return text;
}

function extractSpiritualYearFromTables(flatTables) {
  for (const table of flatTables) {
    for (const row of table) {
      for (const cell of row) {
        const text = String(cell ?? "").trim();
        const m = text.match(/(\d{4})年/);
        if (m) {
          return m[1];
        }
      }
    }
  }
  return null;
}

function inferSpiritualEventMeta(flatTables, ym) {
  let title = "";
  for (const table of flatTables) {
    for (const row of table) {
      for (const cell of row) {
        const text = String(cell ?? "").trim();
        if (text.includes("靈恩佈道會安排表")) {
          title = text;
          break;
        }
      }
      if (title) break;
    }
    if (title) break;
  }

  const seasonMap = {
    春季: "spring",
    秋季: "autumn",
  };
  const seasonEntry =
    Object.entries(seasonMap).find(([label]) => title.includes(label)) || [];
  const seasonLabel = seasonEntry[0] || "";
  const seasonKey = seasonEntry[1] || "";

  const eventYear = ym?.year || extractSpiritualYearFromTables(flatTables) || "";
  const dates = [];
  flatTables.forEach((table) => {
    table.forEach((row) => {
      row.forEach((cell) => {
        const parsed = parseSpiritualDateValue(cell, ym);
        if (parsed) dates.push(parsed.actualDate);
      });
    });
  });
  dates.sort((a, b) => a - b);

  const formatIsoDate = (date) => {
    if (!date) return "";
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  return {
    label:
      eventYear && seasonLabel
        ? `${eventYear} ${seasonLabel}靈恩佈道會`
        : title || "靈恩佈道會",
    eventKey:
      eventYear && seasonKey ? `${eventYear}_${seasonKey}` : "",
    startDate: formatIsoDate(dates[0]),
    endDate: formatIsoDate(dates[dates.length - 1]),
    sourceTitle: title,
  };
}

function findColumnIndexByHeaderValue(table, target) {
  for (let r = 0; r < table.length; r++) {
    for (let c = 0; c < table[r].length; c++) {
      if (String(table[r][c] ?? "").trim() === target) {
        return { rowIndex: r, colIndex: c };
      }
    }
  }
  return null;
}

function addSpiritualSpecialJob(workSheet, person, job) {
  const clean = String(person ?? "").trim().replace(/\s+/g, "");
  if (!clean || clean === "-") return;
  if (!workSheet[clean]) workSheet[clean] = [];
  workSheet[clean].push(job);
}

function mergeSpiritualWorkSheet(target, incoming) {
  Object.entries(incoming || {}).forEach(([person, jobs]) => {
    if (!target[person]) target[person] = [];
    target[person].push(...jobs);
  });
  return target;
}

function isSpiritualSectionTitleRow(row) {
  const values = row.map((cell) => String(cell ?? "").trim());
  if (!values[0]) return false;
  return values.slice(1).every((value) => value === "");
}

function splitSpiritualSpecialSections(table) {
  const sections = [];
  let current = null;

  table.forEach((row) => {
    if (isSpiritualSectionTitleRow(row)) {
      if (current) sections.push(current);
      current = {
        title: String(row[0] ?? "").trim(),
        rows: [],
      };
      return;
    }

    if (!current) {
      current = { title: "未命名區段", rows: [] };
    }
    current.rows.push(row);
  });

  if (current) sections.push(current);
  return sections;
}

function parseBaptismSpecialSection(section, ym, nameSplitter) {
  const workSheet = {};
  const previewJobs = [];
  const weekdayText = ["日", "一", "二", "三", "四", "五", "六"];

  for (let i = 0; i < section.rows.length; i++) {
    const headerRow = section.rows[i];
    const parsedDate = parseSpiritualDateValue(headerRow?.[0], ym);
    const timeSlot = String(headerRow?.[1] ?? "").trim();
    const namesRow = section.rows[i + 1];

    if (!parsedDate || !timeSlot || !namesRow) continue;
    if (String(namesRow?.[0] ?? "").trim() !== "") continue;
    if (String(namesRow?.[1] ?? "").trim() !== "") continue;

    for (let c = 2; c < headerRow.length; c++) {
      const task = String(headerRow[c] ?? "").trim();
      const rawNames = String(namesRow[c] ?? "").trim();
      if (!task || !rawNames || rawNames === "-") continue;

      splitSpiritualNames(rawNames, nameSplitter).forEach((person) => {
        const job = {
          date: parsedDate.displayDate,
          weekDay: weekdayText[parsedDate.actualDate.getDay()],
          work: `${timeSlot} ${section.title}-${task}`,
          person: String(person ?? "").trim().replace(/\s+/g, ""),
        };
        previewJobs.push(job);
        addSpiritualSpecialJob(workSheet, person, {
          date: job.date,
          weekDay: job.weekDay,
          work: job.work,
        });
      });
    }

    i += 1;
  }

  console.log("[靈恩會特別處理] 洗禮區段工作日期對照清單", previewJobs);

  return workSheet;
}

function parseCommunionPreparationSection(section, ym, nameSplitter) {
  const workSheet = {};
  const previewJobs = [];
  const weekdayText = ["日", "一", "二", "三", "四", "五", "六"];
  let currentLeftDate = null;
  let currentRightTask = "";
  let currentRightPeople = [];

  section.rows.forEach((row) => {
    const parsedLeftDate = parseSpiritualDateValue(row?.[0], ym);
    if (parsedLeftDate) currentLeftDate = parsedLeftDate;
    const leftDate = currentLeftDate;
    const leftTask = String(row?.[1] ?? "").trim();
    const leftPeople = [row?.[2], row?.[3]];

    if (leftDate && leftTask) {
      leftPeople.forEach((rawNames) => {
        const text = String(rawNames ?? "").trim();
        if (!text || text === "-") return;

        splitSpiritualNames(text, nameSplitter).forEach((person) => {
          const job = {
            date: leftDate.displayDate,
            weekDay: weekdayText[leftDate.actualDate.getDay()],
            work: `${section.title}-${leftTask}`,
            person: String(person ?? "").trim().replace(/\s+/g, ""),
          };
          previewJobs.push(job);
          addSpiritualSpecialJob(workSheet, person, {
            date: job.date,
            weekDay: job.weekDay,
            work: job.work,
          });
        });
      });
    }

    const rightDate = parseSpiritualDateValue(row?.[4], ym);
    const rawRightTask = String(row?.[5] ?? "").trim();
    if (rawRightTask) currentRightTask = rawRightTask;
    const rightTask = currentRightTask;

    const rawRightPeople = [row?.[6], row?.[7]]
      .map((cell) => String(cell ?? "").trim())
      .filter((cell) => cell && cell !== "-");
    if (rawRightPeople.length) currentRightPeople = rawRightPeople;
    const rightPeople = currentRightPeople;

    if (rightDate && rightTask) {
      rightPeople.forEach((rawNames) => {
        const text = String(rawNames ?? "").trim();
        if (!text || text === "-") return;

        splitSpiritualNames(text, nameSplitter).forEach((person) => {
          const job = {
            date: rightDate.displayDate,
            weekDay: weekdayText[rightDate.actualDate.getDay()],
            work: `${section.title}-${rightTask}`,
            person: String(person ?? "").trim().replace(/\s+/g, ""),
          };
          previewJobs.push(job);
          addSpiritualSpecialJob(workSheet, person, {
            date: job.date,
            weekDay: job.weekDay,
            work: job.work,
          });
        });
      });
    }
  });

  console.log("[靈恩會特別處理] 聖餐準備區段工作日期對照清單", previewJobs);

  return workSheet;
}

function extractSpiritualSpecialBlocks(flatTables, ym, nameSplitter) {
  const remainingTables = [];
  const specialWorkSheet = {};

  flatTables.forEach((table, index) => {
    const head = String(table?.[0]?.[0] ?? "").trim();
    if (head !== "洗禮") {
      remainingTables.push(table);
      return;
    }

    console.log("[靈恩會特別處理] 擷取洗禮區塊", {
      tableIndex: index + 1,
      firstRow: table[0],
    });

    const sections = splitSpiritualSpecialSections(table);
    sections.forEach((section) => {
      console.log("[靈恩會特別處理] 區段", {
        title: section.title,
        rows: section.rows,
      });

      if (section.title === "洗禮") {
        mergeSpiritualWorkSheet(
          specialWorkSheet,
          parseBaptismSpecialSection(section, ym, nameSplitter),
        );
      } else if (section.title === "聖餐準備") {
        mergeSpiritualWorkSheet(
          specialWorkSheet,
          parseCommunionPreparationSection(section, ym, nameSplitter),
        );
      }
    });
  });

  return { specialWorkSheet, remainingTables };
}

function buildSpiritualWeekContext(flatTables, { year, month }) {
  const weekdayMapping = {
    日: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
  };
  const weekdayText = ["日", "一", "二", "三", "四", "五", "六"];

  const dates = [];
  const weekdayToDates = {};
  const seen = new Set();

  flatTables.forEach((table, tableIndex) => {
    const dateHeader = findColumnIndexByHeaderValue(table, "日期");
    const weekdayHeader = findColumnIndexByHeaderValue(table, "星期");
    if (!dateHeader || !weekdayHeader) return;

    console.log("[靈恩會週期檢核] 掃描日期對照來源區塊", {
      tableIndex: tableIndex + 1,
      dateHeader,
      weekdayHeader,
      firstRows: table.slice(0, 6),
    });

    const startRow = Math.max(dateHeader.rowIndex, weekdayHeader.rowIndex) + 1;
    for (let r = startRow; r < table.length; r++) {
      const rawDate = String(table[r]?.[dateHeader.colIndex] ?? "").trim();
      const rawWeekday = String(table[r]?.[weekdayHeader.colIndex] ?? "").trim();
      const parsedDate = parseSpiritualDateValue(rawDate, { year, month });
      if (!parsedDate) continue;

      const weekdayChar = rawWeekday[0] || weekdayText[parsedDate.actualDate.getDay()];
      const dateKey = `${parsedDate.actualDate.getFullYear()}-${String(
        parsedDate.actualDate.getMonth() + 1,
      ).padStart(2, "0")}-${String(parsedDate.actualDate.getDate()).padStart(
        2,
        "0",
      )}`;
      if (seen.has(dateKey)) continue;
      seen.add(dateKey);

      dates.push({
        date: parsedDate.displayDate,
        month: parsedDate.month,
        day: parsedDate.day,
        actualDate: parsedDate.actualDate,
        weekdayChar,
      });

      if (!weekdayToDates[weekdayChar]) weekdayToDates[weekdayChar] = [];
      weekdayToDates[weekdayChar].push(parsedDate.displayDate);
    }
  });

  dates.sort((a, b) => a.actualDate - b.actualDate);

  const errors = [];
  if (!dates.length) {
    errors.push(
      "靈恩會解析需要至少一張含「日期」欄位的表格，才能建立單週日期對照。",
    );
    return { dates, weekdayToDates, errors };
  }

  const start = dates[0].actualDate;
  const end = dates[dates.length - 1].actualDate;
  const diffDays = Math.round((end - start) / 86400000);

  if (start.getDay() !== weekdayMapping["二"]) {
    errors.push(
      `靈恩會起始日期預期為週二，實際為週${weekdayText[start.getDay()]}（${dates[0].date}）。`,
    );
  }
  if (diffDays > 5) {
    errors.push(
      `靈恩會日期範圍預期落在同一週的週二到週日，目前跨度為 ${diffDays + 1} 天。`,
    );
  }

  dates.forEach((item) => {
    const actualWeekday = weekdayText[item.actualDate.getDay()];
    if (item.weekdayChar !== actualWeekday) {
      errors.push(
        `日期 ${item.date} 的星期標示為「${item.weekdayChar}」，但計算結果為「${actualWeekday}」。`,
      );
    }
  });

  console.log("[靈恩會週期檢核]", {
    year,
    month,
    dates: dates.map((x) => ({
      date: x.date,
      weekday: x.weekdayChar,
    })),
    errors,
  });

  return { dates, weekdayToDates, errors };
}

function spiritualTablesToWork(
  finalTables,
  { year, month },
  nameSplitter,
  weekContext,
) {
  const workSheet = {};
  const validWeekdays = ["日", "一", "二", "三", "四", "五", "六"];

  finalTables.forEach((table, tableIndex) => {
    const tableJobs = [];
    const tableName = getSpiritualTableDisplayName(table);
    const tableMeta = getSpiritualTableMeta(table);

    if (tableName === "禱告會") {
      const prayerWorkSheet = parsePrayerMeetingTable(
        table,
        { year, month },
        nameSplitter,
      );
      mergeSpiritualWorkSheet(workSheet, prayerWorkSheet);
      return;
    }

    if (table[0]?.[0] === "日期") {
      const hasWeekday = table[0]?.[1] === "星期";
      const workStartIndex = hasWeekday ? 2 : 1;

      for (let i = 1; i < table.length; i++) {
        const rawDate = String(table[i]?.[0] ?? "").trim();
        const parsedDate = parseSpiritualDateValue(rawDate, { year, month });
        if (!parsedDate) continue;

        const weekDay =
          (hasWeekday ? String(table[i]?.[1] ?? "").trim() : "") ||
          ["日", "一", "二", "三", "四", "五", "六"][
            parsedDate.actualDate.getDay()
          ];

        for (let j = workStartIndex; j < table[i].length; j++) {
          const cellVal = String(table[i][j] ?? "").trim();
          if (cellVal === "" || cellVal === "-") continue;

          const people = splitSpiritualNames(cellVal, nameSplitter);
          people.forEach((personName) => {
            const clean = personName.trim().replace(/\s+/g, "");
            if (!clean) return;
            const job = {
              date: parsedDate.displayDate,
              weekDay,
              work: normalizeSpiritualWorkName(table[0][j]),
            };
            if (!workSheet[clean]) workSheet[clean] = [];
            workSheet[clean].push(job);
            tableJobs.push({
              person: clean,
              ...job,
            });
          });
        }
      }
      console.log("[靈恩會有效表格輸出]", {
        tableIndex: tableIndex + 1,
        tableName,
        tableType: "日期表",
        tableMeta,
        header: table[0],
        jobs: tableJobs,
      });
      return;
    }

    if (table[0]?.[0] === "星期") {
      for (let i = 1; i < table.length; i++) {
        const targetWeekday = String(table[i]?.[0] ?? "").trim();
        const weekdayChar = targetWeekday[0];
        if (!validWeekdays.includes(weekdayChar)) {
          console.warn("[靈恩會解析] 偵測到無效星期:", targetWeekday);
          continue;
        }

        const exactDates = weekContext.weekdayToDates[weekdayChar] || [];
        if (!exactDates.length) {
          console.warn("[靈恩會解析] 找不到對應日期:", targetWeekday);
          continue;
        }

        for (let j = 1; j < table[i].length; j++) {
          const person = String(table[i][j] ?? "")
            .trim()
            .replace(/\s+/g, "");
          if (person === "" || person === "-") continue;

          exactDates.forEach((d) => {
            const job = {
              date: d,
              weekDay: targetWeekday,
              work: normalizeSpiritualWorkName(table[0][j]),
            };
            if (!workSheet[person]) {
              workSheet[person] = [];
            }
            workSheet[person].push(job);
            tableJobs.push({
              person,
              ...job,
            });
          });
        }
      }
      console.log("[靈恩會有效表格輸出]", {
        tableIndex: tableIndex + 1,
        tableName,
        tableType: "星期表",
        tableMeta,
        header: table[0],
        jobs: tableJobs,
      });
    }
  });

  return workSheet;
}

async function runFetchAndParseSpiritualPanelNew(panel) {
  const plugin = window.__PLUGIN__;
  const parserPlugin = window.__REGISTRY__?.generic || plugin;

  console.log("[靈恩會解析開始] 使用新解析器", {
    panelMode: "spiritual",
    pluginId: plugin?.id || null,
    pluginLabel: plugin?.label || null,
    parserPluginId: parserPlugin?.id || null,
    parserPluginLabel: parserPlugin?.label || null,
  });

  const { sheetIdInput, gidInput } = inputsFromParsePanel(panel);
  const sheetId = (sheetIdInput && sheetIdInput.value.trim()) || "";
  const gid = (gidInput && gidInput.value.trim()) || "0";
  if (!sheetId) return alert("請先填入 sheetId！");

  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&id=${sheetId}&gid=${gid}`;
  showToast("解析中...", "info");

  try {
    const csvText = await fetch(csvUrl).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    });

    const parsed = Papa.parse(csvText).data;
    const { csv2d, hints } = parserPlugin.preprocess(parsed, { setMonthInput });
    const preprocessedCsv2d = preprocessSpiritualSheetCsv(csv2d);

    const tableBlocks = splitTablesByEmptyRowsAndColumns(preprocessedCsv2d);
    const cleanedTableBlocks = cleanupSpiritualTableBlocks(tableBlocks);
    const dateSubTables = splitTablesByDateKeywordWithContext(cleanedTableBlocks);
    const flatTables = [];
    dateSubTables.forEach((blocks) =>
      blocks.forEach((t) => flatTables.push(t)),
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
      const cleanedTable = table.map((row) =>
        row.filter((_, idx) => !emptyCols.includes(idx)),
      );
      setSpiritualTableMeta(cleanedTable, getSpiritualTableMeta(table));
      return cleanedTable;
    };

    const validFlatTables = flatTables
      .map(removeEmptyColumns)
      .filter((t) =>
        t.some((row) => row.some((cell) => String(cell ?? "") !== "")),
      );

    const ymFromHeader = parserPlugin.extractYearMonthFromHeaderRow(
      validFlatTables?.[0]?.[0],
    );
    const fallbackYear = extractSpiritualYearFromTables(validFlatTables);
    const yyyymm =
      hints?.month ||
      (ymFromHeader ? ymFromHeader.year + ymFromHeader.month : null);
    if (yyyymm) setMonthInput(yyyymm);
    const ym = yyyymm
      ? { year: yyyymm.slice(0, 4), month: yyyymm.slice(4) }
      : ymFromHeader || { year: fallbackYear || "", month: "" };

    console.log("[靈恩會年份來源]", {
      hintedMonth: hints?.month || null,
      ymFromHeader: ymFromHeader || null,
      fallbackYear: fallbackYear || null,
      resolvedYearMonth: ym,
    });

    const { specialWorkSheet, remainingTables } = extractSpiritualSpecialBlocks(
      validFlatTables,
      ym,
      (x) => parserPlugin.nameSplitter(x),
    );

    const validTables = remainingTables.filter((t) => {
      const head = (t[0]?.[0] || "").trim();
      return head === "日期" || head === "星期";
    });

    const errors = [];
    if (validTables.length !== SPIRITUAL_EXPECTED_TABLE_COUNT) {
      errors.push(
        `靈恩會二次切割後有效區塊預期為 ${SPIRITUAL_EXPECTED_TABLE_COUNT} 份，當前為 ${validTables.length} 份。`,
      );
    }
    if (errors.length) alert(errors.join("\n"));

    const finalTables = parserPlugin.normalizeTables(validTables, { yyyymm });

    const weekContext = buildSpiritualWeekContext(validFlatTables, ym);
    if (weekContext.errors.length) {
      console.warn("[靈恩會解析] 週期檢核未通過", weekContext.errors);
      alert(weekContext.errors.join("\n"));
    }

    const workSheet = spiritualTablesToWork(
      finalTables,
      ym,
      (x) => parserPlugin.nameSplitter(x),
      weekContext,
    );
    mergeSpiritualWorkSheet(workSheet, specialWorkSheet);
    let finalTransformedSheet = transformWorkSheet(workSheet);

    finalTransformedSheet = parserPlugin.postprocess(finalTransformedSheet, {
      yyyymm,
    });
    window.__FINAL__ = finalTransformedSheet;
    window.__SPIRITUAL_UPLOAD_META__ = inferSpiritualEventMeta(validFlatTables, ym);

    if (!window.__SPIRITUAL_UPLOAD_META__?.eventKey) {
      alert("抓不到靈恩會活動代號，請確認標題包含「春季」或「秋季」。");
    }

    if (window.__SPIRITUAL_UPLOAD_META__?.eventKey) {
      setMonthInput(window.__SPIRITUAL_UPLOAD_META__.eventKey);
    }

    console.log("[靈恩會最終工作清單]", window.__FINAL__);
    console.log("[靈恩會上傳資訊]", window.__SPIRITUAL_UPLOAD_META__);

    console.log("[FINAL keys] users =", Object.keys(window.__FINAL__ || {}));
    console.log(
      "[FINAL sample]",
      window.__FINAL__ && window.__FINAL__[Object.keys(window.__FINAL__)[0]],
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

window.runFetchAndParseSpiritualPanelNew = runFetchAndParseSpiritualPanelNew;
