/**
 * dsh-sidebar-manager —— Host（Node）端半侧。
 *
 * 本插件是**纯浏览器端 UI 插件**：所有能力都写在 `src/client.js` 里，
 * 由 harness 以 `/plugins/dsh-sidebar-manager/client.js` 提供给页面。
 * 宿主端不需要注册工具、技能或系统提示，也不碰文件系统，因此 apply 是空实现
 * （与官方 @deepseek-ai/dsh-client-ui-sidebar 的宿主端一致）。
 *
 * @module dsh-sidebar-manager
 */

/** 插件名（Cordis fiber 标签用）。 */
export const name = 'dsh-sidebar-manager'

/**
 * 宿主端挂载入口：无副作用的占位实现。
 * @returns {void}
 */
export function apply() {}
