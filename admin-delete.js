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
    const monthFromMain =
      document.getElementById("monthInput")?.value?.trim() ||
      document.getElementById("imageMonthSelect")?.value?.trim() ||
      "";
    if (!monthInput.value && monthFromMain) monthInput.value = monthFromMain;

    const p = window.__PLUGIN__.paths;
    const hintElement = document.querySelector("#deleteModalBackdrop .hint");
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

  openBtn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && backdrop.style.display === "flex") closeModal();
  });
  modeSelect.addEventListener("change", refreshFields);
  refreshFields();

  doDeleteBtn.addEventListener("click", async function () {
    const plugin = window.__PLUGIN__;
    const mode = modeSelect.value;

    try {
      if (mode === "scheduleData") {
        const m = monthInput.value.trim();
        if (!/^\d{6}$/.test(m)) return alert("請輸入正確格式的月份 (yyyymm)");
        const path = plugin.paths.scheduleData(m);
        if (!confirm(`確定刪除「安排表資料」？\n路徑：${path}`)) return;
        await database.ref(path).remove();
        alert(`已刪除：${path}`);
      } else if (mode === "scheduleImage") {
        const m = monthInput.value.trim();
        if (!/^\d{6}$/.test(m)) return alert("請輸入正確格式的月份 (yyyymm)");
        const path = plugin.paths.scheduleImage(m);
        if (!confirm(`確定刪除「安排表圖片網址」？\n路徑：${path}`)) return;
        await database.ref(path).remove();
        alert(`已刪除：${path}`);
      } else if (mode === "classImage") {
        const cls = classSelect.value;
        if (!cls) return alert("請選擇班級");
        const path = plugin.paths.classImage(cls);
        if (!confirm(`確定刪除「${cls}」的圖片網址？\n路徑：${path}`)) return;
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

document.getElementById("userJobs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action='delete']");
  if (!btn) return;
  const user = btn.getAttribute("data-user");
  const id = btn.getAttribute("data-id");
  ensureDeletedSet(user);
  adminState.deletedJobsByUser[user].add(id);
  renderUserJobs();
  renderDeletedJobs();
});

document.getElementById("deletedJobs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action='restore']");
  if (!btn) return;
  const user = btn.getAttribute("data-user");
  const id = btn.getAttribute("data-id");
  ensureDeletedSet(user);
  adminState.deletedJobsByUser[user].delete(id);
  renderUserJobs();
  renderDeletedJobs();
});
