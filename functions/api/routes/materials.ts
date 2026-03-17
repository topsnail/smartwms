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
  cleanRequiredText: (value: any, field: string, maxLen?: number) => string;
  cleanOptionalText: (value: any, field: string, maxLen?: number) => string | null;
  cleanOptionalPositiveInt: (value: any) => number | null;
  cleanOptionalNonNegativeNumber: (value: any) => number | null;
  cleanPositiveInt: (value: any) => number;
};

type Material = {
  id: number;
  code: string;
  name: string;
  spec: string | null;
  unit: string | null;
  category: string | null;
  image_url: string | null;
  source: string | null;
  price: number | null;
  purchase_price: number | null;
  sale_price: number | null;
  created_at: string;
};

export function registerMaterialsRoutes(app: Hono<Env>, deps: Deps) {
  app.get("/materials", async (c) => {
    const user = await deps.requireAuthUser(c);
    if (!user) return c.res;
    await deps.ensureSchema(c.env.DB);

    const url = new URL(c.req.url);
    const page = url.searchParams.get("page");
    const pageSize = url.searchParams.get("pageSize");
    const keyword = url.searchParams.get("keyword");
    const category_id = url.searchParams.get("category_id");
    const source = url.searchParams.get("source");

    const hasQuery =
      page !== null || pageSize !== null || keyword || category_id !== null || source;
    if (!hasQuery) {
      const { results } = await c.env.DB.prepare(
        `
      SELECT m.*, c.name as category_name 
      FROM materials m 
      LEFT JOIN material_categories c ON m.category_id = c.id 
      ORDER BY m.created_at DESC
    `
      ).all<Material & { category_name?: string }>();

      return c.json(results ?? []);
    }

    try {
      const p = Math.max(1, Number(page || 1));
      const ps = Math.min(200, Math.max(1, Number(pageSize || 20)));
      const offset = (p - 1) * ps;

      let where = " WHERE 1=1";
      const params: any[] = [];

      if (keyword) {
        const k = "%" + String(keyword).trim() + "%";
        where += " AND (m.name LIKE ? OR m.code LIKE ? OR m.spec LIKE ?)";
        params.push(k, k, k);
      }
      if (
        category_id !== null &&
        category_id !== undefined &&
        String(category_id) !== "" &&
        String(category_id) !== "null"
      ) {
        where += " AND m.category_id = ?";
        params.push(Number(category_id));
      }
      if (
        source !== null &&
        source !== undefined &&
        String(source).trim() !== "" &&
        String(source) !== "null"
      ) {
        where += " AND m.source = ?";
        params.push(String(source));
      }

      const totalRow = await c.env.DB
        .prepare(`SELECT COUNT(1) as total FROM materials m ${where}`)
        .bind(...params)
        .first<{ total: number }>();

      const { results } = await c.env.DB
        .prepare(
          `
        SELECT m.*, c.name as category_name
        FROM materials m
        LEFT JOIN material_categories c ON m.category_id = c.id
        ${where}
        ORDER BY m.created_at DESC
        LIMIT ? OFFSET ?
      `
        )
        .bind(...params, ps, offset)
        .all<any>();

      return c.json({
        data: results ?? [],
        total: Number(totalRow?.total || 0),
        page: p,
        pageSize: ps,
      });
    } catch (err: any) {
      return c.json(
        { success: false, error: { code: "INTERNAL_ERROR", message: err?.message || "获取物料列表失败" } },
        500
      );
    }
  });

  app.get("/materials/check-code", async (c) => {
    const user = await deps.requireAuthUser(c);
    if (!user) return c.res;
    const url = new URL(c.req.url);
    const code = url.searchParams.get("code");
    const exclude_id = url.searchParams.get("exclude_id");
    if (!code || !String(code).trim()) return c.json({ available: true });
    const c2 = String(code).trim();
    if (c2.length > 64) return c.json({ available: false, error: "编码过长" });
    const excludeId = exclude_id ? parseInt(String(exclude_id), 10) : null;
    let row: { id: number } | null = null;
    if (Number.isFinite(excludeId) && (excludeId as number) > 0) {
      row = await c.env.DB
        .prepare("SELECT id FROM materials WHERE code = ? AND id != ?")
        .bind(c2, excludeId)
        .first<{ id: number }>();
    } else {
      row = await c.env.DB
        .prepare("SELECT id FROM materials WHERE code = ?")
        .bind(c2)
        .first<{ id: number }>();
    }
    return c.json({ available: !row });
  });

  app.get("/materials/:id/can-delete", async (c) => {
    const user = await deps.requireAuthUser(c);
    if (!user) return c.res;
    const id = parseInt(c.req.param("id"), 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: "无效的物料ID" }, 400);
    const stockRow = await c.env.DB
      .prepare("SELECT COALESCE(SUM(quantity), 0) as total FROM inventory WHERE material_id = ?")
      .bind(id)
      .first<{ total: number }>();
    const txRow = await c.env.DB
      .prepare("SELECT COUNT(*) as cnt FROM transactions WHERE material_id = ?")
      .bind(id)
      .first<{ cnt: number }>();
    const stockTotal = Number(stockRow?.total ?? 0);
    const transactionCount = Number(txRow?.cnt ?? 0);
    const canDelete = stockTotal === 0;
    return c.json({
      canDelete,
      stockTotal,
      transactionCount,
      reason:
        stockTotal > 0
          ? `无法删除：库存未清零（当前合计 ${stockTotal}）。请先通过出库等方式将各仓位库存清零后再删除。`
          : undefined,
    });
  });

  app.get("/materials/batch-can-delete", async (c) => {
    const user = await deps.requireAuthUser(c);
    if (!user) return c.res;
    const url = new URL(c.req.url);
    const ids = url.searchParams.get("ids");
    if (!ids) return c.json({ error: "请提供 ids 参数，如 ids=1,2,3" }, 400);
    const idList = ids
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (idList.length === 0) return c.json({ results: [] });
    const ph = idList.map(() => "?").join(",");
    const { results } = await c.env.DB.prepare(
      `SELECT material_id as id, COALESCE(SUM(quantity), 0) as stock_total FROM inventory WHERE material_id IN (${ph}) GROUP BY material_id`
    )
      .bind(...idList)
      .all<{ id: number; stock_total: number }>();
    const stockMap = new Map((results ?? []).map((r) => [r.id, r.stock_total]));
    const res = idList.map((id) => {
      const stockTotal = stockMap.get(id) ?? 0;
      return {
        id,
        canDelete: stockTotal === 0,
        stockTotal,
        reason: stockTotal > 0 ? `无法删除：库存未清零（当前合计 ${stockTotal}）` : undefined,
      };
    });
    return c.json({ results: res });
  });

  app.post("/materials", async (c) => {
    const user = await deps.requirePermission(c, "edit_material");
    if (!user) return c.res;
    await deps.ensureSchema(c.env.DB);
    const body = await c.req.json<{
      code?: string;
      name?: string;
      spec?: string;
      unit?: string;
      category_id?: number;
      source?: string;
      purchase_price?: number;
      sale_price?: number;
      image_url?: string;
    }>();
    try {
      const cleanName = deps.cleanRequiredText(body?.name, "name", 120);
      const cleanCode = deps.cleanOptionalText(body?.code, "code", 64);
      const cleanSpec = deps.cleanOptionalText(body?.spec, "spec", 200);
      const cleanUnit = deps.cleanOptionalText(body?.unit, "unit", 50);
      const cleanCategoryId = deps.cleanOptionalPositiveInt(body?.category_id);
      const cleanSource = deps.cleanOptionalText(body?.source, "source", 120);
      const cleanPurchase = deps.cleanOptionalNonNegativeNumber(body?.purchase_price);
      const cleanSale = deps.cleanOptionalNonNegativeNumber(body?.sale_price);
      const cleanImageUrl = deps.cleanOptionalText(body?.image_url, "image_url", 300);
      const finalCode =
        cleanCode ||
        `M-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)
          .toString()
          .padStart(3, "0")}`;
      const existing = await c.env.DB
        .prepare("SELECT id FROM materials WHERE code = ?")
        .bind(finalCode)
        .first<{ id: number }>();
      if (existing) throw new Error(`物料编码「${finalCode}」已存在`);
      const r = await c.env.DB.prepare(
        "INSERT INTO materials (code, name, spec, unit, category_id, image_url, source, purchase_price, sale_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(
          finalCode,
          cleanName,
          cleanSpec,
          cleanUnit,
          cleanCategoryId ?? null,
          cleanImageUrl,
          cleanSource,
          cleanPurchase,
          cleanSale
        )
        .run();
      await deps.addOperationLog(
        c.env.DB,
        "CREATE_MATERIAL",
        `新增物料：${cleanName}（编码：${finalCode}）`,
        user.displayName || user.username,
        { clientIp: deps.getClientIp(c) }
      );
      return c.json({ id: r.meta.last_row_id });
    } catch (err: any) {
      return c.json({ error: err?.message ?? "新增物料失败" }, 400);
    }
  });

  app.put("/materials/:id", async (c) => {
    const user = await deps.requirePermission(c, "edit_material");
    if (!user) return c.res;
    const id = deps.cleanPositiveInt(c.req.param("id"));
    const body = await c.req.json<{
      code?: string;
      name?: string;
      spec?: string;
      unit?: string;
      category_id?: number;
      source?: string;
      purchase_price?: number;
      sale_price?: number;
      image_url?: string;
    }>();
    try {
      const cleanCode = deps.cleanRequiredText(body?.code, "code", 64);
      const cleanName = deps.cleanRequiredText(body?.name, "name", 120);
      const cleanSpec = deps.cleanOptionalText(body?.spec, "spec", 200);
      const cleanUnit = deps.cleanOptionalText(body?.unit, "unit", 50);
      const cleanCategoryId = deps.cleanOptionalPositiveInt(body?.category_id);
      const cleanSource = deps.cleanOptionalText(body?.source, "source", 120);
      const cleanPurchase = deps.cleanOptionalNonNegativeNumber(body?.purchase_price);
      const cleanSale = deps.cleanOptionalNonNegativeNumber(body?.sale_price);
      const cleanImageUrl = deps.cleanOptionalText(body?.image_url, "image_url", 300);
      const existing = await c.env.DB
        .prepare("SELECT id FROM materials WHERE code = ? AND id != ?")
        .bind(cleanCode, id)
        .first<{ id: number }>();
      if (existing) throw new Error(`物料编码「${cleanCode}」已被其他物料使用`);
      const old = await c.env.DB
        .prepare("SELECT code, name, spec, unit, category_id, source, purchase_price, sale_price FROM materials WHERE id = ?")
        .bind(id)
        .first<any>();
      await c.env.DB.prepare(
        "UPDATE materials SET code = ?, name = ?, spec = ?, unit = ?, category_id = ?, image_url = ?, source = ?, purchase_price = ?, sale_price = ? WHERE id = ?"
      )
        .bind(
          cleanCode,
          cleanName,
          cleanSpec,
          cleanUnit,
          cleanCategoryId ?? null,
          cleanImageUrl,
          cleanSource,
          cleanPurchase,
          cleanSale,
          id
        )
        .run();
      await deps.addOperationLog(
        c.env.DB,
        "UPDATE_MATERIAL",
        `编辑物料：${cleanName}（ID：${id}）`,
        user.displayName || user.username,
        {
          oldValue: old ? JSON.stringify(old) : "",
          newValue: JSON.stringify({
            code: cleanCode,
            name: cleanName,
            spec: cleanSpec,
            unit: cleanUnit,
            category_id: cleanCategoryId,
            source: cleanSource,
            purchase_price: cleanPurchase,
            sale_price: cleanSale,
          }),
          clientIp: deps.getClientIp(c),
        }
      );
      return c.json({ success: true });
    } catch (err: any) {
      return c.json({ error: err?.message ?? "编辑物料失败" }, 400);
    }
  });

  app.delete("/materials/:id", async (c) => {
    const user = await deps.requirePermission(c, "delete_material");
    if (!user) return c.res;
    const id = deps.cleanPositiveInt(c.req.param("id"));
    try {
      const stockRow = await c.env.DB
        .prepare("SELECT COALESCE(SUM(quantity), 0) as total FROM inventory WHERE material_id = ?")
        .bind(id)
        .first<{ total: number }>();
      const stockTotal = Number(stockRow?.total ?? 0);
      if (stockTotal > 0) {
        return c.json(
          { success: false, error: { code: "HAS_STOCK", message: `无法删除：库存未清零（当前合计 ${stockTotal}）` } },
          400
        );
      }
      const material = await c.env.DB
        .prepare("SELECT name, code FROM materials WHERE id = ?")
        .bind(id)
        .first<{ name: string; code: string }>();
      await c.env.DB.prepare("DELETE FROM materials WHERE id = ?").bind(id).run();
      await deps.addOperationLog(
        c.env.DB,
        "DELETE_MATERIAL",
        `删除物料：${material?.name ?? "未知"}（ID：${id}）`,
        user.displayName || user.username,
        { clientIp: deps.getClientIp(c) }
      );
      return c.json({ success: true });
    } catch (err: any) {
      return c.json({ error: err?.message ?? "删除物料失败" }, 400);
    }
  });

  app.post("/materials/batch-update", async (c) => {
    const user = await deps.requirePermission(c, "edit_material");
    if (!user) return c.res;
    const body = await c.req.json<{
      ids?: number[];
      updates?: { category_id?: number | null; unit?: string; source?: string };
    }>();
    if (!Array.isArray(body?.ids) || body.ids.length === 0 || !body?.updates || typeof body.updates !== "object") {
      return c.json({ error: "请提供 ids 和 updates" }, 400);
    }
    try {
      const updates = body.updates;
      const setParts: string[] = [];
      const params: any[] = [];
      if (updates.category_id != null) {
        setParts.push("category_id = ?");
        params.push(updates.category_id);
      }
      if (updates.unit != null) {
        setParts.push("unit = ?");
        params.push(deps.cleanOptionalText(updates.unit, "unit", 50));
      }
      if (updates.source != null) {
        setParts.push("source = ?");
        params.push(deps.cleanOptionalText(updates.source, "source", 120));
      }
      if (setParts.length === 0) return c.json({ error: "updates 至少需要 category_id、unit 或 source 之一" }, 400);
      const ph = body.ids.map(() => "?").join(",");
      await c.env.DB.prepare(`UPDATE materials SET ${setParts.join(", ")} WHERE id IN (${ph})`)
        .bind(...params, ...body.ids)
        .run();
      await deps.addOperationLog(
        c.env.DB,
        "BATCH_UPDATE_MATERIAL",
        `批量更新物料：${body.ids.length} 个`,
        user.displayName || user.username,
        { clientIp: deps.getClientIp(c) }
      );
      return c.json({ success: true });
    } catch (err: any) {
      return c.json({ error: err?.message ?? "批量更新物料失败" }, 400);
    }
  });

  app.post("/materials/batch-delete", async (c) => {
    const user = await deps.requirePermission(c, "delete_material");
    if (!user) return c.res;
    const body = await c.req.json<{ ids?: number[] }>();
    if (!Array.isArray(body?.ids) || body.ids.length === 0)
      return c.json(
        { success: false, error: { code: "VALIDATION_FAILED", message: "请提供要删除的物料ID列表" } },
        400
      );
    try {
      const ph = body.ids.map(() => "?").join(",");
      const { results } = await c.env.DB.prepare(
        `SELECT material_id as id, COALESCE(SUM(quantity), 0) as stock_total FROM inventory WHERE material_id IN (${ph}) GROUP BY material_id HAVING SUM(quantity) > 0`
      )
        .bind(...body.ids)
        .all<{ id: number; stock_total: number }>();
      if ((results ?? []).length > 0) {
        const detail = (results ?? []).map((r) => `ID ${r.id} 库存 ${r.stock_total}`).join("；");
        return c.json(
          { success: false, error: { code: "HAS_STOCK", message: `无法批量删除：存在未清零库存的物料（${detail}）` } },
          400
        );
      }
      const { results: mats } = await c.env.DB.prepare(`SELECT id, name, code FROM materials WHERE id IN (${ph})`)
        .bind(...body.ids)
        .all<any>();
      await c.env.DB.prepare(`DELETE FROM materials WHERE id IN (${ph})`).bind(...body.ids).run();
      await deps.addOperationLog(
        c.env.DB,
        "BATCH_DELETE_MATERIAL",
        `批量删除物料：${body.ids.length} 个`,
        user.displayName || user.username,
        { clientIp: deps.getClientIp(c) }
      );
      return c.json({ success: true, deletedCount: body.ids.length, deletedMaterials: mats ?? [] });
    } catch (err: any) {
      return c.json({ error: err?.message ?? "批量删除物料失败" }, 400);
    }
  });

  app.post("/materials/batch-import", async (c) => {
    const user = await deps.requirePermission(c, "edit_material");
    if (!user) return c.res;
    const body = await c.req.json<{ materials?: any[] }>();
    if (!Array.isArray(body?.materials) || body.materials.length === 0)
      return c.json(
        { success: false, error: { code: "VALIDATION_FAILED", message: "请提供要导入的物料列表" } },
        400
      );
    let successCount = 0;
    const failedItems: { item: any; error: string }[] = [];
    for (const item of body.materials) {
      try {
        const cleanName = deps.cleanRequiredText(item?.name, "name", 120);
        const cleanCode = deps.cleanOptionalText(item?.code, "code", 64);
        const cleanSpec = deps.cleanOptionalText(item?.spec, "spec", 200);
        const cleanUnit = deps.cleanOptionalText(item?.unit, "unit", 50);
        const cleanCategoryId = deps.cleanOptionalPositiveInt(item?.category_id);
        const cleanSource = deps.cleanOptionalText(item?.source, "source", 120);
        const cleanPurchase = deps.cleanOptionalNonNegativeNumber(item?.purchase_price);
        const cleanSale = deps.cleanOptionalNonNegativeNumber(item?.sale_price);
        const cleanImageUrl = deps.cleanOptionalText(item?.image_url, "image_url", 300);
        const finalCode =
          cleanCode ||
          `M-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)
            .toString()
            .padStart(3, "0")}`;
        const existsCode = await c.env.DB
          .prepare("SELECT id FROM materials WHERE code = ?")
          .bind(finalCode)
          .first<{ id: number }>();
        if (existsCode) throw new Error(`编码「${finalCode}」已存在`);
        await c.env.DB.prepare(
          "INSERT INTO materials (code, name, spec, unit, category_id, image_url, source, purchase_price, sale_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
          .bind(
            finalCode,
            cleanName,
            cleanSpec,
            cleanUnit,
            cleanCategoryId ?? null,
            cleanImageUrl,
            cleanSource,
            cleanPurchase,
            cleanSale
          )
          .run();
        successCount++;
      } catch (err: any) {
        failedItems.push({ item, error: err?.message ?? "未知错误" });
      }
    }
    await deps.addOperationLog(
      c.env.DB,
      "BATCH_IMPORT_MATERIAL",
      `批量导入物料：成功 ${successCount} 个，失败 ${failedItems.length} 个`,
      user.displayName || user.username,
      { clientIp: deps.getClientIp(c) }
    );
    return c.json({
      success: true,
      successCount,
      failedCount: failedItems.length,
      failedItems,
    });
  });
}

