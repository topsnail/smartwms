import type { Hono } from "hono";
import type { Env } from "../lib/types";

function escapeCsv(val: unknown): string {
  return `"${String(val ?? "").replace(/"/g, '""')}"`;
}

type Deps = {
  requirePermission: (c: unknown, perm: string) => Promise<{ id: number } | null>;
};

export function registerExportRoutes(app: Hono<Env>, deps: Deps) {
  app.get("/export/materials", async (c) => {
    const user = await deps.requirePermission(c, "export_materials");
    if (!user) return c.res;
    const { results } = await c.env.DB.prepare(`SELECT m.*, c.name as category_name FROM materials m LEFT JOIN material_categories c ON m.category_id = c.id ORDER BY m.created_at DESC`).all<Record<string, unknown>>();
    const rows = results ?? [];
    const headers = ["ID", "物料编码", "物料名称", "规格型号", "单位", "分类", "来源", "购价", "售价", "图片URL", "创建时间"];
    const lines = [headers.join(","), ...rows.map((m: Record<string, unknown>) => [m.id, m.code || "", m.name, m.spec || "", m.unit || "", m.category_name || "", m.source || "", m.purchase_price ?? "", m.sale_price ?? "", m.image_url || "", m.created_at || ""].map(escapeCsv).join(","))];
    const csv = "\uFEFF" + lines.join("\n");
    return new Response(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=materials_${Date.now()}.csv` },
    });
  });

  app.get("/export/inventory", async (c) => {
    const user = await deps.requirePermission(c, "export_inventory");
    if (!user) return c.res;
    const { results } = await c.env.DB.prepare(`
    SELECT m.code, m.name, m.spec, m.unit, l.name as location_name, i.quantity, i.min_stock, i.max_stock
    FROM inventory i JOIN materials m ON i.material_id = m.id JOIN locations l ON i.location_id = l.id ORDER BY l.name, m.code
  `).all<Record<string, unknown>>();
    const rows = results ?? [];
    const headers = ["库位", "物料编码", "物料名称", "规格型号", "单位", "数量", "最小库存", "最大库存"];
    const lines = [headers.join(","), ...rows.map((r: Record<string, unknown>) => [r.location_name || "", r.code || "", r.name || "", r.spec || "", r.unit || "", r.quantity ?? 0, r.min_stock ?? 0, r.max_stock ?? 0].map(escapeCsv).join(","))];
    const csv = "\uFEFF" + lines.join("\n");
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=inventory_${Date.now()}.csv` } });
  });

  app.get("/export/transactions", async (c) => {
    const user = await deps.requirePermission(c, "export_transactions");
    if (!user) return c.res;
    const url = new URL(c.req.url);
    const type = url.searchParams.get("type");
    const start_date = url.searchParams.get("start_date");
    const end_date = url.searchParams.get("end_date");
    let sql = `SELECT t.*, m.name as material_name, m.code as material_code, l.name as location_name,
    s1.name as operator_name, d.name as department_name, s2.name as recipient_name, p.name as partner_name
    FROM transactions t JOIN materials m ON t.material_id = m.id JOIN locations l ON t.location_id = l.id
    LEFT JOIN staff s1 ON t.operator_id = s1.id LEFT JOIN departments d ON t.department_id = d.id
    LEFT JOIN staff s2 ON t.recipient_id = s2.id LEFT JOIN partners p ON t.partner_id = p.id
    WHERE (t.reverted IS NULL OR t.reverted = 0)`;
    const params: (string | number)[] = [];
    if (type && (type === "IN" || type === "OUT")) { sql += " AND t.type = ?"; params.push(type); }
    if (start_date) { sql += " AND t.timestamp >= ?"; params.push(String(start_date)); }
    if (end_date) { sql += " AND t.timestamp <= ?"; params.push(String(end_date) + " 23:59:59"); }
    sql += " ORDER BY t.timestamp DESC LIMIT 5000";
    const { results } = await c.env.DB.prepare(sql).bind(...params).all<Record<string, unknown>>();
    const rows = results ?? [];
    const headers = ["ID", "时间", "类型", "物料编码", "物料名称", "库位", "往来单位", "数量", "经办人", "部门", "领用人", "备注"];
    const lines = [headers.join(","), ...rows.map((r: Record<string, unknown>) => [r.id, r.timestamp, r.type === "IN" ? "入库" : "出库", r.material_code, r.material_name, r.location_name, r.partner_name || "", r.quantity, r.operator_name || "", r.department_name || "", r.recipient_name || "", (r.note || "").toString().replace(/,/g, "，")].map(escapeCsv).join(","))];
    const csv = "\uFEFF" + lines.join("\n");
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=transactions_${Date.now()}.csv` } });
  });

  app.get("/export/operation-logs", async (c) => {
    const user = await deps.requirePermission(c, "export_operation_logs");
    if (!user) return c.res;
    const url = new URL(c.req.url);
    const { action, actions, operator, keyword, start_date, end_date } = Object.fromEntries(url.searchParams);
    let sql = "SELECT * FROM operation_logs WHERE 1=1";
    const params: (string | number)[] = [];
    if (action) { sql += " AND action LIKE ?"; params.push("%" + String(action) + "%"); }
    if (actions) { const list = String(actions).split(",").map((s) => s.trim()).filter(Boolean); if (list.length) { sql += ` AND action IN (${list.map(() => "?").join(",")})`; params.push(...list); } }
    if (operator) { sql += " AND operator LIKE ?"; params.push("%" + String(operator) + "%"); }
    if (keyword) { const k = "%" + String(keyword) + "%"; sql += " AND (description LIKE ? OR old_value LIKE ? OR new_value LIKE ?)"; params.push(k, k, k); }
    if (start_date) { sql += " AND created_at >= ?"; params.push(String(start_date)); }
    if (end_date) { sql += " AND created_at <= ?"; params.push(String(end_date) + " 23:59:59"); }
    sql += " ORDER BY created_at DESC LIMIT 2000";
    const { results } = await c.env.DB.prepare(sql).bind(...params).all<Record<string, unknown>>();
    const rows = results ?? [];
    const headers = ["ID", "时间", "操作类型", "描述", "操作人", "客户端IP", "旧值", "新值"];
    const lines = [headers.join(","), ...rows.map((r: Record<string, unknown>) => [r.id, r.created_at, r.action, (r.description || "").toString().replace(/,/g, "，"), r.operator || "", r.client_ip || "", (r.old_value || "").toString().replace(/,/g, "，"), (r.new_value || "").toString().replace(/,/g, "，")].map(escapeCsv).join(","))];
    const csv = "\uFEFF" + lines.join("\n");
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=operation_logs_${Date.now()}.csv` } });
  });

  app.get("/export/report/:type", async (c) => {
    const user = await deps.requirePermission(c, "export");
    if (!user) return c.res;
    const type = c.req.param("type");
    const url = new URL(c.req.url);
    const start_date = url.searchParams.get("start_date");
    const end_date = url.searchParams.get("end_date");
    if (!start_date || !end_date) return c.json({ error: "请提供开始日期和结束日期" }, 400);
    const start = String(start_date);
    const end = String(end_date) + " 23:59:59";
    let rows: Record<string, unknown>[] = [];
    let headers: string[] = [];
    try {
      if (type === "inventory-turnover") {
        const { results } = await c.env.DB.prepare(`
        SELECT m.code, m.name, COALESCE((SELECT SUM(quantity) FROM inventory WHERE material_id = m.id), 0) as ending_stock,
          COALESCE((SELECT SUM(quantity) FROM transactions WHERE material_id = m.id AND type = 'IN' AND (reverted IS NULL OR reverted = 0) AND timestamp BETWEEN ? AND ?), 0) as inbound,
          COALESCE((SELECT SUM(quantity) FROM transactions WHERE material_id = m.id AND type = 'OUT' AND (reverted IS NULL OR reverted = 0) AND timestamp BETWEEN ? AND ?), 0) as outbound
        FROM materials m WHERE m.id IN (SELECT material_id FROM transactions WHERE timestamp BETWEEN ? AND ?) ORDER BY m.code
      `).bind(start, end, start, end, start, end).all<Record<string, unknown>>();
        const data = results ?? [];
        rows = data.map((r: Record<string, unknown>) => {
          const ending = Number(r.ending_stock ?? 0);
          const inbound = Number(r.inbound ?? 0);
          const outbound = Number(r.outbound ?? 0);
          return { code: r.code, name: r.name, beginning_stock: ending - inbound + outbound, ending_stock: ending, outbound, turnover_rate: ending / 2 > 0 ? outbound / (ending / 2) : 0 };
        });
        headers = ["物料编码", "物料名称", "期初库存", "期末库存", "本期出库", "周转率"];
      } else if (type === "inout-stats") {
        const { results } = await c.env.DB.prepare(`SELECT DATE(timestamp) as date, SUM(CASE WHEN type = 'IN' AND (reverted IS NULL OR reverted = 0) THEN quantity ELSE 0 END) as inbound, SUM(CASE WHEN type = 'OUT' AND (reverted IS NULL OR reverted = 0) THEN quantity ELSE 0 END) as outbound FROM transactions WHERE timestamp BETWEEN ? AND ? GROUP BY DATE(timestamp) ORDER BY date`).bind(start, end).all<Record<string, unknown>>();
        rows = (results ?? []).map((r: Record<string, unknown>) => ({ date: r.date, inbound: Number(r.inbound ?? 0), outbound: Number(r.outbound ?? 0), net_change: Number(r.inbound ?? 0) - Number(r.outbound ?? 0) }));
        headers = ["日期", "入库数量", "出库数量", "净变化"];
      } else if (type === "partner-inout-stats") {
        const { results } = await c.env.DB.prepare(`SELECT COALESCE(p.name, '未填写') as partner_name, SUM(CASE WHEN t.type = 'IN' AND (t.reverted IS NULL OR t.reverted = 0) THEN t.quantity ELSE 0 END) as inbound, SUM(CASE WHEN t.type = 'OUT' AND (t.reverted IS NULL OR t.reverted = 0) THEN t.quantity ELSE 0 END) as outbound FROM transactions t LEFT JOIN partners p ON t.partner_id = p.id WHERE t.timestamp BETWEEN ? AND ? GROUP BY COALESCE(p.name, '未填写') ORDER BY (inbound+outbound) DESC`).bind(start, end).all<Record<string, unknown>>();
        rows = (results ?? []).map((r: Record<string, unknown>) => ({ partner_name: r.partner_name, inbound: Number(r.inbound ?? 0), outbound: Number(r.outbound ?? 0), net_change: Number(r.inbound ?? 0) - Number(r.outbound ?? 0) }));
        headers = ["往来单位", "入库数量", "出库数量", "净变化"];
      } else if (type === "material-analysis") {
        const { results } = await c.env.DB.prepare(`SELECT m.code, m.name, SUM(t.quantity) as usage FROM transactions t JOIN materials m ON t.material_id = m.id WHERE t.type = 'OUT' AND (t.reverted IS NULL OR t.reverted = 0) AND t.timestamp BETWEEN ? AND ? GROUP BY m.id ORDER BY usage DESC`).bind(start, end).all<Record<string, unknown>>();
        const total = (results ?? []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.usage ?? 0), 0);
        rows = (results ?? []).map((r: Record<string, unknown>) => ({ code: r.code, name: r.name, usage: Number(r.usage ?? 0), percentage: total > 0 ? Number(r.usage ?? 0) / total : 0 }));
        headers = ["物料编码", "物料名称", "使用数量", "占比"];
      } else if (type === "inventory-value") {
        const { results } = await c.env.DB.prepare(`SELECT m.code, m.name, SUM(i.quantity) as quantity, COALESCE(m.purchase_price, 0) as unit_price, COALESCE(m.purchase_price, 0) * SUM(i.quantity) as value FROM inventory i JOIN materials m ON i.material_id = m.id WHERE i.quantity > 0 GROUP BY m.id ORDER BY value DESC`).all<Record<string, unknown>>();
        rows = (results ?? []).map((r: Record<string, unknown>) => ({ code: r.code, name: r.name, quantity: Number(r.quantity ?? 0), unit_price: Number(r.unit_price ?? 0), value: Number(r.value ?? 0) }));
        headers = ["物料编码", "物料名称", "库存数量", "单价", "库存价值"];
      } else {
        return c.json({ error: "无效的报表类型" }, 404);
      }
      const headerToKey: Record<string, string> = { "物料编码": "code", "物料名称": "name", "期初库存": "beginning_stock", "期末库存": "ending_stock", "本期出库": "outbound", "周转率": "turnover_rate", "日期": "date", "入库数量": "inbound", "出库数量": "outbound", "净变化": "net_change", "往来单位": "partner_name", "使用数量": "usage", "占比": "percentage", "库存数量": "quantity", "单价": "unit_price", "库存价值": "value" };
      const lines = [headers.join(","), ...rows.map((r: Record<string, unknown>) => headers.map((h) => escapeCsv(r[headerToKey[h] || h] ?? "")).join(","))];
      const csv = "\uFEFF" + lines.join("\n");
      return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=report_${type}_${Date.now()}.csv` } });
    } catch (err: unknown) {
      return c.json({ error: err instanceof Error ? err.message : "导出报表失败" }, 500);
    }
  });
}
