import type { Hono } from "hono";
import type { Env } from "../lib/types";

type Deps = {
  requireAuthUser: (c: unknown) => Promise<{ id: number } | null>;
};

export function registerDashboardRoutes(app: Hono<Env>, deps: Deps) {
  app.get("/dashboard/stats", async (c) => {
    const user = await deps.requireAuthUser(c);
    if (!user) return c.res;
    const now = new Date();
    const todayStart = now.toISOString().slice(0, 10) + " 00:00:00";
    const wd = new Date(now);
    const diff = wd.getDay() === 0 ? 6 : wd.getDay() - 1;
    wd.setDate(wd.getDate() - diff);
    wd.setHours(0, 0, 0, 0);
    const weekStart = wd.toISOString().slice(0, 19).replace("T", " ");
    const md = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    const monthStart = md.toISOString().slice(0, 19).replace("T", " ");

    const d7Start = new Date(now);
    d7Start.setDate(d7Start.getDate() - 6);
    const d30Start = new Date(now);
    d30Start.setDate(d30Start.getDate() - 29);
    const d30StartStr = d30Start.toISOString().slice(0, 10) + " 00:00:00";

    const [
      totalMaterialsR,
      totalStockR,
      todayInR, todayOutR,
      weekInR, weekOutR,
      monthInR, monthOutR,
      lowStockR,
      locationCountR,
      partnerTopR,
      invValR,
      recentTxR,
      trendRowsR,
    ] = await Promise.all([
      c.env.DB.prepare("SELECT COUNT(*) as c FROM materials").first<{ c: number }>(),
      c.env.DB.prepare("SELECT COALESCE(SUM(quantity), 0) as s FROM inventory").first<{ s: number }>(),
      c.env.DB.prepare("SELECT COUNT(*) as c FROM transactions WHERE type = 'IN' AND timestamp >= ? AND (reverted IS NULL OR reverted = 0)").bind(todayStart).first<{ c: number }>(),
      c.env.DB.prepare("SELECT COUNT(*) as c FROM transactions WHERE type = 'OUT' AND timestamp >= ? AND (reverted IS NULL OR reverted = 0)").bind(todayStart).first<{ c: number }>(),
      c.env.DB.prepare("SELECT COUNT(*) as c FROM transactions WHERE type = 'IN' AND timestamp >= ? AND (reverted IS NULL OR reverted = 0)").bind(weekStart).first<{ c: number }>(),
      c.env.DB.prepare("SELECT COUNT(*) as c FROM transactions WHERE type = 'OUT' AND timestamp >= ? AND (reverted IS NULL OR reverted = 0)").bind(weekStart).first<{ c: number }>(),
      c.env.DB.prepare("SELECT COUNT(*) as c FROM transactions WHERE type = 'IN' AND timestamp >= ? AND (reverted IS NULL OR reverted = 0)").bind(monthStart).first<{ c: number }>(),
      c.env.DB.prepare("SELECT COUNT(*) as c FROM transactions WHERE type = 'OUT' AND timestamp >= ? AND (reverted IS NULL OR reverted = 0)").bind(monthStart).first<{ c: number }>(),
      c.env.DB.prepare(`SELECT m.code, m.name, m.spec, m.unit, m.image_url, l.name as location_name, i.quantity, i.min_stock, i.max_stock, i.material_id, i.location_id
      FROM inventory i JOIN materials m ON i.material_id = m.id JOIN locations l ON i.location_id = l.id
      WHERE i.quantity <= i.min_stock AND i.min_stock > 0 ORDER BY i.quantity ASC LIMIT 20`).all(),
      c.env.DB.prepare("SELECT COUNT(DISTINCT location_id) as c FROM inventory WHERE quantity > 0").first<{ c: number }>(),
      c.env.DB.prepare(`SELECT p.name, COUNT(*) as cnt FROM transactions t JOIN partners p ON t.partner_id = p.id
      WHERE t.timestamp >= ? AND (t.reverted IS NULL OR t.reverted = 0) GROUP BY t.partner_id ORDER BY cnt DESC LIMIT 3`).bind(monthStart).all<{ name: string; cnt: number }>(),
      c.env.DB.prepare("SELECT COALESCE(SUM(i.quantity * COALESCE(m.purchase_price, m.sale_price, 0)), 0) as val FROM inventory i JOIN materials m ON i.material_id = m.id").first<{ val: number }>(),
      c.env.DB.prepare(`SELECT t.id, t.type, t.quantity, t.timestamp, t.note, m.name as material_name, m.code as material_code, l.name as location_name
      FROM transactions t JOIN materials m ON t.material_id = m.id JOIN locations l ON t.location_id = l.id
      WHERE (t.reverted IS NULL OR t.reverted = 0) ORDER BY t.timestamp DESC LIMIT 10`).all(),
      c.env.DB.prepare(`SELECT DATE(timestamp) as date,
        SUM(CASE WHEN type = 'IN' AND (reverted IS NULL OR reverted = 0) THEN 1 ELSE 0 END) as in_count,
        SUM(CASE WHEN type = 'OUT' AND (reverted IS NULL OR reverted = 0) THEN 1 ELSE 0 END) as out_count
      FROM transactions WHERE timestamp >= ? GROUP BY DATE(timestamp) ORDER BY date`).bind(d30StartStr).all<{ date: string; in_count: number; out_count: number }>(),
    ]);

    const totalMaterials = totalMaterialsR?.c ?? 0;
    const totalStock = totalStockR?.s ?? 0;
    const today = { in: todayInR?.c ?? 0, out: todayOutR?.c ?? 0 };
    const week = { in: weekInR?.c ?? 0, out: weekOutR?.c ?? 0 };
    const month = { in: monthInR?.c ?? 0, out: monthOutR?.c ?? 0 };
    const lowStock = lowStockR.results ?? [];
    const locationCount = locationCountR?.c ?? 0;
    const partnerTop = partnerTopR.results ?? [];
    const invVal = invValR?.val ?? 0;
    const recentTx = recentTxR.results ?? [];

    const trendMap = new Map<string, { in_count: number; out_count: number }>();
    for (const r of trendRowsR.results ?? []) {
      trendMap.set(r.date, { in_count: r.in_count ?? 0, out_count: r.out_count ?? 0 });
    }
    const trend7: { date: string; in_count: number; out_count: number }[] = [];
    const trend30: { date: string; in_count: number; out_count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const dt = new Date();
      dt.setDate(dt.getDate() - i);
      const dateStr = dt.toISOString().slice(0, 10);
      const v = trendMap.get(dateStr) ?? { in_count: 0, out_count: 0 };
      trend7.push({ date: dateStr, in_count: v.in_count, out_count: v.out_count });
    }
    for (let i = 29; i >= 0; i--) {
      const dt = new Date();
      dt.setDate(dt.getDate() - i);
      const dateStr = dt.toISOString().slice(0, 10);
      const v = trendMap.get(dateStr) ?? { in_count: 0, out_count: 0 };
      trend30.push({ date: dateStr, in_count: v.in_count, out_count: v.out_count });
    }
    return c.json({
      totalMaterials,
      totalStock,
      todayIn: today.in,
      todayOut: today.out,
      weekIn: week.in,
      weekOut: week.out,
      monthIn: month.in,
      monthOut: month.out,
      lowStock,
      locationCount,
      partnerTop,
      inventoryValue: invVal,
      recentTransactions: recentTx,
      trend7,
      trend30,
    });
  });
}
