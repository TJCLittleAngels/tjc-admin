function getCurrentImagePathByUI() {
  const plugin = window.__PLUGIN__;
  const uploadType = document.getElementById("uploadTypeSelect").value;
  if (!plugin || !plugin.paths) return null;

  if (uploadType === "schedule") {
    const yyyymm = document.getElementById("imageMonthSelect").value;
    if (!yyyymm) return null;
    return plugin.paths.scheduleImage(yyyymm);
  }
  if (uploadType === "evangelistic") {
    return getSpiritualEventMetaPathByUI();
  }
  return plugin.paths.classImage(uploadType);
}

function getSelectedSpiritualEventKey() {
  return document.getElementById("spiritualEventSelect")?.value?.trim() || "";
}

function getSpiritualEventMetaPathByUI(eventKey = getSelectedSpiritualEventKey()) {
  const plugin = window.__PLUGIN__;
  if (!plugin?.namespace || !eventKey) return null;
  return `line/schedule/${plugin.namespace}/spiritual/events/${eventKey}/meta`;
}

function getStorageObjectPathByUI(file) {
  const uploadType = document.getElementById("uploadTypeSelect").value;
  const ts = Date.now();
  const safeExt = (file?.name?.split(".").pop() || "jpg").toLowerCase();

  if (uploadType === "schedule") {
    const yyyymm = document.getElementById("imageMonthSelect").value;
    return `public/schedule/${yyyymm}/${yyyymm}-${ts}.${safeExt}`;
  }
  return `public/class/${uploadType}/${uploadType}-${ts}.${safeExt}`;
}

async function uploadSelectedFileAndWriteDB() {
  const fileInput = document.getElementById("imageFileInput");
  const file = fileInput?.files?.[0];
  if (!file) {
    showToast("請先選擇一張圖片檔！", "error");
    return;
  }

  const uploadType = document.getElementById("uploadTypeSelect").value;
  let objectPath;
  let dbPath;
  let payloadToWrite;

  if (uploadType === "evangelistic") {
    const eventKey = getSelectedSpiritualEventKey();
    if (!eventKey) {
      showToast("請先選擇活動代號。", "error");
      return;
    }
    objectPath = getEvangelisticStoragePath(file);
    dbPath = getEvangelisticDbPath();
    payloadToWrite = { url: null };
  } else {
    objectPath = getStorageObjectPathByUI(file);
    if (!objectPath) {
      showToast("請先選好上傳類型與年月/班級！", "error");
      return;
    }

    dbPath = getCurrentImagePathByUI();
    if (!dbPath) {
      showToast("無法取得 DB 路徑，請確認上傳類型與年月/班級。", "error");
      return;
    }
  }

  try {
    showToast("開始上傳檔案...", "info");

    const storageRef = storage.ref(objectPath);
    const metadata = { contentType: file.type || "image/jpeg" };
    const task = storageRef.put(file, metadata);

    task.on(
      "state_changed",
      () => {},
      (err) => {
        showToast("上傳失敗：" + err.message, "error");
      },
      async () => {
        const downloadURL = await task.snapshot.ref.getDownloadURL();

        if (uploadType === "evangelistic") {
          payloadToWrite.url = downloadURL;
          await database.ref(dbPath).set(payloadToWrite);
          const metaPath = getSpiritualEventMetaPathByUI();
          if (metaPath) {
            await database.ref(`${metaPath}/imageUrl`).set(downloadURL);
          }
        } else {
          await database.ref(dbPath).set(downloadURL);
        }

        showToast("上傳完成！已寫回圖片網址。", "success");
        document.getElementById("imageFileInput").value = "";
        loadCurrentImageFromDB();
      }
    );
  } catch (e) {
    showToast("上傳失敗：" + e.message, "error");
  }
}

