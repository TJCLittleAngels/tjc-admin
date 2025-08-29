// plugins/registry.js
import { PluginBase } from "./base.js";
import { JgcPlugin } from "./jgc.js";
import { SlcPlugin } from "./slc.js"; // ← 新增
// import { AbcPlugin } from "./abc.js"; // 之後新增就解註

// 要啟用哪些 plugin（放「建構子」）
export const enabledPlugins = [
  PluginBase, // generic（通用）
  JgcPlugin,
  SlcPlugin, // ← 新增
  // AbcPlugin,
];

// 預設啟用的 plugin id
export const defaultPluginId = "generic";
