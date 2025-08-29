# TJC Admin - Google 試算表 CSV 轉換 & Firebase 上傳

## 架構說明

這個專案採用 **Plugin 架構**，將教會特化邏輯與通用流程分離：

```
/your-app
  ├─ index.html          // 主畫面：載入 plugin，呼叫 hook
  └─ plugins/
      ├─ base.js         // Generic 預設（namespace=test）
      └─ jgc.js          // JGC 特化（namespace=jgtjc）
```

## Plugin Hook 介面

每個 plugin 必須實作以下 hook：

### 1. [上傳路徑] `plugin.paths.*`

- `scheduleData(month)` - 安排表資料路徑
- `scheduleImage(month)` - 安排表圖片路徑
- `classImage(className)` - 班級圖片路徑

### 2. [前處理] `plugin.preprocess(csv2d, ctx)`

- CSV 進來後、任何切表前，可微調原始 csv2d
- 回傳 `{ csv2d, hints }`
- JGC 特化：接待人員/炊事補格 + 民國年 → 西元

### 3. [中處理] `plugin.normalizeTables(validTables, ctx)`

- 針對「已切出來的有效表格」做欄位補值/標頭整併
- 預設提供「六下/會後報告/標頭補值/移除換行」通用版

### 4. [中處理] `plugin.nameSplitter(text)`

- 名字切分策略（對 tablesToWork 使用）
- JGC 特化：「字 空格 字」視為單一人名

### 5. [中處理] `plugin.extractYearMonthFromHeaderRow(headerRow)`

- 從表頭抓 yyyy 年 mm 月，抓不到就回 null

### 6. [有效表格數量] `plugin.validate({ validTables })`

- 回傳陣列 errors（字串訊息），空陣列代表沒意見
- Base 警告，JGC 強制要求 2 份

### 7. [後處理] `plugin.postprocess(finalTransformedSheet, ctx)`

- 已經轉成 `{ person: [{date,timeSlot,task}, ...] }` 後可再調整
- JGC 特化：「環境清潔」補上同日的「清掃區域：成員名單」

## 使用方法

### 切換 Plugin

#### 方法 1：使用 UI 選擇器

頁面頂部有 Plugin 選擇器，可以即時切換：

- **莒光教會 (jgtjc)** - 使用 JGC 特化邏輯
- **通用測試 (test)** - 使用通用邏輯

#### 方法 2：程式碼修改

在 `index.html` 中修改：

```javascript
// 預設使用 JGC
const activePlugin = registry.jgc;

// 切換到通用版
const activePlugin = registry.generic;
```

### 動態切換 Namespace

Base Plugin 提供 `setNamespace()` 方法：

```javascript
const plugin = window.__PLUGIN__;
plugin.setNamespace("custom"); // 切換到自訂路徑
```

### 新增 Plugin

1. 繼承 `PluginBase`
2. 實作需要的 hook
3. 在 `registry` 中註冊

## 檔案說明

- **`index.html`** - 主程式，負責 UI 和流程控制
- **`plugins/base.js`** - 通用 plugin，提供預設行為
- **`plugins/jgc.js`** - 莒光教會特化 plugin

## 特化點對應

| 特化點       | Hook                                                 | Base   | JGC                           |
| ------------ | ---------------------------------------------------- | ------ | ----------------------------- |
| 上傳路徑     | `plugin.paths.*`                                     | `test` | `jgtjc`                       |
| 有效表格數量 | `plugin.validate()`                                  | 警告   | 強制 2 份                     |
| 前處理       | `plugin.preprocess()`                                | 無     | 接待/炊事補格 + 民國年 → 西元 |
| 中處理       | `plugin.normalizeTables()` + `plugin.nameSplitter()` | 通用版 | JGC 名字切分                  |
| 後處理       | `plugin.postprocess()`                               | 無     | 清掃區域 → 環境清潔關聯       |
