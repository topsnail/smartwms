import type { Hono } from "hono";
import type { D1Database } from "../lib/types";
import type { Env } from "../lib/types";

type BaseDataRow = { id: number; name: string; role?: string | null };

const SETTINGS_TABLES: Record<string, string> = {
  locations: "locations",
  units: "units",
  staff: "staff",
  departments: "departments",
  reasons: "usage_reasons",
  sources: "material_sources",
  categories: "material_categories",
  partners: "partners",
};

async function existsName(db: D1Database, table: string, name: string, excludeId?: number | null): Promise<boolean> {
  let sql = `SELECT id FROM ${table} WHERE lower(name) = lower(?)`;
  const params: (string | number)[] = [name];
  if (excludeId != null) {
    sql += " AND id != ?";
    params.push(excludeId);
  }
  const row = await db.prepare(sql).bind(...params).first<{ id: number }>();
  return !!row;
}

type Deps = {
  ensureSchema: (db: D1Database) => Promise<void>;
  requireAuthUser: (c: unknown) => Promise<{ id: number; username: string; displayName: string | null; role: string } | null>;
  requirePermission: (c: unknown, perm: string) => Promise<{ id: number; username: string; displayName: string | null; role: string } | null>;
  addOperationLog: (db: D1Database, action: string, description: string, operator?: string, opts?: { clientIp?: string }) => Promise<void>;
  getClientIp: (c: unknown) => string;
};

