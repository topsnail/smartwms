import type { Hono } from "hono";
import type { Env } from "../lib/types";
import type { PermissionKey } from "../../../shared/permissions";

type Deps = {
  ensureSchema: (db: any) => Promise<void>;
  requireAuthUser: (c: any) => Promise<any | null>;
  requirePermission: (c: any, perm: PermissionKey) => Promise<any | null>;
  addOperationLog: (
    db: any,
    action: string,
    description: string,
    operator?: string,
    opts?: { oldValue?: string; newValue?: string; clientIp?: string }
  ) => Promise<void>;
  getClientIp: (c: any) => string;
  cleanOptionalNonNegativeNumber: (value: any) => number | null;
  cleanPositiveInt: (value: any) => number;
};

export function registerInventoryRoutes(app: Hono<Env>, deps: Deps) {
  const fail = (message: string, status = 400, code?: string) =>
    ({ success: false, error: { code: code || (status >= 500 ? "INTERNAL_ERROR" : "VALIDATION_FAILED"), message } } as const);

  app.get("/inventory", async (c) => {
    const user = await deps.requireAuthUser(c);
    if (!user) return c.res;
    await deps.ensureSchema(c.env.DB);
    const result = await c.env.DB
      .prepare(
        `
      SELECT 
        m.code, m.name, m.spec, m.unit, m.image_url,
        l.name as location_name, 
        i.quantity, i.min_stock, i.max_stock,
        i.material_id, i.location_id
      FROM inventory i
      JOIN materials m ON i.material_id = m.id
      JOIN locations l ON i.location_id = l.id
      WHERE i.quantity > 0
      ORDER BY l.name, m.code
    `
      )
      .all<any>();
    return c.json(result.results ?? []);
  });

  app.get("/inventory/alert", async (c) => {
    const user = await deps.requireAuthUser(c);
    if (!user) return c.res;
    const result = await c.env.DB
      .prepare(
        `
      SELECT m.code, m.name, m.spec, m.unit, m.image_url,
        l.name as location_name, i.quantity, i.min_stock, i.max_stock,
        i.material_id, i.location_id
      FROM inventory i
      JOIN materials m ON i.material_id = m.id
      JOIN locations l ON i.location_id = l.id
      WHERE (i.quantity <= i.min_stock AND i.min_stock > 0) OR (i.quantity >= i.max_stock AND i.max_stock > 0)
      ORDER BY l.name, m.code
    `
      )
      .all<any>();
    return c.json(result.results ?? []);
  });

  app.get("/inventory/stock", async (c) => {
    const user = await deps.requireAuthUser(c);
    if (!user) return c.res;
    const url = new URL(c.req.url);
    const material_id = url.searchParams.get("material_id");
    const location_id = url.searchParams.get("location_id");
    if (!material_id || !location_id) {
      return c.json(fail("需要 material_id 和 location_id", 400), 400);
    }
    const row = await c.env.DB
      .prepare("SELECT quantity FROM inventory WHERE material_id = ? AND location_id = ?")
      .bind(Number(material_id), Number(location_id))
      .first<{ quantity: number }>();
    return c.json({ quantity: row?.quantity ?? 0 });
  });

  app.put("/inventory/:materialId/:locationId", async (c) => {
    const user = await deps.requirePermission(c, "inventory_alert_edit");
    if (!user) return c.res;
    const materialId = deps.cleanPositiveInt(c.req.param("materialId"));
    const locationId = deps.cleanPositiveInt(c.req.param("locationId"));
    const body = await c.req.json<{ min_stock?: number; max_stock?: number }>();
    try {
      const minV = deps.cleanOptionalNonNegativeNumber(body?.min_stock) ?? 0;
      const maxV = deps.cleanOptionalNonNegativeNumber(body?.max_stock) ?? 0;
      await c.env.DB
        .prepare(
          "UPDATE inventory SET min_stock = ?, max_stock = ? WHERE material_id = ? AND location_id = ?"
        )
        .bind(minV, maxV, materialId, locationId)
        .run();
      await deps.addOperationLog(
        c.env.DB,
        "UPDATE_INVENTORY_ALERT",
        `更新库存预警：物料【${(await c.env.DB.prepare("SELECT name, code FROM materials WHERE id = ?").bind(materialId).first<any>())?.name ?? "未知"}】，库位【${(await c.env.DB.prepare("SELECT name FROM locations WHERE id = ?").bind(locationId).first<any>())?.name ?? "未知"}】`,
        user.displayName || user.username,
        {
          clientIp: deps.getClientIp(c),
        }
      );
      return c.json({ success: true });
    } catch (err: any) {
      return c.json(fail(err?.message ?? "更新库存预警阈值失败", 400), 400);
    }
  });
}

