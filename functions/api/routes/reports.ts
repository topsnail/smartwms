import type { Hono } from "hono";
import type { Env } from "../lib/types";

type Deps = {
  requirePermission: (c: unknown, perm: string) => Promise<{ id: number } | null>;
};

export function registerReportsRoutes(app: Hono<Env>, deps: Deps) {
  app.get("/reports/:type", async (c) => {
    const user = await deps.requirePermission(c, "view_reports");
    if (!user) return c.res;
    const type = c.req.param("type");
    const url = new URL(c.req.url);
    const start_date = url.searchParams.get("start_date");
    const end_date = url.searchParams.get("end_date");
    if (!start_date || !end_date) return c.json({ success: false, error: { code: "VALIDATION_FAILED", message: "请提供开始日期和结束日期" } }, 400);
    const start = String(start_date);
    const end = String(end_date) + " 23:59:59";
    try {
      switch (type) {
        case "inventory-turnover": {
          const { results: turnoverData } = await c.env.DB.prepare(`
          SELECT m.id, m.code, m.name,
            COALESCE((SELECT SUM(quantity) FROM inventory WHERE material_id = m.id), 0) as ending_stock,
            COALESCE((SELECT SUM(quantity) FROM transactions WHERE material_id = m.id AND type = 'IN' AND (reverted IS NULL OR reverted = 0) AND timestamp BETWEEN ? AND ?), 0) as inbound,
            COALESCE((SELECT SUM(quantity) FROM transactions WHERE material_id = m.id AND type = 'OUT' AND (reverted IS NULL OR reverted = 0) AND timestamp BETWEEN ? AND ?), 0) as outbound
          FROM materials m
          WHERE m.id IN (SELECT material_id FROM transactions WHERE timestamp BETWEEN ? AND ?)
          ORDER BY m.code
        `).bind(start, end, start, end, start, end).all<Record<string, unknown>>();
          const data = (turnoverData ?? []).map((item: Record<string, unknown>) => {
            const ending = Number(item.ending_stock ?? 0);
            const inbound = Number(item.inbound ?? 0);
            const outbound = Number(item.outbound ?? 0);
            const avg = ending / 2;
            return {
              id: item.id, code: item.code, name: item.name,
              beginning_stock: ending - inbound + outbound,
              ending_stock: ending,
              outbound,
              turnover_rate: avg > 0 ? outbound / avg : 0,
            };
          });
          return c.json({ data, summary: { 总物料数: data.length } });
        }
        case "inout-stats": {
          const { results } = await c.env.DB.prepare(`
          SELECT DATE(timestamp) as date,
            SUM(CASE WHEN type = 'IN' AND (reverted IS NULL OR reverted = 0) THEN quantity ELSE 0 END) as inbound,
            SUM(CASE WHEN type = 'OUT' AND (reverted IS NULL OR reverted = 0) THEN quantity ELSE 0 END) as outbound
          FROM transactions WHERE timestamp BETWEEN ? AND ?
          GROUP BY DATE(timestamp) ORDER BY date
        `).bind(start, end).all<Record<string, unknown>>();
          const data = (results ?? []).map((r: Record<string, unknown>) => ({
            id: r.date, date: r.date,
            inbound: Number(r.inbound ?? 0), outbound: Number(r.outbound ?? 0),
            net_change: Number(r.inbound ?? 0) - Number(r.outbound ?? 0),
          }));
          const totalIn = data.reduce((s: number, r: { inbound: number }) => s + r.inbound, 0);
          const totalOut = data.reduce((s: number, r: { outbound: number }) => s + r.outbound, 0);
          return c.json({ data, summary: { 总入库: totalIn, 总出库: totalOut, 净变化: totalIn - totalOut } });
        }
        case "partner-inout-stats": {
          const { results } = await c.env.DB.prepare(`
          SELECT COALESCE(p.name, '未填写') as partner_name,
            SUM(CASE WHEN t.type = 'IN' AND (t.reverted IS NULL OR t.reverted = 0) THEN t.quantity ELSE 0 END) as inbound,
            SUM(CASE WHEN t.type = 'OUT' AND (t.reverted IS NULL OR t.reverted = 0) THEN t.quantity ELSE 0 END) as outbound
          FROM transactions t LEFT JOIN partners p ON t.partner_id = p.id
          WHERE t.timestamp BETWEEN ? AND ?
          GROUP BY COALESCE(p.name, '未填写') ORDER BY (inbound + outbound) DESC
        `).bind(start, end).all<Record<string, unknown>>();
          const data = (results ?? []).map((r: Record<string, unknown>, i: number) => ({
            id: i + 1, partner_name: r.partner_name,
            inbound: Number(r.inbound ?? 0), outbound: Number(r.outbound ?? 0),
            net_change: Number(r.inbound ?? 0) - Number(r.outbound ?? 0),
          }));
          return c.json({ data, summary: { 往来单位数: data.length } });
        }
        case "material-analysis": {
          const { results } = await c.env.DB.prepare(`
          SELECT m.id, m.code, m.name, SUM(t.quantity) as usage
          FROM transactions t JOIN materials m ON t.material_id = m.id
          WHERE t.type = 'OUT' AND (t.reverted IS NULL OR t.reverted = 0) AND t.timestamp BETWEEN ? AND ?
          GROUP BY m.id ORDER BY usage DESC
        `).bind(start, end).all<Record<string, unknown>>();
          const totalUsage = (results ?? []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.usage ?? 0), 0);
          const data = (results ?? []).map((r: Record<string, unknown>) => ({
            id: r.id, code: r.code, name: r.name,
            usage: Number(r.usage ?? 0),
            percentage: totalUsage > 0 ? Number(r.usage ?? 0) / totalUsage : 0,
          }));
          return c.json({ data, summary: { 总使用物料数: data.length, 总使用数量: totalUsage } });
        }
        case "inventory-value": {
          const { results } = await c.env.DB.prepare(`
          SELECT m.id, m.code, m.name, i.quantity,
            COALESCE(m.purchase_price, 0) as unit_price,
            COALESCE(m.purchase_price, 0) * i.quantity as value
          FROM inventory i JOIN materials m ON i.material_id = m.id
          WHERE i.quantity > 0 ORDER BY value DESC
        `).all<Record<string, unknown>>();
          const data = results ?? [];
          const totalVal = data.reduce((s: number, r: Record<string, unknown>) => s + Number(r.value ?? 0), 0);
          return c.json({ data, summary: { 库存物料数: data.length, 总库存价值: totalVal.toFixed(2) } });
        }
        default:
          return c.json({ error: "无效的报表类型" }, 404);
      }
    } catch (err: unknown) {
      return c.json({ error: err instanceof Error ? err.message : "生成报表失败" }, 500);
    }
  });
}
