import { message } from "antd";

/**
 * 统一错误提示：先关闭可能存在的旧提示，再显示新内容。
 * 用于替代各页散落的 message.error / setError + message.error，保持文案一致。
 */
export function notifyError(msg: string, duration?: number): void {
  message.destroy();
  message.error(msg, duration ?? 3);
}
