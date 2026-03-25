import type { Hono } from "hono";
import type { Env } from "../lib/types";

type Deps = {
  requireAuthUser: (c: unknown) => Promise<{ id: number; role: string } | null>;
  requirePermission: (c: unknown, perm: string) => Promise<{ id: number } | null>;
};

export function registerOperationLogRoutes(app: Hono<Env>, deps: Deps) {
  const fail = (message: string, status = 400, code?: string) =>
    ({ success: false, error: { code: code || (status >= 500 ? "INTERNAL_ERROR" : "VALIDATION_FAILED"), message } } as const);

  app.get("/operation-logs", async (c) => {
    const user = await deps.requirePermission(c, "logs_view");
    if (!user) return c.res;
    const url = new URL(c.req.url);
    const { action, actions, operator, keyword, client_ip, module, start_date, end_date, limit, page, pageSize } = Object.fromEntries(url.searchParams);
    let sql = "SELECT id, action, description, operator, old_value, new_value, client_ip, created_at FROM operation_logs WHERE 1=1";
    const params: (string | number)[] = [];
    if (action) { sql += " AND action LIKE ?"; params.push("%" + String(action) + "%"); }
    if (actions) {
      const list = String(actions).split(",").map((s) => s.trim()).filter(Boolean);
      if (list.length) { sql += ` AND action IN (${list.map(() => "?").join(",")})`; params.push(...list); }
    }
    if (operator) { sql += " AND operator LIKE ?"; params.push("%" + String(operator) + "%"); }
    if (keyword) {
      const k = "%" + String(keyword) + "%";
      sql += " AND (description LIKE ? OR old_value LIKE ? OR new_value LIKE ?)";
      params.push(k, k, k);
    }
    if (client_ip) {
      sql += " AND client_ip LIKE ?";
      params.push("%" + String(client_ip) + "%");
    }
    if (module) {
      const m = String(module).trim();
      const moduleActions: Record<string, string[]> = {
        materials: ["CREATE_MATERIAL", "UPDATE_MATERIAL", "DELETE_MATERIAL", "BATCH_UPDATE_MATERIAL", "BATCH_DELETE_MATERIAL", "BATCH_IMPORT_MATERIAL"],
        transactions: ["INBOUND", "OUTBOUND", "REVERT_TRANSACTION", "UPDATE_INVENTORY_ALERT"],
        settings: [
          "CREATE_LOCATION", "UPDATE_LOCATION", "DELETE_LOCATION",
          "CREATE_UNIT", "UPDATE_UNIT", "DELETE_UNIT",
          "CREATE_STAFF", "UPDATE_STAFF", "DELETE_STAFF",
          "CREATE_DEPARTMENT", "UPDATE_DEPARTMENT", "DELETE_DEPARTMENT",
          "CREATE_REASON", "UPDATE_REASON", "DELETE_REASON",
          "CREATE_SOURCE", "UPDATE_SOURCE", "DELETE_SOURCE",
          "CREATE_CATEGORY", "UPDATE_CATEGORY", "DELETE_CATEGORY",
          "CREATE_PARTNER", "UPDATE_PARTNER", "DELETE_PARTNER",
        ],
        accounts: ["CREATE_USER", "UPDATE_USER", "DELETE_USER", "RESET_USER_PASSWORD", "UPDATE_ROLE_PERMISSIONS"],
        export: ["EXPORT_MATERIALS", "EXPORT_INVENTORY", "EXPORT_TRANSACTIONS", "EXPORT_OPERATION_LOGS", "EXPORT_REPORT"],
      };
      const list = moduleActions[m] || [];
      if (list.length) {
        sql += ` AND action IN (${list.map(() => "?").join(",")})`;
        params.push(...list);
      } else {
        return c.json({ data: [], total: 0, page: 1, pageSize: 20 });
      }
    }
    if (start_date) { sql += " AND created_at >= ?"; params.push(String(start_date)); }
    if (end_date) { sql += " AND created_at <= ?"; params.push(String(end_date) + " 23:59:59"); }

    const hasPaging = page != null || pageSize != null;
    if (hasPaging) {
      const p = Math.max(1, Number(page || 1));
      const ps = Math.min(200, Math.max(1, Number(pageSize || 20)));
      const countSql = `SELECT COUNT(1) as count FROM (${sql}) x`;
      const totalRow = await c.env.DB.prepare(countSql).bind(...params).first<{ count: number }>();
      const total = Number(totalRow?.count ?? 0);
      const { results } = await c.env.DB.prepare(sql + " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?").bind(...params, ps, (p - 1) * ps).all();
      return c.json({ data: results ?? [], total, page: p, pageSize: ps });
    }
    const lim = Math.min(Number(limit || 500) || 500, 1000);
    const { results } = await c.env.DB.prepare(sql + " ORDER BY created_at DESC, id DESC LIMIT ?").bind(...params, lim).all();
    return c.json(results ?? []);
  });

  app.delete("/operation-logs", async (c) => {
    const user = await deps.requireAuthUser(c);
    if (!user) return c.res;
    if (user.role !== "admin") {
      return c.json(fail("无权清空操作日志", 403, "PERMISSION_DENIED"), 403);
    }
    await c.env.DB.prepare("DELETE FROM operation_logs").run();
    return c.json({ success: true });
  });
}