export function registerSettingsRoutes(app: Hono<Env>, deps: Deps) {
  app.get("/settings/:type", async (c) => {
    const user = await deps.requireAuthUser(c);
    if (!user) return c.res;
    await deps.ensureSchema(c.env.DB);
    const type = c.req.param("type");
    const table = SETTINGS_TABLES[type];
    if (!table) return c.json({ error: "无效的类型" }, 404);
    const { results } = await c.env.DB.prepare(`SELECT * FROM ${table} ORDER BY id ASC`).all<BaseDataRow>();
    return c.json(results ?? []);
  });

  app.post("/settings/:type", async (c) => {
    const user = await deps.requirePermission(c, "edit_settings");
    if (!user) return c.res;
    await deps.ensureSchema(c.env.DB);
    const type = c.req.param("type");
    const body = await c.req.json<{ name?: string; role?: string; parent_id?: number; description?: string; invoice_info?: string; contact?: string; mailing_address?: string }>();
    const name = String(body?.name ?? "").trim();
    if (!name || name.length > 50) return c.json({ error: "名称不能为空或过长" }, 400);
    const op = user.displayName || user.username;
    const ip = deps.getClientIp(c);
    try {
      let lastId: number | null = null;
      if (type === "locations") {
        if (await existsName(c.env.DB, "locations", name)) throw new Error("名称已存在");
        const r = await c.env.DB.prepare("INSERT INTO locations (name) VALUES (?)").bind(name).run();
        lastId = r.meta.last_row_id;
        await deps.addOperationLog(c.env.DB, "CREATE_LOCATION", `新增存放位置：${name}`, op, { clientIp: ip });
      } else if (type === "units") {
        if (await existsName(c.env.DB, "units", name)) throw new Error("名称已存在");
        const r = await c.env.DB.prepare("INSERT INTO units (name) VALUES (?)").bind(name).run();
        lastId = r.meta.last_row_id;
        await deps.addOperationLog(c.env.DB, "CREATE_UNIT", `新增计量单位：${name}`, op, { clientIp: ip });
      } else if (type === "staff") {
        const role = body.role ? String(body.role).trim() : null;
        if (await existsName(c.env.DB, "staff", name)) throw new Error("人员已存在");
        const r = await c.env.DB.prepare("INSERT INTO staff (name, role) VALUES (?, ?)").bind(name, role).run();
        lastId = r.meta.last_row_id;
        await deps.addOperationLog(c.env.DB, "CREATE_STAFF", `新增人员：${name}`, op, { clientIp: ip });
      } else if (type === "departments") {
        if (await existsName(c.env.DB, "departments", name)) throw new Error("名称已存在");
        const r = await c.env.DB.prepare("INSERT INTO departments (name) VALUES (?)").bind(name).run();
        lastId = r.meta.last_row_id;
        await deps.addOperationLog(c.env.DB, "CREATE_DEPARTMENT", `新增领料部门：${name}`, op, { clientIp: ip });
      } else if (type === "reasons") {
        if (await existsName(c.env.DB, "usage_reasons", name)) throw new Error("名称已存在");
        const r = await c.env.DB.prepare("INSERT INTO usage_reasons (name) VALUES (?)").bind(name).run();
        lastId = r.meta.last_row_id;
        await deps.addOperationLog(c.env.DB, "CREATE_REASON", `新增出库事由：${name}`, op, { clientIp: ip });
      } else if (type === "sources") {
        if (await existsName(c.env.DB, "material_sources", name)) throw new Error("名称已存在");
        const r = await c.env.DB.prepare("INSERT INTO material_sources (name) VALUES (?)").bind(name).run();
        lastId = r.meta.last_row_id;
        await deps.addOperationLog(c.env.DB, "CREATE_SOURCE", `新增物料来源：${name}`, op, { clientIp: ip });
      } else if (type === "categories") {
        const parent_id = body.parent_id ? Number(body.parent_id) : null;
        const description = body.description ? String(body.description).trim().slice(0, 500) : null;
        if (await existsName(c.env.DB, "material_categories", name)) throw new Error("同级分类名称已存在");
        const r = await c.env.DB.prepare("INSERT INTO material_categories (name, parent_id, description) VALUES (?, ?, ?)").bind(name, parent_id, description).run();
        lastId = r.meta.last_row_id;
        await deps.addOperationLog(c.env.DB, "CREATE_CATEGORY", `新增物料分类：${name}`, op, { clientIp: ip });
      } else if (type === "partners") {
        if (await existsName(c.env.DB, "partners", name)) throw new Error("公司名称已存在");
        const inv = body.invoice_info ? String(body.invoice_info).trim().slice(0, 500) : null;
        const contact = body.contact ? String(body.contact).trim().slice(0, 200) : null;
        const addr = body.mailing_address ? String(body.mailing_address).trim().slice(0, 500) : null;
        const r = await c.env.DB.prepare("INSERT INTO partners (name, invoice_info, contact, mailing_address) VALUES (?, ?, ?, ?)").bind(name, inv, contact, addr).run();
        lastId = r.meta.last_row_id;
        await deps.addOperationLog(c.env.DB, "CREATE_PARTNER", `新增往来单位：${name}`, op, { clientIp: ip });
      } else {
        return c.json({ error: "无效的类型" }, 404);
      }
      return c.json({ success: true, id: lastId });
    } catch (err: unknown) {
      return c.json({ error: err instanceof Error ? err.message : "新增失败" }, 400);
    }
  });

  app.put("/settings/:type/:id", async (c) => {
    const user = await deps.requirePermission(c, "edit_settings");
    if (!user) return c.res;
    const type = c.req.param("type");
    const id = c.req.param("id");
    const body = await c.req.json<{ name?: string; role?: string; parent_id?: number; description?: string; invoice_info?: string; contact?: string; mailing_address?: string }>();
    const name = String(body?.name ?? "").trim();
    if (!name || name.length > 50) return c.json({ error: "名称不能为空或过长" }, 400);
    const table = SETTINGS_TABLES[type];
    if (!table) return c.json({ error: "无效的类型" }, 404);
    try {
      if (await existsName(c.env.DB, table, name, Number(id))) throw new Error("名称已存在");
      if (type === "locations") await c.env.DB.prepare("UPDATE locations SET name = ? WHERE id = ?").bind(name, id).run();
      else if (type === "units") await c.env.DB.prepare("UPDATE units SET name = ? WHERE id = ?").bind(name, id).run();
      else if (type === "staff") await c.env.DB.prepare("UPDATE staff SET name = ?, role = ? WHERE id = ?").bind(name, body.role ?? null, id).run();
      else if (type === "departments") await c.env.DB.prepare("UPDATE departments SET name = ? WHERE id = ?").bind(name, id).run();
      else if (type === "reasons") await c.env.DB.prepare("UPDATE usage_reasons SET name = ? WHERE id = ?").bind(name, id).run();
      else if (type === "sources") await c.env.DB.prepare("UPDATE material_sources SET name = ? WHERE id = ?").bind(name, id).run();
      else if (type === "categories") {
        const parent_id = body.parent_id ? Number(body.parent_id) : null;
        const description = body.description ? String(body.description).trim().slice(0, 500) : null;
        await c.env.DB.prepare("UPDATE material_categories SET name = ?, parent_id = ?, description = ? WHERE id = ?").bind(name, parent_id, description, id).run();
      } else if (type === "partners") {
        const inv = body.invoice_info ? String(body.invoice_info).trim().slice(0, 500) : null;
        const contact = body.contact ? String(body.contact).trim().slice(0, 200) : null;
        const addr = body.mailing_address ? String(body.mailing_address).trim().slice(0, 500) : null;
        await c.env.DB.prepare("UPDATE partners SET name = ?, invoice_info = ?, contact = ?, mailing_address = ? WHERE id = ?").bind(name, inv, contact, addr, id).run();
      }
      return c.json({ success: true });
    } catch (err: unknown) {
      return c.json({ error: err instanceof Error ? err.message : "编辑失败" }, 400);
    }
  });

  app.delete("/settings/:type/:id", async (c) => {
    const user = await deps.requirePermission(c, "delete_settings");
    if (!user) return c.res;
    const type = c.req.param("type");
    const id = c.req.param("id");
    const table = SETTINGS_TABLES[type];
    if (!table) return c.json({ error: "无效的类型" }, 404);
    try {
      const row = await c.env.DB.prepare(`SELECT name FROM ${table} WHERE id = ?`).bind(id).first<{ name: string }>();
      if (!row) return c.json({ error: "记录不存在" }, 404);
      if (type === "locations") {
        const usedInv = (await c.env.DB.prepare("SELECT COUNT(*) as c FROM inventory WHERE location_id = ?").bind(id).first<{ c: number }>())?.c ?? 0;
        const usedTx = (await c.env.DB.prepare("SELECT COUNT(*) as c FROM transactions WHERE location_id = ?").bind(id).first<{ c: number }>())?.c ?? 0;
        if (usedInv > 0 || usedTx > 0) return c.json({ error: "该库位已被库存或出入库记录引用" }, 400);
      } else if (type === "units") {
        const used = (await c.env.DB.prepare("SELECT COUNT(*) as c FROM materials WHERE unit = ?").bind(row.name).first<{ c: number }>())?.c ?? 0;
        if (used > 0) return c.json({ error: `该单位已被 ${used} 个物料使用` }, 400);
      } else if (type === "staff") {
        const used = (await c.env.DB.prepare("SELECT COUNT(*) as c FROM transactions WHERE operator_id = ? OR recipient_id = ?").bind(id, id).first<{ c: number }>())?.c ?? 0;
        if (used > 0) return c.json({ error: "该人员已被出入库记录引用" }, 400);
      } else if (type === "departments") {
        const used = (await c.env.DB.prepare("SELECT COUNT(*) as c FROM transactions WHERE department_id = ?").bind(id).first<{ c: number }>())?.c ?? 0;
        if (used > 0) return c.json({ error: "该部门已被出入库记录引用" }, 400);
      } else if (type === "sources") {
        const used = (await c.env.DB.prepare("SELECT COUNT(*) as c FROM materials WHERE source = ?").bind(row.name).first<{ c: number }>())?.c ?? 0;
        if (used > 0) return c.json({ error: `该来源已被 ${used} 个物料使用` }, 400);
      } else if (type === "categories") {
        await c.env.DB.prepare("UPDATE materials SET category_id = NULL WHERE category_id = ?").bind(id).run();
        await c.env.DB.prepare("UPDATE material_categories SET parent_id = NULL WHERE parent_id = ?").bind(id).run();
      } else if (type === "partners") {
        const used = (await c.env.DB.prepare("SELECT COUNT(*) as c FROM transactions WHERE partner_id = ?").bind(id).first<{ c: number }>())?.c ?? 0;
        if (used > 0) return c.json({ error: "该往来单位已被出入库记录引用" }, 400);
      }
      await c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
      return c.json({ success: true });
    } catch (err: unknown) {
      return c.json({ error: err instanceof Error ? err.message : "删除失败" }, 400);
    }
  });
}