function renderCurrentImage(urlOrObj, path) {
  const wrap = document.getElementById("currentImageContainer");
  const box = document.getElementById("currentImageBox");
  wrap.style.display = "block";

  let url = null;
  let meta = "";
  console.log("urlOrObj", urlOrObj);
  if (typeof urlOrObj === "string") {
    url = urlOrObj;
  } else if (urlOrObj && typeof urlOrObj === "object") {
    url = urlOrObj.url || urlOrObj.imageUrl || null;
    const metaParts = [];
    if (urlOrObj.url) metaParts.push(`url: ${urlOrObj.url}`);
    if (urlOrObj.imageUrl) metaParts.push(`imageUrl: ${urlOrObj.imageUrl}`);
    if (urlOrObj.eventKey) metaParts.push(`eventKey: ${urlOrObj.eventKey}`);
    if (urlOrObj.label) metaParts.push(`label: ${urlOrObj.label}`);
    if (urlOrObj.startDate) metaParts.push(`start: ${urlOrObj.startDate}`);
    if (urlOrObj.endDate) metaParts.push(`end: ${urlOrObj.endDate}`);
  meta = metaParts.length
    ? `<br><small style='color:#666;'>${metaParts.join(" | ")}</small>`
    : "";
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

async function loadCurrentImageFromDB() {
  const path = getCurrentImagePathByUI();
  if (!path) {
    showToast("請先選擇正確的類型與年月/班級！", "error");
    return;
  }

  try {
    showToast("讀取中...", "info");
    const snap = await database.ref(path).once("value");
    const val = snap.val();
    const hasUrl =
      typeof val === "string" ? !!val : !!(val?.url || val?.imageUrl);
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

document.getElementById("previewImageBtn").addEventListener("click", function () {
  const imageUrl = document.getElementById("imageUrlInput").value.trim();

  if (!imageUrl) {
    showToast("請先輸入圖片網址！", "error");
    return;
  }

  try {
    new URL(imageUrl);
  } catch (e) {
    showToast("請輸入有效的網址格式！", "error");
    return;
  }

  const previewContainer = document.getElementById("imagePreviewContainer");
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

document
  .getElementById("loadCurrentImageBtn")
  .addEventListener("click", loadCurrentImageFromDB);

document
  .getElementById("uploadFileToStorageBtn")
  .addEventListener("click", uploadSelectedFileAndWriteDB);

document.getElementById("uploadTypeSelect").addEventListener("change", () => {
  document.getElementById("currentImageContainer").style.display = "none";
  loadCurrentImageFromDB();
});

document.getElementById("imageMonthSelect").addEventListener("change", () => {
  document.getElementById("currentImageContainer").style.display = "none";
  loadCurrentImageFromDB();
});

document.getElementById("spiritualEventSelect").addEventListener("change", () => {
  document.getElementById("currentImageContainer").style.display = "none";
  loadCurrentImageFromDB();
});

document.getElementById("uploadImageBtn").addEventListener("click", function () {
  const plugin = window.__PLUGIN__;
  const imageUrl = document.getElementById("imageUrlInput").value.trim();
  const selectedMonth = document.getElementById("imageMonthSelect").value;
  const uploadType = document.getElementById("uploadTypeSelect").value;

  if (!imageUrl) {
    alert("請輸入圖片網址！");
    return;
  }

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

  if (uploadType === "schedule" && !selectedMonth) {
    alert("請選擇年月！");
    return;
  }

  if (uploadType === "evangelistic") {
    const eventKey = getSelectedSpiritualEventKey();
    if (!eventKey) {
      alert("請先選擇活動代號！");
      return;
    }
  }

  let path;
  let payload;
  if (uploadType === "schedule") {
    path = plugin.paths.scheduleImage(selectedMonth);
    payload = imageUrl;
  } else if (uploadType === "evangelistic") {
    path = getEvangelisticDbPath();
    payload = { url: imageUrl };
  } else {
    path = plugin.paths.classImage(uploadType);
    payload = imageUrl;
  }

  database.ref(path).set(payload, function (error) {
    if (error) {
      alert("上傳失敗：" + error);
    } else {
      const afterWrite = async () => {
        if (uploadType === "evangelistic") {
          const metaPath = getSpiritualEventMetaPathByUI();
          if (metaPath) {
            await database.ref(`${metaPath}/imageUrl`).set(imageUrl);
          }
        }
        alert(
          `成功上傳圖片網址至 Firebase！\n類型：${
            uploadType === "schedule"
              ? "安排表"
              : uploadType === "evangelistic"
              ? "靈恩佈道會"
              : uploadType
          }\n路徑：${path}\n網址：${imageUrl}`
        );
        document.getElementById("imageUrlInput").value = "";
        document.getElementById("imagePreviewContainer").style.display = "none";
        loadCurrentImageFromDB();
      };

      afterWrite().catch((e) => {
        alert("上傳圖片成功，但寫入活動 meta 失敗：" + e.message);
      });
    }
  });
});
