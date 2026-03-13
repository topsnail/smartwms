/**
 * 将 API 返回的日期时间字符串解析为 Date（视为 UTC）
 * D1/Cloudflare 返回 UTC 时间，需正确解析以便在本地时区显示
 */
export function parseUtc(s: string | null | undefined): Date {
  if (!s) return new Date(0);
  const t = String(s).trim();
  if (!t) return new Date(0);
  if (t.endsWith("Z") || t.endsWith("z") || t.includes("+") || /-\d{2}:\d{2}$/.test(t)) {
    return new Date(t);
  }
  return new Date(t.replace(" ", "T") + "Z");
}
