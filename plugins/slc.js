// plugins/slc.js
import { PluginBase } from "./base.js";

export class SlcPlugin extends PluginBase {
  id = "slc";
  label = "雙連教會";
  namespace = "sltjc";
  passcode = "slc-2025"; // ← 需要進入碼就打開這行（可改字串）
  defaultUrl =
    "https://docs.google.com/spreadsheets/d/11aEzpISqIUOi6MiuETyPJ_fx5y4OWZhtH8BMQ0x9EWc/edit?gid=139917179#gid=139917179"; // ← 有預設網址就填
  expectedTableCount = 7; // ← 若有效表格數量與通用不同就解註並調整

  // 如需客製邏輯可視需要覆寫以下方法（先沿用通用行為即可）：
  // preprocess(csv2d, ctx) { return super.preprocess(csv2d, ctx); }
  // nameSplitter(text) { return super.nameSplitter(text); }
  // validate({ validTables }) { return super.validate({ validTables }); }
  // postprocess(sheet, ctx) { return super.postprocess(sheet, ctx); }
}
