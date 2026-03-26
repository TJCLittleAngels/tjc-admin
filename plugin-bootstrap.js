      import { enabledPlugins, defaultPluginId } from "./plugins/registry.js";

      // 依 enabledPlugins 自動建立 registry（key 用 instance.id）
      const registry = enabledPlugins.reduce((acc, Ctor) => {
        const inst = new Ctor();
        acc[inst.id] = inst;
        return acc;
      }, {});

      // 畫出下拉選單（覆蓋原本 HTML 的 option）
      function populatePluginSelect() {
        const sel = document.getElementById("pluginSelect");
        if (!sel) return;
        sel.innerHTML = ""; // 清空，避免手動選項殘留
        Object.values(registry).forEach((p) => {
          const opt = document.createElement("option");
          opt.value = p.id;
          opt.textContent = `${p.label} (${p.namespace})`;
          sel.appendChild(opt);
        });
      }

      // 顯示目前 plugin 用
      function updatePluginInfo() {
        const plugin = window.__PLUGIN__;
        const infoElement = document.getElementById("pluginInfo");
        if (infoElement && plugin) {
          infoElement.textContent = `目前使用：${plugin.label} (${plugin.namespace})`;
        }
        // 順手把「試算表網址」的 label 也動態化，避免寫死 (莒光教會)
        const urlLbl = document.querySelector('label[for="urlInput"]');
        const urlLblSpiritual = document.querySelector(
          'label[for="urlInputSpiritual"]'
        );
        const labelText = plugin
          ? `(${plugin.label}) 試算表網址 / Sheet ID`
          : "試算表網址 / Sheet ID";
        if (urlLbl) urlLbl.textContent = labelText;
        if (urlLblSpiritual) urlLblSpiritual.textContent = labelText;
      }

      // 需要密碼的安全切換（錯誤回退 generic）
      function attemptSwitchPlugin(pluginId) {
        const target = registry[pluginId];
        if (!target) return;

        const currentId = window.__PLUGIN__?.id || defaultPluginId;
        const pluginSelect = document.getElementById("pluginSelect");

        if (target.passcode) {
          const input = window.prompt(`請輸入「${target.label}」進入碼：`);
          if (input === null) {
            pluginSelect.value = currentId;
            showToast("已取消切換。", "info");
            return;
          }
          if (input !== target.passcode) {
            window.__PLUGIN__ =
              registry[defaultPluginId] || Object.values(registry)[0];
            pluginSelect.value = window.__PLUGIN__.id;
            updatePluginInfo();
            window.__FINAL__ = null;
            if (window.__ADMIN_STATE__) {
              window.__ADMIN_STATE__.deletedJobsByUser = {};
            }
            renderUserJobs();
            renderDeletedJobs();
            showToast("密碼錯誤，已切回「通用（測試）」。", "error");
            return;
          }
        }

        // 切換成功
        window.__PLUGIN__ = target;
        pluginSelect.value = target.id;
        updatePluginInfo();

        // 同步預設網址
        const urlInput = document.getElementById("urlInput");
        if (urlInput && target.defaultUrl) urlInput.value = target.defaultUrl;

        // 乾淨狀態
        window.__FINAL__ = null;
        window.__SPIRITUAL_UPLOAD_META__ = null;
        if (window.__ADMIN_STATE__) {
          window.__ADMIN_STATE__.deletedJobsByUser = {};
        }
        renderUserJobs();
        renderDeletedJobs();

        // 記住選擇
        try {
          localStorage.setItem("activePluginId", target.id);
        } catch {}
        showToast(`已切換到 ${target.label}`, "info");

        // 切換 plugin 後自動載入目前圖片
        loadCurrentImageFromDB();
      }

      // ---- 初始化：依 registry + 優先序（querystring > localStorage > default）選擇 ----
      function initPlugin() {
        populatePluginSelect();

        const sel = document.getElementById("pluginSelect");
        // 1) querystring ?plugin=jgc
        const qs = new URLSearchParams(location.search).get("plugin");
        // 2) localStorage
        let remembered = null;
        try {
          remembered = localStorage.getItem("activePluginId");
        } catch {}
        const fallbackId = registry[defaultPluginId]
          ? defaultPluginId
          : Object.keys(registry)[0];
        const initialId =
          registry[qs]?.id || registry[remembered]?.id || fallbackId;

        window.__PLUGIN__ = registry[initialId];
        if (sel) sel.value = initialId;

        // 預設網址
        const urlInput = document.getElementById("urlInput");
        if (urlInput && window.__PLUGIN__.defaultUrl) {
          urlInput.value = window.__PLUGIN__.defaultUrl;
        }

        updatePluginInfo();

        // 綁定切換事件
        if (sel) {
          sel.addEventListener("change", (e) =>
            attemptSwitchPlugin(e.target.value)
          );
        }

        // 讓其它 script 用得到
        window.attemptSwitchPlugin = attemptSwitchPlugin;
        window.updatePluginInfo = updatePluginInfo;
      }

      // 對外（給下面的非 module 腳本）
      window.__REGISTRY__ = registry;

      // 啟動
      initPlugin();
    
