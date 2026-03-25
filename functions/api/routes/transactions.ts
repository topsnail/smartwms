import type { Hono } from "hono";
import type { Env } from "../lib/types";
import { hasPermission } from "../../../shared/permissions";

type Deps = {
  ensureSchema: (db: any) => Promise<void>;
  requireAuthUser: (c: any) => Promise<any | null>;
  addOperationLog: (
    db: any,
    action: string,
    description: string,
    operator?: string,
    opts?: { oldValue?: string; newValue?: string; clientIp?: string }
  ) => Promise<void>;
  getClientIp: (c: any) => string;
};

function toInt(value: any, field: string, opts: { min?: number; allowNull?: boolean } = {}): number | null {
  const { min, allowNull } = opts;
  if (value == null || value === "") return allowNull ? null : (() => { throw new Error(`缺少字段：${field}`); })();
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`字段格式错误：${field}`);
  if (min != null && n < min) throw new Error(`字段值不合法：${field}`);
  return n;
}
function toPositiveNumber(value: any, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`字段值不合法：${field}`);
  return n;
}
function toOptionalTrimmedText(value: any, maxLen = 500): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.length > maxLen) throw new Error("字段过长");
  return s;
}

export function registerTransactionRoutes(app: Hono<Env>, deps: Deps) {
  const fail = (message: string, status = 400, code?: string) =>
    ({ success: false, error: { code: code || (status >= 500 ? "INTERNAL_ERROR" : "VALIDATION_FAILED"), message } } as const);

  app.get("/transactions", async (c) => {
    const user = await deps.requireAuthUser(c);
    if (!user) return c.res;
    await deps.ensureSchema(c.env.DB);
    const url = new URL(c.req.url);
    const type = url.searchParams.get("type");
    const material_id = url.searchParams.get("material_id");
    const location_id = url.searchParams.get("location_id");
    const start_date = url.searchParams.get("start_date");
    const end_date = url.searchParams.get("end_date");
    const keyword = url.searchParams.get("keyword");
    const limit = url.searchParams.get("limit");
    const page = url.searchParams.get("page");
    const pageSize = url.searchParams.get("pageSize");

    let sql = `SELECT t.*, m.name as material_name, m.code as material_code, m.image_url,
    l.name as location_name, s1.name as operator_name, d.name as department_name, s2.name as recipient_name, p.name as partner_name
      FROM transactions t JOIN materials m ON t.material_id = m.id JOIN locations l ON t.location_id = l.id
      LEFT JOIN staff s1 ON t.operator_id = s1.id LEFT JOIN departments d ON t.department_id = d.id
      LEFT JOIN staff s2 ON t.recipient_id = s2.id LEFT JOIN partners p ON t.partner_id = p.id
      WHERE (t.reverted IS NULL OR t.reverted = 0)`;
    const params: any[] = [];
    if (type && (type === "IN" || type === "OUT")) { sql += " AND t.type = ?"; params.push(type); }
    if (material_id) { sql += " AND t.material_id = ?"; params.push(Number(material_id)); }
    if (location_id) { sql += " AND t.location_id = ?"; params.push(Number(location_id)); }
    if (start_date) { sql += " AND t.timestamp >= ?"; params.push(String(start_date)); }
    if (end_date) { sql += " AND t.timestamp <= ?"; params.push(String(end_date) + " 23:59:59"); }
    if (keyword) {
      const k = "%" + String(keyword) + "%";
      sql += " AND (m.name LIKE ? OR m.code LIKE ? OR s1.name LIKE ? OR t.note LIKE ? OR l.name LIKE ? OR d.name LIKE ? OR s2.name LIKE ? OR p.name LIKE ?)";
      params.push(k, k, k, k, k, k, k, k);
    }

    const hasPaging = page != null || pageSize != null;
    if (hasPaging) {
      const p = Math.max(1, Number(page || 1));
      const ps = Math.min(200, Math.max(1, Number(pageSize || 20)));
      const countSql = `SELECT COUNT(1) as count FROM (${sql}) x`;
      const totalRow = await c.env.DB.prepare(countSql).bind(...params).first<{ count: number }>();
      const total = Number(totalRow?.count ?? 0);
      const pagedSql = sql + " ORDER BY t.timestamp DESC LIMIT ? OFFSET ?";
      const { results } = await c.env.DB.prepare(pagedSql).bind(...params, ps, (p - 1) * ps).all();
      return c.json({ data: results ?? [], total, page: p, pageSize: ps });
    }

    const lim = Math.min(Number(limit || 500) || 500, 1000);
    const { results } = await c.env.DB.prepare(sql + " ORDER BY t.timestamp DESC LIMIT ?").bind(...params, lim).all();
    return c.json(results ?? []);
  });

  app.post("/transactions", async (c) => {
    const user = await deps.requireAuthUser(c);
    if (!user) return c.res;
    await deps.ensureSchema(c.env.DB);
    const body = await c.req.json<any>();
    const items: any[] = Array.isArray(body?.items) ? body.items : [body];
    if (items.length === 0) return c.json(fail("请提供至少一条出入库记录", 400), 400);
    const needInbound = items.some((it) => it?.type === "IN");
    const needOutbound = items.some((it) => it?.type === "OUT");
    const perms = user.permissions || [];
    const allowAll = perms.includes("*");
    if (!allowAll) {
      if (needInbound && !hasPermission(perms, "inbound")) return c.json(fail("您没有执行入库的权限", 403, "PERMISSION_DENIED"), 403);
      if (needOutbound && !hasPermission(perms, "outbound")) return c.json(fail("您没有执行出库的权限", 403, "PERMISSION_DENIED"), 403);
    }

    const ids: number[] = [];
    try {
      for (const item of items) {
        const type = String(item?.type || "");
        if (type !== "IN" && type !== "OUT") throw new Error("字段值不合法：type");
        const material_id = toInt(item?.material_id, "material_id", { min: 1 })!;
        const location_id = toInt(item?.location_id, "location_id", { min: 1 })!;
        const quantity = toPositiveNumber(item?.quantity, "quantity");
        const operator_id = toInt(item?.operator_id, "operator_id", { min: 1, allowNull: true });
        const department_id = toInt(item?.department_id, "department_id", { min: 1, allowNull: true });
        const recipient_id = toInt(item?.recipient_id, "recipient_id", { min: 1, allowNull: true });
        const partner_id = toInt(item?.partner_id, "partner_id", { min: 1, allowNull: true });
        const note = toOptionalTrimmedText(item?.note);

        await c.env.DB.exec("BEGIN IMMEDIATE TRANSACTION");
        let txId: number | null = null;
        try {
          if (type === "IN") {
            await c.env.DB.prepare("INSERT INTO inventory (material_id, location_id, quantity) VALUES (?, ?, ?) ON CONFLICT(material_id, location_id) DO UPDATE SET quantity = quantity + excluded.quantity")
              .bind(material_id, location_id, quantity)
              .run();
          } else {
            const result = await c.env.DB.prepare("UPDATE inventory SET quantity = quantity - ? WHERE material_id = ? AND location_id = ? AND quantity >= ?")
              .bind(quantity, material_id, location_id, quantity)
              .run();
            if (result.meta.changes === 0) {
              throw new Error("库存不足：当前库存可能已变化，请刷新后重试");
            }
          }
          const insertResult = await c.env.DB.prepare("INSERT INTO transactions (type, material_id, location_id, quantity, operator_id, department_id, recipient_id, partner_id, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(type, material_id, location_id, quantity, operator_id ?? null, department_id ?? null, recipient_id ?? null, partner_id ?? null, note ?? null)
            .run();
          txId = Number(insertResult.meta.last_row_id ?? 0) || null;
          await c.env.DB.exec("COMMIT");
        } catch (e) {
          await c.env.DB.exec("ROLLBACK");
          throw e;
        }
        if (txId) ids.push(txId);
        const material = await c.env.DB.prepare("SELECT name FROM materials WHERE id = ?").bind(material_id).first<any>();
        const location = await c.env.DB.prepare("SELECT name FROM locations WHERE id = ?").bind(location_id).first<any>();
        const operator = operator_id ? (await c.env.DB.prepare("SELECT name FROM staff WHERE id = ?").bind(operator_id).first<any>()) : null;
        await deps.addOperationLog(c.env.DB, type === "IN" ? "INBOUND" : "OUTBOUND", `${type === "IN" ? "入库" : "出库"}：物料【${material?.name ?? "未知"}】，库位【${location?.name ?? "未知"}】，数量：${quantity}`, operator?.name || user.displayName || user.username, { clientIp: deps.getClientIp(c) });
      }
      return c.json({ success: true, ids: ids.length === 1 ? ids[0] : ids });
    } catch (err: any) {
      return c.json(fail(err?.message ?? "操作失败", 400), 400);
    }
  });

  app.post("/transactions/:id/undo", async (c) => {
    const user = await deps.requireAuthUser(c);
    if (!user) return c.res;
    const id = c.req.param("id");
    try {
      const row = await c.env.DB.prepare("SELECT * FROM transactions WHERE id = ? AND (reverted IS NULL OR reverted = 0)").bind(id).first<any>();
      if (!row) return c.json(fail("记录不存在或已撤销", 404, "NOT_FOUND"), 404);
      const perms = user.permissions || [];
      const allowAll = perms.includes("*");
      if (!allowAll) {
        if (!hasPermission(perms, "transactions_undo")) return c.json(fail("您没有撤销出入库记录的权限", 403, "PERMISSION_DENIED"), 403);
        if (row.type === "IN" && !hasPermission(perms, "inbound")) return c.json(fail("您没有执行入库的权限", 403, "PERMISSION_DENIED"), 403);
        if (row.type === "OUT" && !hasPermission(perms, "outbound")) return c.json(fail("您没有执行出库的权限", 403, "PERMISSION_DENIED"), 403);
      }
      const diff = Date.now() - new Date(row.timestamp).getTime();
      if (diff > 5 * 60 * 1000) return c.json(fail("该记录已超过 5 分钟，无法撤销", 400), 400);
      const reverseType = row.type === "IN" ? "OUT" : "IN";
      await c.env.DB.exec("BEGIN IMMEDIATE TRANSACTION");
      const markResult = await c.env.DB.prepare("UPDATE transactions SET reverted = 1 WHERE id = ? AND (reverted IS NULL OR reverted = 0)").bind(id).run();
      if (markResult.meta.changes === 0) throw new Error("记录不存在或已撤销");
      const insertResult = await c.env.DB.prepare("INSERT INTO transactions (type, material_id, location_id, quantity, operator_id, department_id, recipient_id, partner_id, note, revert_transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(reverseType, row.material_id, row.location_id, row.quantity, row.operator_id, row.department_id, row.recipient_id, row.partner_id ?? null, `撤销原记录#${id}`, id)
        .run();
      const reverseId = Number(insertResult.meta.last_row_id ?? 0);
      if (reverseId > 0) {
        await c.env.DB.prepare("UPDATE transactions SET revert_transaction_id = ? WHERE id = ?").bind(reverseId, id).run();
      }
      if (reverseType === "IN") {
        await c.env.DB.prepare("INSERT INTO inventory (material_id, location_id, quantity) VALUES (?, ?, ?) ON CONFLICT(material_id, location_id) DO UPDATE SET quantity = quantity + excluded.quantity")
          .bind(row.material_id, row.location_id, row.quantity)
          .run();
      } else {
        const deductResult = await c.env.DB.prepare("UPDATE inventory SET quantity = quantity - ? WHERE material_id = ? AND location_id = ? AND quantity >= ?")
          .bind(row.quantity, row.material_id, row.location_id, row.quantity)
          .run();
        if (deductResult.meta.changes === 0) throw new Error("撤销失败：当前库存不足，无法回滚该记录");
      }
      await c.env.DB.exec("COMMIT");
      const material = await c.env.DB.prepare("SELECT name FROM materials WHERE id = ?").bind(row.material_id).first<any>();
      await deps.addOperationLog(c.env.DB, "REVERT_TRANSACTION", `撤销${row.type === "IN" ? "入库" : "出库"}记录#${id}：${material?.name ?? "未知"}`, user.displayName || user.username, { clientIp: deps.getClientIp(c) });
      return c.json({ success: true });
    } catch (err: any) {
      try { await c.env.DB.exec("ROLLBACK"); } catch {}
      return c.json(fail(err?.message ?? "撤销失败", 400), 400);
    }
  });
}

