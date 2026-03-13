import { Hono } from "hono";
import { handle } from "hono/cloudflare-pages";
import { sign, verify } from "hono/jwt";
import bcrypt from "bcryptjs";

// Minimal D1 type definitions for TypeScript.
// At runtime, Cloudflare will provide the actual implementations.
type D1Result<T = unknown> = {
  results?: T[];
  success: boolean;
  meta: {
    duration: number;
    changes: number;
    last_row_id: number | null;
  };
};

type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = unknown>(): Promise<D1Result<T>>;
  run<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(): Promise<T | null>;
};

type D1Database = {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
};

type R2Bucket = {
  put(key: string, value: ArrayBuffer | ReadableStream | Blob, opts?: { httpMetadata?: { contentType?: string } }): Promise<void>;
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
};

type Bindings = {
  DB: D1Database;
  R2_BUCKET?: R2Bucket;
  JWT_SECRET?: string;
  JWT_EXPIRES_IN?: string;
};

type Env = {
  Bindings: Bindings;
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

type InventoryRow = {
  material_id: number;
  location_id: number;
  code: string;
  name: string;
  spec: string | null;
  unit: string | null;
  location_name: string;
  quantity: number;
};

type TransactionRow = {
  id: number;
  type: "IN" | "OUT";
  material_id: number;
  location_id: number;
  quantity: number;
  operator_id: number | null;
  department_id: number | null;
  recipient_id: number | null;
  partner_id: number | null;
  timestamp: string;
  note: string | null;
  material_name: string;
  material_code: string;
  image_url: string | null;
  location_name: string;
  operator_name: string | null;
  department_name: string | null;
  recipient_name: string | null;
  partner_name: string | null;
};

type BaseDataRow = {
  id: number;
  name: string;
  role?: string | null;
};

type PermissionKey =
  | "view"
  | "materials_view"
  | "inventory_view"
  | "transactions_view"
  | "logs_view"
  | "settings_view"
  | "view_reports"
  | "inbound"
  | "outbound"
  | "transactions_inbound"
  | "transactions_outbound"
  | "transactions_undo"
  | "edit_material"
  | "delete_material"
  | "materials_edit"
  | "materials_delete"
  | "materials_import"
  | "upload_image"
  | "inventory_alert_edit"
  | "edit_settings"
  | "delete_settings"
  | "settings_edit"
  | "settings_delete"
  | "export"
  | "export_transactions"
  | "export_operation_logs"
  | "export_materials"
  | "export_inventory"
  | "backup"
  | "backup_db"
  | "manage_accounts"
  | "manage_role_permissions";

type UserPayload = {
  id: number;
  username: string;
  displayName: string;
  role: string;
  permissions: string[];
};

const app = new Hono<Env>().basePath("/api");

// JWT_SECRET 必须由 Cloudflare Pages 环境变量提供（生产环境不允许兜底默认值）

let schemaReady: Promise<void> | null = null;
async function ensureSchema(db: D1Database) {
  if (!schemaReady) {
    schemaReady = (async () => {
      // Create partners table if missing
      await db
        .prepare(
          "CREATE TABLE IF NOT EXISTS partners (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, invoice_info TEXT, contact TEXT, mailing_address TEXT)"
        )
        .run();

      // Add partner_id column to transactions if missing (best-effort)
      try {
        await db.prepare("ALTER TABLE transactions ADD COLUMN partner_id INTEGER").run();
      } catch {
        // ignore if already exists / not supported
      }
    })();
  }
  await schemaReady;
}

function hasPermission(perms: string[] | undefined, required: PermissionKey): boolean {
  if (!perms) return false;
  if (perms.includes("*")) return true;
  if (perms.includes(required)) return true;

  // 兼容映射：细粒度权限 -> 旧权限 / 总开关
  if (required === "export") return perms.some((p) => p.startsWith("export_"));
  if (required === "backup") return perms.includes("backup_db");
  if (required === "edit_material")
    return perms.includes("materials_edit") || perms.includes("materials_import") || perms.includes("upload_image");
  if (required === "delete_material") return perms.includes("materials_delete");
  if (required === "edit_settings") return perms.includes("settings_edit");
  if (required === "delete_settings") return perms.includes("settings_delete");
  if (required === "view_reports") return perms.includes("view_reports");
  if (required === "inbound") return perms.includes("transactions_inbound");
  if (required === "outbound") return perms.includes("transactions_outbound");

  // 兼容映射：旧权限 -> 细粒度权限
  if (
    required === "export_materials" ||
    required === "export_inventory" ||
    required === "export_transactions" ||
    required === "export_operation_logs"
  ) {
    return perms.includes("export");
  }
  if (required === "backup_db") return perms.includes("backup");
  if (required === "materials_edit" || required === "materials_import" || required === "upload_image")
    return perms.includes("edit_material");
  if (required === "materials_delete") return perms.includes("delete_material");
  if (required === "settings_edit") return perms.includes("edit_settings");
  if (required === "settings_delete") return perms.includes("delete_settings");
  if (required === "transactions_inbound") return perms.includes("inbound");
  if (required === "transactions_outbound") return perms.includes("outbound");

  return false;
}

function getJwtSecret(env: Bindings): string {
  const raw = (env.JWT_SECRET || "").trim();
  if (raw) return raw;
  throw new Error("JWT_SECRET 缺失：请在 Cloudflare Pages 的环境变量中配置 JWT_SECRET");
}

function getJwtExpiresInMs(env: Bindings): number {
  const v = (env.JWT_EXPIRES_IN || "").trim() || "7d";
  if (v.endsWith("d")) return parseInt(v) * 24 * 60 * 60 * 1000;
  if (v.endsWith("h")) return parseInt(v) * 60 * 60 * 1000;
  if (v.endsWith("m")) return parseInt(v) * 60 * 1000;
  if (v.endsWith("s")) return parseInt(v) * 1000;
  return parseInt(v) || 7 * 24 * 60 * 60 * 1000;
}

async function loadUserWithPermissions(db: D1Database, id: number): Promise<UserPayload | null> {
  const row = await db
    .prepare("SELECT id, username, display_name, role, disabled, password_hash FROM users WHERE id = ?")
    .bind(id)
    .first<any>();
  if (!row || row.disabled) return null;
  let perms: string[] = [];
  try {
    const rp = await db
      .prepare("SELECT permissions FROM role_permissions WHERE role = ?")
      .bind(row.role)
      .first<{ permissions?: string }>();
    perms = rp?.permissions ? JSON.parse(rp.permissions) : [];
    if (!Array.isArray(perms)) perms = [];
  } catch {
    perms = [];
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    permissions: perms.map(String),
  };
}

async function getAuthUser(c: any): Promise<UserPayload | null> {
  const auth = c.req.header("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length).trim();
  if (!token) return null;
  try {
    const secret = getJwtSecret(c.env);
    const payload = await verify(token, secret, "HS256");
    const userId = (payload as any)?.userId;
    if (!userId) return null;
    return await loadUserWithPermissions(c.env.DB, Number(userId));
  } catch {
    return null;
  }
}

async function requireAuthUser(c: any): Promise<UserPayload | null> {
  const user = await getAuthUser(c);
  if (!user) {
    c.status(401);
    c.json({ success: false, error: { code: "AUTH_UNAUTHORIZED", message: "未登录" } });
    return null;
  }
  return user;
}

async function requirePermission(c: any, perm: PermissionKey): Promise<UserPayload | null> {
  const user = await requireAuthUser(c);
  if (!user) return null;
  if (!hasPermission(user.permissions, perm)) {
    c.status(403);
    c.json({ error: "您没有执行此操作的权限" });
    return null;
  }
  return user;
}

function getClientIp(c: any): string {
  const xff = c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For");
  if (xff) return String(xff).split(",")[0]?.trim() || "未知";
  return "未知";
}

async function addOperationLog(
  db: D1Database,
  action: string,
  description: string,
  operator: string = "系统",
  opts?: { oldValue?: string; newValue?: string; clientIp?: string }
) {
  try {
    await db
      .prepare(
        "INSERT INTO operation_logs (action, description, operator, old_value, new_value, client_ip) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(
        action,
        description,
        operator,
        opts?.oldValue ?? null,
        opts?.newValue ?? null,
        opts?.clientIp ?? null
      )
      .run();
  } catch (err) {
    console.error("[operation_log] Failed to insert log", err);
  }
}

function cleanRequiredText(value: any, field: string, maxLen = 100): string {
  const s = String(value ?? "").trim();
  if (!s) throw new Error(`缺少字段：${field}`);
  if (s.length > maxLen) throw new Error(`字段过长：${field}`);
  return s;
}
function cleanOptionalText(value: any, _field: string, maxLen = 200): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.length > maxLen) throw new Error("字段过长");
  return s;
}
function cleanOptionalNonNegativeNumber(value: any): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error("字段值不合法");
  return n;
}
function cleanOptionalPositiveInt(value: any): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) throw new Error("字段值不合法");
  return n;
}
function cleanPositiveInt(value: any): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) throw new Error("字段值不合法");
  return n;
}

// --- Auth ---

app.post("/auth/login", async (c) => {
  const { username, password } = await c.req.json<{ username?: string; password?: string }>().catch(() => ({} as any));
  if (!username || !password) {
    return c.json({ error: "请输入用户名和密码" }, 400);
  }

  const row = await c.env.DB
    .prepare("SELECT id, username, password_hash, display_name, role, disabled FROM users WHERE username = ?")
    .bind(username)
    .first<any>();

  if (!row || row.disabled) {
    return c.json({ error: "用户名或密码错误" }, 401);
  }

  const ok = bcrypt.compareSync(password, row.password_hash);
  if (!ok) {
    return c.json({ error: "用户名或密码错误" }, 401);
  }

  const secret = getJwtSecret(c.env);
  const expiresMs = getJwtExpiresInMs(c.env);
  const now = Date.now();
  const exp = new Date(now + expiresMs).getTime();

  const token = await sign(
    { userId: row.id, username: row.username, exp: Math.floor(exp / 1000) },
    secret,
    "HS256"
  );

  const user = await loadUserWithPermissions(c.env.DB, row.id);
  if (!user) {
    return c.json({ error: "账号状态异常" }, 500);
  }

  return c.json({
    token,
    user,
  });
});

app.post("/auth/logout", (c) => {
  return c.json({ success: true });
});

// --- 图片上传（R2）---

function randomHex(len: number): string {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

app.post("/upload-image", async (c) => {
  const user = await requirePermission(c, "edit_material");
  if (!user) return c.res;
  if (!c.env.R2_BUCKET) {
    return c.json({ success: false, error: { code: "CONFIG", message: "R2 未配置，无法上传图片" } }, 503);
  }
  const body = (await c.req.json().catch(() => ({}))) as { filename?: string; data?: string };
  const { filename, data } = body;
  if (!filename || !data) {
    return c.json({ success: false, error: { code: "VALIDATION_FAILED", message: "缺少文件名或数据" } }, 400);
  }
  const allowedExt = /\.(jpg|jpeg|png|gif|webp)$/i;
  if (!allowedExt.test(filename)) {
    return c.json({ success: false, error: { code: "VALIDATION_FAILED", message: "仅支持 JPG、PNG、GIF、WebP 格式" } }, 400);
  }
  const base64 = String(data).includes(",") ? String(data).split(",")[1] : String(data);
  const buf = base64ToArrayBuffer(base64);
  if (buf.byteLength > 5 * 1024 * 1024) {
    return c.json({ success: false, error: { code: "VALIDATION_FAILED", message: "图片不能超过 5MB" } }, 400);
  }
  const ext = (filename.match(/\.(jpg|jpeg|png|gif|webp)$/i) || ["", "jpg"])[1].toLowerCase();
  const safeName = `uploads/${randomHex(12)}.${ext === "jpeg" ? "jpg" : ext}`;
  const contentType = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" }[ext] || "image/jpeg";
  await c.env.R2_BUCKET!.put(safeName, buf, { httpMetadata: { contentType } });
  return c.json({ success: true, url: `/api/uploads/${safeName}`, size: buf.byteLength });
});

app.get("/uploads/*", async (c) => {
  const bucket = c.env.R2_BUCKET;
  if (!bucket) return c.notFound();
  const rawPath = new URL(c.req.url).pathname;
  const key = rawPath.replace(/^\/api\/uploads\//, "").replace(/^\/uploads\//, "");
  if (!key || key.includes("..")) return c.notFound();
  const obj = await bucket.get(key);
  if (!obj) return c.notFound();
  const ct = obj.httpMetadata?.contentType || "application/octet-stream";
  return new Response(obj.body, { headers: { "Content-Type": ct } });
});

app.get("/auth/me", async (c) => {
  const user = await getAuthUser(c);
  if (!user) {
    return c.json({ success: false, error: { code: "AUTH_UNAUTHORIZED", message: "未登录" } }, 401);
  }
  return c.json({ success: true, user });
});

// --- Materials ---

app.get("/materials", async (c) => {
  const user = await requireAuthUser(c);
  if (!user) return c.res;
  await ensureSchema(c.env.DB);

  const url = new URL(c.req.url);
  const page = url.searchParams.get("page");
  const pageSize = url.searchParams.get("pageSize");
  const keyword = url.searchParams.get("keyword");
  const category_id = url.searchParams.get("category_id");
  const source = url.searchParams.get("source");

  const hasQuery = page !== null || pageSize !== null || keyword || category_id !== null || source;
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
    if (category_id !== null && category_id !== undefined && String(category_id) !== "" && String(category_id) !== "null") {
      where += " AND m.category_id = ?";
      params.push(Number(category_id));
    }
    if (source !== null && source !== undefined && String(source).trim() !== "" && String(source) !== "null") {
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

    return c.json({ data: results ?? [], total: Number(totalRow?.total || 0), page: p, pageSize: ps });
  } catch (err: any) {
    return c.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: err?.message || "获取物料列表失败" } },
      500
    );
  }
});

app.get("/materials/check-code", async (c) => {
  const user = await requireAuthUser(c);
  if (!user) return c.res;
  const url = new URL(c.req.url);
  const code = url.searchParams.get("code");
  const exclude_id = url.searchParams.get("exclude_id");
  if (!code || !String(code).trim()) return c.json({ available: true });
  const c2 = String(code).trim();
  if (c2.length > 64) return c.json({ available: false, error: "编码过长" });
  const excludeId = exclude_id ? parseInt(String(exclude_id), 10) : null;
  let row: { id: number } | null = null;
  if (Number.isFinite(excludeId) && excludeId > 0) {
    row = await c.env.DB.prepare("SELECT id FROM materials WHERE code = ? AND id != ?").bind(c2, excludeId).first<{ id: number }>();
  } else {
    row = await c.env.DB.prepare("SELECT id FROM materials WHERE code = ?").bind(c2).first<{ id: number }>();
  }
  return c.json({ available: !row });
});

app.get("/materials/:id/can-delete", async (c) => {
  const user = await requireAuthUser(c);
  if (!user) return c.res;
  const id = parseInt(c.req.param("id"), 10);
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: "无效的物料ID" }, 400);
  const stockRow = await c.env.DB.prepare("SELECT COALESCE(SUM(quantity), 0) as total FROM inventory WHERE material_id = ?").bind(id).first<{ total: number }>();
  const txRow = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM transactions WHERE material_id = ?").bind(id).first<{ cnt: number }>();
  const stockTotal = Number(stockRow?.total ?? 0);
  const transactionCount = Number(txRow?.cnt ?? 0);
  const canDelete = stockTotal === 0;
  return c.json({
    canDelete,
    stockTotal,
    transactionCount,
    reason: stockTotal > 0 ? `无法删除：库存未清零（当前合计 ${stockTotal}）。请先通过出库等方式将各仓位库存清零后再删除。` : undefined,
  });
});

app.get("/materials/batch-can-delete", async (c) => {
  const user = await requireAuthUser(c);
  if (!user) return c.res;
  const url = new URL(c.req.url);
  const ids = url.searchParams.get("ids");
  if (!ids) return c.json({ error: "请提供 ids 参数，如 ids=1,2,3" }, 400);
  const idList = ids.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
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
  const user = await requirePermission(c, "edit_material");
  if (!user) return c.res;
  await ensureSchema(c.env.DB);
  const body = await c.req.json<{ code?: string; name?: string; spec?: string; unit?: string; category_id?: number; source?: string; purchase_price?: number; sale_price?: number; image_url?: string }>();
  try {
    const cleanName = cleanRequiredText(body?.name, "name", 120);
    const cleanCode = cleanOptionalText(body?.code, "code", 64);
    const cleanSpec = cleanOptionalText(body?.spec, "spec", 200);
    const cleanUnit = cleanOptionalText(body?.unit, "unit", 50);
    const cleanCategoryId = cleanOptionalPositiveInt(body?.category_id);
    const cleanSource = cleanOptionalText(body?.source, "source", 120);
    const cleanPurchase = cleanOptionalNonNegativeNumber(body?.purchase_price);
    const cleanSale = cleanOptionalNonNegativeNumber(body?.sale_price);
    const cleanImageUrl = cleanOptionalText(body?.image_url, "image_url", 300);
    const finalCode =
      cleanCode || `M-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
    const existing = await c.env.DB.prepare("SELECT id FROM materials WHERE code = ?").bind(finalCode).first<{ id: number }>();
    if (existing) throw new Error(`物料编码「${finalCode}」已存在`);
    const r = await c.env.DB.prepare(
      "INSERT INTO materials (code, name, spec, unit, category_id, image_url, source, purchase_price, sale_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(finalCode, cleanName, cleanSpec, cleanUnit, cleanCategoryId ?? null, cleanImageUrl, cleanSource, cleanPurchase, cleanSale)
      .run();
    await addOperationLog(c.env.DB, "CREATE_MATERIAL", `新增物料：${cleanName}（编码：${finalCode}）`, user.displayName || user.username, { clientIp: getClientIp(c) });
    return c.json({ id: r.meta.last_row_id });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "新增物料失败" }, 400);
  }
});

app.put("/materials/:id", async (c) => {
  const user = await requirePermission(c, "edit_material");
  if (!user) return c.res;
  const id = cleanPositiveInt(c.req.param("id"));
  const body = await c.req.json<{ code?: string; name?: string; spec?: string; unit?: string; category_id?: number; source?: string; purchase_price?: number; sale_price?: number; image_url?: string }>();
  try {
    const cleanCode = cleanRequiredText(body?.code, "code", 64);
    const cleanName = cleanRequiredText(body?.name, "name", 120);
    const cleanSpec = cleanOptionalText(body?.spec, "spec", 200);
    const cleanUnit = cleanOptionalText(body?.unit, "unit", 50);
    const cleanCategoryId = cleanOptionalPositiveInt(body?.category_id);
    const cleanSource = cleanOptionalText(body?.source, "source", 120);
    const cleanPurchase = cleanOptionalNonNegativeNumber(body?.purchase_price);
    const cleanSale = cleanOptionalNonNegativeNumber(body?.sale_price);
    const cleanImageUrl = cleanOptionalText(body?.image_url, "image_url", 300);
    const existing = await c.env.DB.prepare("SELECT id FROM materials WHERE code = ? AND id != ?").bind(cleanCode, id).first<{ id: number }>();
    if (existing) throw new Error(`物料编码「${cleanCode}」已被其他物料使用`);
    const old = await c.env.DB.prepare("SELECT code, name, spec, unit, category_id, source, purchase_price, sale_price FROM materials WHERE id = ?").bind(id).first<any>();
    await c.env.DB.prepare(
      "UPDATE materials SET code = ?, name = ?, spec = ?, unit = ?, category_id = ?, image_url = ?, source = ?, purchase_price = ?, sale_price = ? WHERE id = ?"
    )
      .bind(cleanCode, cleanName, cleanSpec, cleanUnit, cleanCategoryId ?? null, cleanImageUrl, cleanSource, cleanPurchase, cleanSale, id)
      .run();
    await addOperationLog(c.env.DB, "UPDATE_MATERIAL", `编辑物料：${cleanName}（ID：${id}）`, user.displayName || user.username, {
      oldValue: old ? JSON.stringify(old) : "",
      newValue: JSON.stringify({ code: cleanCode, name: cleanName, spec: cleanSpec, unit: cleanUnit, category_id: cleanCategoryId, source: cleanSource, purchase_price: cleanPurchase, sale_price: cleanSale }),
      clientIp: getClientIp(c),
    });
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "编辑物料失败" }, 400);
  }
});

app.delete("/materials/:id", async (c) => {
  const user = await requirePermission(c, "delete_material");
  if (!user) return c.res;
  const id = cleanPositiveInt(c.req.param("id"));
  try {
    const stockRow = await c.env.DB.prepare("SELECT COALESCE(SUM(quantity), 0) as total FROM inventory WHERE material_id = ?").bind(id).first<{ total: number }>();
    const stockTotal = Number(stockRow?.total ?? 0);
    if (stockTotal > 0) {
      return c.json({ success: false, error: { code: "HAS_STOCK", message: `无法删除：库存未清零（当前合计 ${stockTotal}）` } }, 400);
    }
    const material = await c.env.DB.prepare("SELECT name, code FROM materials WHERE id = ?").bind(id).first<{ name: string; code: string }>();
    await c.env.DB.prepare("DELETE FROM materials WHERE id = ?").bind(id).run();
    await addOperationLog(c.env.DB, "DELETE_MATERIAL", `删除物料：${material?.name ?? "未知"}（ID：${id}）`, user.displayName || user.username, { clientIp: getClientIp(c) });
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "删除物料失败" }, 400);
  }
});

app.post("/materials/batch-update", async (c) => {
  const user = await requirePermission(c, "edit_material");
  if (!user) return c.res;
  const body = await c.req.json<{ ids?: number[]; updates?: { category_id?: number | null; unit?: string; source?: string } }>();
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
      params.push(cleanOptionalText(updates.unit, "unit", 50));
    }
    if (updates.source != null) {
      setParts.push("source = ?");
      params.push(cleanOptionalText(updates.source, "source", 120));
    }
    if (setParts.length === 0) return c.json({ error: "updates 至少需要 category_id、unit 或 source 之一" }, 400);
    const ph = body.ids.map(() => "?").join(",");
    await c.env.DB.prepare(`UPDATE materials SET ${setParts.join(", ")} WHERE id IN (${ph})`).bind(...params, ...body.ids).run();
    await addOperationLog(c.env.DB, "BATCH_UPDATE_MATERIAL", `批量更新物料：${body.ids.length} 个`, user.displayName || user.username, { clientIp: getClientIp(c) });
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "批量更新物料失败" }, 400);
  }
});

app.post("/materials/batch-delete", async (c) => {
  const user = await requirePermission(c, "delete_material");
  if (!user) return c.res;
  const body = await c.req.json<{ ids?: number[] }>();
  if (!Array.isArray(body?.ids) || body.ids.length === 0) return c.json({ success: false, error: { code: "VALIDATION_FAILED", message: "请提供要删除的物料ID列表" } }, 400);
  try {
    const ph = body.ids.map(() => "?").join(",");
    const { results } = await c.env.DB.prepare(
      `SELECT material_id as id, COALESCE(SUM(quantity), 0) as stock_total FROM inventory WHERE material_id IN (${ph}) GROUP BY material_id HAVING SUM(quantity) > 0`
    )
      .bind(...body.ids)
      .all<{ id: number; stock_total: number }>();
    if ((results ?? []).length > 0) {
      const detail = (results ?? []).map((r) => `ID ${r.id} 库存 ${r.stock_total}`).join("；");
      return c.json({ success: false, error: { code: "HAS_STOCK", message: `无法批量删除：存在未清零库存的物料（${detail}）` } }, 400);
    }
    const { results: mats } = await c.env.DB.prepare(`SELECT id, name, code FROM materials WHERE id IN (${ph})`).bind(...body.ids).all<any>();
    await c.env.DB.prepare(`DELETE FROM materials WHERE id IN (${ph})`).bind(...body.ids).run();
    await addOperationLog(c.env.DB, "BATCH_DELETE_MATERIAL", `批量删除物料：${body.ids.length} 个`, user.displayName || user.username, { clientIp: getClientIp(c) });
    return c.json({ success: true, deletedCount: body.ids.length, deletedMaterials: mats ?? [] });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "批量删除物料失败" }, 400);
  }
});

app.post("/materials/batch-import", async (c) => {
  const user = await requirePermission(c, "edit_material");
  if (!user) return c.res;
  const body = await c.req.json<{ materials?: any[] }>();
  if (!Array.isArray(body?.materials) || body.materials.length === 0) return c.json({ success: false, error: { code: "VALIDATION_FAILED", message: "请提供要导入的物料列表" } }, 400);
  let successCount = 0;
  const failedItems: { item: any; error: string }[] = [];
  for (const item of body.materials) {
    try {
      const cleanName = cleanRequiredText(item?.name, "name", 120);
      const cleanCode = cleanOptionalText(item?.code, "code", 64);
      const cleanSpec = cleanOptionalText(item?.spec, "spec", 200);
      const cleanUnit = cleanOptionalText(item?.unit, "unit", 50);
      const cleanCategoryId = cleanOptionalPositiveInt(item?.category_id);
      const cleanSource = cleanOptionalText(item?.source, "source", 120);
      const cleanPurchase = cleanOptionalNonNegativeNumber(item?.purchase_price);
      const cleanSale = cleanOptionalNonNegativeNumber(item?.sale_price);
      const cleanImageUrl = cleanOptionalText(item?.image_url, "image_url", 300);
      const finalCode = cleanCode || `M-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
      const existsCode = await c.env.DB.prepare("SELECT id FROM materials WHERE code = ?").bind(finalCode).first<{ id: number }>();
      if (existsCode) throw new Error(`编码「${finalCode}」已存在`);
      await c.env.DB.prepare(
        "INSERT INTO materials (code, name, spec, unit, category_id, image_url, source, purchase_price, sale_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(finalCode, cleanName, cleanSpec, cleanUnit, cleanCategoryId ?? null, cleanImageUrl, cleanSource, cleanPurchase, cleanSale)
        .run();
      successCount++;
    } catch (err: any) {
      failedItems.push({ item, error: err?.message ?? "未知错误" });
    }
  }
  await addOperationLog(c.env.DB, "BATCH_IMPORT_MATERIAL", `批量导入物料：成功 ${successCount} 个，失败 ${failedItems.length} 个`, user.displayName || user.username, { clientIp: getClientIp(c) });
  return c.json({ success: true, successCount, failedCount: failedItems.length, failedItems });
});

// --- Inventory ---

app.get("/inventory", async (c) => {
  const user = await requireAuthUser(c);
  if (!user) return c.res;
  await ensureSchema(c.env.DB);
  const result = await c.env.DB.prepare(
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
  ).all<InventoryRow>();

  return c.json(result.results ?? []);
});

app.get("/inventory/alert", async (c) => {
  const user = await requireAuthUser(c);
  if (!user) return c.res;
  const result = await c.env.DB.prepare(
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
  ).all();
  return c.json(result.results ?? []);
});

app.get("/inventory/stock", async (c) => {
  const user = await requireAuthUser(c);
  if (!user) return c.res;
  const url = new URL(c.req.url);
  const material_id = url.searchParams.get("material_id");
  const location_id = url.searchParams.get("location_id");
  if (!material_id || !location_id) return c.json({ success: false, error: { code: "VALIDATION_FAILED", message: "需要 material_id 和 location_id" } }, 400);
  const row = await c.env.DB.prepare("SELECT quantity FROM inventory WHERE material_id = ? AND location_id = ?")
    .bind(Number(material_id), Number(location_id))
    .first<{ quantity: number }>();
  return c.json({ success: true, data: { quantity: row?.quantity ?? 0 } });
});

app.put("/inventory/:materialId/:locationId", async (c) => {
  const user = await requirePermission(c, "inventory_alert_edit");
  if (!user) return c.res;
  const materialId = cleanPositiveInt(c.req.param("materialId"));
  const locationId = cleanPositiveInt(c.req.param("locationId"));
  const body = await c.req.json<{ min_stock?: number; max_stock?: number }>();
  const minV = cleanOptionalNonNegativeNumber(body?.min_stock) ?? 0;
  const maxV = cleanOptionalNonNegativeNumber(body?.max_stock) ?? 0;
  try {
    await c.env.DB.prepare("UPDATE inventory SET min_stock = ?, max_stock = ? WHERE material_id = ? AND location_id = ?")
      .bind(minV, maxV, materialId, locationId)
      .run();
    const material = await c.env.DB.prepare("SELECT name, code FROM materials WHERE id = ?").bind(materialId).first<any>();
    const location = await c.env.DB.prepare("SELECT name FROM locations WHERE id = ?").bind(locationId).first<any>();
    await addOperationLog(c.env.DB, "UPDATE_INVENTORY_ALERT", `更新库存预警：物料【${material?.name ?? "未知"}】，库位【${location?.name ?? "未知"}】`, user.displayName || user.username, { clientIp: getClientIp(c) });
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "更新库存预警阈值失败" }, 400);
  }
});

// --- Transactions (Inbound / Outbound) ---

app.get("/transactions", async (c) => {
  const user = await requireAuthUser(c);
  if (!user) return c.res;
  await ensureSchema(c.env.DB);
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
  if (type && (type === "IN" || type === "OUT")) {
    sql += " AND t.type = ?";
    params.push(type);
  }
  if (material_id) {
    sql += " AND t.material_id = ?";
    params.push(Number(material_id));
  }
  if (location_id) {
    sql += " AND t.location_id = ?";
    params.push(Number(location_id));
  }
  if (start_date) {
    sql += " AND t.timestamp >= ?";
    params.push(String(start_date));
  }
  if (end_date) {
    sql += " AND t.timestamp <= ?";
    params.push(String(end_date) + " 23:59:59");
  }
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

app.post("/transactions", async (c) => {
  const user = await requireAuthUser(c);
  if (!user) return c.res;
  await ensureSchema(c.env.DB);
  const body = await c.req.json<any>();
  const items: any[] = Array.isArray(body?.items) ? body.items : [body];
  if (items.length === 0) return c.json({ error: "请提供至少一条出入库记录" }, 400);
  const needInbound = items.some((it) => it?.type === "IN");
  const needOutbound = items.some((it) => it?.type === "OUT");
  const perms = user.permissions || [];
  const allowAll = perms.includes("*");
  if (!allowAll) {
    if (needInbound && !hasPermission(perms, "inbound")) return c.json({ error: "您没有执行入库的权限" }, 403);
    if (needOutbound && !hasPermission(perms, "outbound")) return c.json({ error: "您没有执行出库的权限" }, 403);
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

      const current = await c.env.DB.prepare("SELECT quantity FROM inventory WHERE material_id = ? AND location_id = ?").bind(material_id, location_id).first<{ quantity: number }>();
      if (type === "OUT") {
        const avail = current?.quantity ?? 0;
        if (avail < quantity) throw new Error(`库存不足：当前可用 ${avail}，需要 ${quantity}`);
      }

      const insertResult = await c.env.DB.prepare("INSERT INTO transactions (type, material_id, location_id, quantity, operator_id, department_id, recipient_id, partner_id, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(type, material_id, location_id, quantity, operator_id ?? null, department_id ?? null, recipient_id ?? null, partner_id ?? null, note ?? null)
        .run();
      const txId = insertResult.meta.last_row_id;
      if (txId) ids.push(Number(txId));
      if (type === "IN") {
        await c.env.DB.prepare("INSERT INTO inventory (material_id, location_id, quantity) VALUES (?, ?, ?) ON CONFLICT(material_id, location_id) DO UPDATE SET quantity = quantity + excluded.quantity")
          .bind(material_id, location_id, quantity)
          .run();
      } else {
        await c.env.DB.prepare("UPDATE inventory SET quantity = quantity - ? WHERE material_id = ? AND location_id = ?")
          .bind(quantity, material_id, location_id)
          .run();
      }
      const material = await c.env.DB.prepare("SELECT name FROM materials WHERE id = ?").bind(material_id).first<any>();
      const location = await c.env.DB.prepare("SELECT name FROM locations WHERE id = ?").bind(location_id).first<any>();
      const operator = operator_id ? (await c.env.DB.prepare("SELECT name FROM staff WHERE id = ?").bind(operator_id).first<any>()) : null;
      await addOperationLog(c.env.DB, type === "IN" ? "INBOUND" : "OUTBOUND", `${type === "IN" ? "入库" : "出库"}：物料【${material?.name ?? "未知"}】，库位【${location?.name ?? "未知"}】，数量：${quantity}`, operator?.name || user.displayName || user.username, { clientIp: getClientIp(c) });
    }
    return c.json({ success: true, ids: ids.length === 1 ? ids[0] : ids });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "操作失败" }, 400);
  }
});

app.post("/transactions/:id/undo", async (c) => {
  const user = await requireAuthUser(c);
  if (!user) return c.res;
  const id = c.req.param("id");
  try {
    const row = await c.env.DB.prepare("SELECT * FROM transactions WHERE id = ? AND (reverted IS NULL OR reverted = 0)").bind(id).first<any>();
    if (!row) return c.json({ error: "记录不存在或已撤销" }, 404);
    const perms = user.permissions || [];
    const allowAll = perms.includes("*");
    if (!allowAll) {
      if (row.type === "IN" && !hasPermission(perms, "inbound")) return c.json({ error: "您没有执行入库的权限" }, 403);
      if (row.type === "OUT" && !hasPermission(perms, "outbound")) return c.json({ error: "您没有执行出库的权限" }, 403);
    }
    const diff = Date.now() - new Date(row.timestamp).getTime();
    if (diff > 5 * 60 * 1000) return c.json({ error: "该记录已超过 5 分钟，无法撤销" }, 400);
    const reverseType = row.type === "IN" ? "OUT" : "IN";

    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE transactions SET reverted = 1 WHERE id = ?").bind(id),
      c.env.DB.prepare("INSERT INTO transactions (type, material_id, location_id, quantity, operator_id, department_id, recipient_id, partner_id, note, revert_transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(reverseType, row.material_id, row.location_id, row.quantity, row.operator_id, row.department_id, row.recipient_id, row.partner_id ?? null, `撤销原记录#${id}`, id),
    ]);
    const revRow = await c.env.DB.prepare("SELECT id FROM transactions ORDER BY id DESC LIMIT 1").first<{ id: number }>();
    if (revRow?.id) await c.env.DB.prepare("UPDATE transactions SET revert_transaction_id = ? WHERE id = ?").bind(revRow.id, id).run();
    if (reverseType === "IN") {
      const cur = await c.env.DB.prepare("SELECT quantity FROM inventory WHERE material_id = ? AND location_id = ?").bind(row.material_id, row.location_id).first<any>();
      if (cur) {
        await c.env.DB.prepare("UPDATE inventory SET quantity = quantity + ? WHERE material_id = ? AND location_id = ?").bind(row.quantity, row.material_id, row.location_id).run();
      } else {
        await c.env.DB.prepare("INSERT INTO inventory (material_id, location_id, quantity) VALUES (?, ?, ?)").bind(row.material_id, row.location_id, row.quantity).run();
      }
    } else {
      await c.env.DB.prepare("UPDATE inventory SET quantity = quantity - ? WHERE material_id = ? AND location_id = ?").bind(row.quantity, row.material_id, row.location_id).run();
    }
    const material = await c.env.DB.prepare("SELECT name FROM materials WHERE id = ?").bind(row.material_id).first<any>();
    await addOperationLog(c.env.DB, "REVERT_TRANSACTION", `撤销${row.type === "IN" ? "入库" : "出库"}记录#${id}：${material?.name ?? "未知"}`, user.displayName || user.username, { clientIp: getClientIp(c) });
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "撤销失败" }, 400);
  }
});

// --- Settings / Base Data ---

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

app.get("/settings/:type", async (c) => {
  const user = await requireAuthUser(c);
  if (!user) return c.res;
  await ensureSchema(c.env.DB);
  const type = c.req.param("type");
  const table = SETTINGS_TABLES[type];
  if (!table) return c.json({ error: "无效的类型" }, 404);
  const { results } = await c.env.DB.prepare(`SELECT * FROM ${table} ORDER BY id ASC`).all<BaseDataRow>();
  return c.json(results ?? []);
});

async function existsName(db: D1Database, table: string, name: string, excludeId?: number | null): Promise<boolean> {
  let sql = `SELECT id FROM ${table} WHERE lower(name) = lower(?)`;
  const params: any[] = [name];
  if (excludeId != null) {
    sql += " AND id != ?";
    params.push(excludeId);
  }
  const row = await db.prepare(sql).bind(...params).first<{ id: number }>();
  return !!row;
}

app.post("/settings/:type", async (c) => {
  const user = await requirePermission(c, "edit_settings");
  if (!user) return c.res;
  await ensureSchema(c.env.DB);
  const type = c.req.param("type");
  const body = await c.req.json<{ name?: string; role?: string; parent_id?: number; description?: string; invoice_info?: string; contact?: string; mailing_address?: string }>();
  const name = String(body?.name ?? "").trim();
  if (!name || name.length > 50) return c.json({ error: "名称不能为空或过长" }, 400);
  const op = user.displayName || user.username;
  const ip = getClientIp(c);
  try {
    let lastId: number | null = null;
    if (type === "locations") {
      if (await existsName(c.env.DB, "locations", name)) throw new Error("名称已存在");
      const r = await c.env.DB.prepare("INSERT INTO locations (name) VALUES (?)").bind(name).run();
      lastId = r.meta.last_row_id;
      await addOperationLog(c.env.DB, "CREATE_LOCATION", `新增存放位置：${name}`, op, { clientIp: ip });
    } else if (type === "units") {
      if (await existsName(c.env.DB, "units", name)) throw new Error("名称已存在");
      const r = await c.env.DB.prepare("INSERT INTO units (name) VALUES (?)").bind(name).run();
      lastId = r.meta.last_row_id;
      await addOperationLog(c.env.DB, "CREATE_UNIT", `新增计量单位：${name}`, op, { clientIp: ip });
    } else if (type === "staff") {
      const role = body.role ? String(body.role).trim() : null;
      if (await existsName(c.env.DB, "staff", name)) throw new Error("人员已存在");
      const r = await c.env.DB.prepare("INSERT INTO staff (name, role) VALUES (?, ?)").bind(name, role).run();
      lastId = r.meta.last_row_id;
      await addOperationLog(c.env.DB, "CREATE_STAFF", `新增人员：${name}`, op, { clientIp: ip });
    } else if (type === "departments") {
      if (await existsName(c.env.DB, "departments", name)) throw new Error("名称已存在");
      const r = await c.env.DB.prepare("INSERT INTO departments (name) VALUES (?)").bind(name).run();
      lastId = r.meta.last_row_id;
      await addOperationLog(c.env.DB, "CREATE_DEPARTMENT", `新增领料部门：${name}`, op, { clientIp: ip });
    } else if (type === "reasons") {
      if (await existsName(c.env.DB, "usage_reasons", name)) throw new Error("名称已存在");
      const r = await c.env.DB.prepare("INSERT INTO usage_reasons (name) VALUES (?)").bind(name).run();
      lastId = r.meta.last_row_id;
      await addOperationLog(c.env.DB, "CREATE_REASON", `新增出库事由：${name}`, op, { clientIp: ip });
    } else if (type === "sources") {
      if (await existsName(c.env.DB, "material_sources", name)) throw new Error("名称已存在");
      const r = await c.env.DB.prepare("INSERT INTO material_sources (name) VALUES (?)").bind(name).run();
      lastId = r.meta.last_row_id;
      await addOperationLog(c.env.DB, "CREATE_SOURCE", `新增物料来源：${name}`, op, { clientIp: ip });
    } else if (type === "categories") {
      const parent_id = body.parent_id ? Number(body.parent_id) : null;
      const description = body.description ? String(body.description).trim().slice(0, 500) : null;
      if (await existsName(c.env.DB, "material_categories", name)) throw new Error("同级分类名称已存在");
      const r = await c.env.DB.prepare("INSERT INTO material_categories (name, parent_id, description) VALUES (?, ?, ?)").bind(name, parent_id, description).run();
      lastId = r.meta.last_row_id;
      await addOperationLog(c.env.DB, "CREATE_CATEGORY", `新增物料分类：${name}`, op, { clientIp: ip });
    } else if (type === "partners") {
      if (await existsName(c.env.DB, "partners", name)) throw new Error("公司名称已存在");
      const inv = body.invoice_info ? String(body.invoice_info).trim().slice(0, 500) : null;
      const contact = body.contact ? String(body.contact).trim().slice(0, 200) : null;
      const addr = body.mailing_address ? String(body.mailing_address).trim().slice(0, 500) : null;
      const r = await c.env.DB.prepare("INSERT INTO partners (name, invoice_info, contact, mailing_address) VALUES (?, ?, ?, ?)").bind(name, inv, contact, addr).run();
      lastId = r.meta.last_row_id;
      await addOperationLog(c.env.DB, "CREATE_PARTNER", `新增往来单位：${name}`, op, { clientIp: ip });
    } else {
      return c.json({ error: "无效的类型" }, 404);
    }
    return c.json({ success: true, id: lastId });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "新增失败" }, 400);
  }
});

app.put("/settings/:type/:id", async (c) => {
  const user = await requirePermission(c, "edit_settings");
  if (!user) return c.res;
  const type = c.req.param("type");
  const id = c.req.param("id");
  const body = await c.req.json<{ name?: string; role?: string; parent_id?: number; description?: string; invoice_info?: string; contact?: string; mailing_address?: string }>();
  const name = String(body?.name ?? "").trim();
  if (!name || name.length > 50) return c.json({ error: "名称不能为空或过长" }, 400);
  const op = user.displayName || user.username;
  const ip = getClientIp(c);
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
  } catch (err: any) {
    return c.json({ error: err?.message ?? "编辑失败" }, 400);
  }
});

app.delete("/settings/:type/:id", async (c) => {
  const user = await requirePermission(c, "delete_settings");
  if (!user) return c.res;
  const type = c.req.param("type");
  const id = c.req.param("id");
  const table = SETTINGS_TABLES[type];
  if (!table) return c.json({ error: "无效的类型" }, 404);
  const op = user.displayName || user.username;
  const ip = getClientIp(c);
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
  } catch (err: any) {
    return c.json({ error: err?.message ?? "删除失败" }, 400);
  }
});

// --- Reports ---

app.get("/reports/:type", async (c) => {
  const user = await requirePermission(c, "view_reports");
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
        `).bind(start, end, start, end, start, end).all<any>();
        const data = (turnoverData ?? []).map((item: any) => {
          const avg = (item.ending_stock || 0) / 2;
          return {
            id: item.id, code: item.code, name: item.name,
            beginning_stock: (item.ending_stock || 0) - (item.inbound || 0) + (item.outbound || 0),
            ending_stock: item.ending_stock || 0,
            outbound: item.outbound || 0,
            turnover_rate: avg > 0 ? (item.outbound || 0) / avg : 0,
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
        `).bind(start, end).all<any>();
        const data = (results ?? []).map((r: any) => ({
          id: r.date, date: r.date,
          inbound: r.inbound || 0, outbound: r.outbound || 0,
          net_change: (r.inbound || 0) - (r.outbound || 0),
        }));
        const totalIn = data.reduce((s: number, r: any) => s + r.inbound, 0);
        const totalOut = data.reduce((s: number, r: any) => s + r.outbound, 0);
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
        `).bind(start, end).all<any>();
        const data = (results ?? []).map((r: any, i: number) => ({
          id: i + 1, partner_name: r.partner_name,
          inbound: r.inbound || 0, outbound: r.outbound || 0,
          net_change: (r.inbound || 0) - (r.outbound || 0),
        }));
        return c.json({ data, summary: { 往来单位数: data.length } });
      }
      case "material-analysis": {
        const { results } = await c.env.DB.prepare(`
          SELECT m.id, m.code, m.name, SUM(t.quantity) as usage
          FROM transactions t JOIN materials m ON t.material_id = m.id
          WHERE t.type = 'OUT' AND (t.reverted IS NULL OR t.reverted = 0) AND t.timestamp BETWEEN ? AND ?
          GROUP BY m.id ORDER BY usage DESC
        `).bind(start, end).all<any>();
        const totalUsage = (results ?? []).reduce((s: number, r: any) => s + (r.usage || 0), 0);
        const data = (results ?? []).map((r: any) => ({
          id: r.id, code: r.code, name: r.name,
          usage: r.usage || 0,
          percentage: totalUsage > 0 ? (r.usage || 0) / totalUsage : 0,
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
        `).all<any>();
        const data = results ?? [];
        const totalVal = data.reduce((s: number, r: any) => s + (r.value || 0), 0);
        return c.json({ data, summary: { 库存物料数: data.length, 总库存价值: totalVal.toFixed(2) } });
      }
      default:
        return c.json({ error: "无效的报表类型" }, 404);
    }
  } catch (err: any) {
    return c.json({ error: err?.message ?? "生成报表失败" }, 500);
  }
});

// --- IP 归属地 ---

function isPrivateIp(ip: string): boolean {
  if (!ip || ip === "未知") return true;
  if (ip.startsWith("127.") || ip === "::1") return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.") || ip.startsWith("172.16.") || ip.startsWith("172.17.") || ip.startsWith("172.18.") || ip.startsWith("172.19.") || ip.startsWith("172.2") || ip.startsWith("172.30.") || ip.startsWith("172.31.")) return true;
  return false;
}

app.get("/ip-geo", async (c) => {
  const user = await requireAuthUser(c);
  if (!user) return c.res;
  const ip = c.req.query("ip") || "";
  if (!ip.trim() || isPrivateIp(ip)) return c.json({ ip, location: null });
  try {
    const url = `http://ip-api.com/json/${encodeURIComponent(ip.trim())}?fields=status,country,regionName,city&lang=zh-CN`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const data = (await res.json()) as { status?: string; country?: string; regionName?: string; city?: string };
    if (data?.status !== "success") return c.json({ ip, location: null });
    const parts = [data.country, data.regionName, data.city].filter(Boolean);
    const location = parts.length ? parts.join(" ") : null;
    return c.json({ ip, location });
  } catch {
    return c.json({ ip, location: null });
  }
});

// --- Operation Logs ---

app.get("/operation-logs", async (c) => {
  const user = await requireAuthUser(c);
  if (!user) return c.res;
  const url = new URL(c.req.url);
  const { action, actions, operator, keyword, start_date, end_date, limit, page, pageSize } = Object.fromEntries(url.searchParams);
  let sql = "SELECT id, action, description, operator, old_value, new_value, client_ip, created_at FROM operation_logs WHERE 1=1";
  const params: any[] = [];
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

// --- Export (CSV) ---

function escapeCsv(val: any): string {
  return `"${String(val ?? "").replace(/"/g, '""')}"`;
}

app.get("/export/materials", async (c) => {
  const user = await requirePermission(c, "export_materials");
  if (!user) return c.res;
  const { results } = await c.env.DB.prepare(`SELECT m.*, c.name as category_name FROM materials m LEFT JOIN material_categories c ON m.category_id = c.id ORDER BY m.created_at DESC`).all<any>();
  const rows = results ?? [];
  const headers = ["ID", "物料编码", "物料名称", "规格型号", "单位", "分类", "来源", "购价", "售价", "图片URL", "创建时间"];
  const lines = [headers.join(","), ...rows.map((m: any) => [m.id, m.code || "", m.name, m.spec || "", m.unit || "", m.category_name || "", m.source || "", m.purchase_price ?? "", m.sale_price ?? "", m.image_url || "", m.created_at || ""].map(escapeCsv).join(","))];
  const csv = "\uFEFF" + lines.join("\n");
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=materials_${Date.now()}.csv` },
  });
});

app.get("/export/inventory", async (c) => {
  const user = await requirePermission(c, "export_inventory");
  if (!user) return c.res;
  const { results } = await c.env.DB.prepare(`
    SELECT m.code, m.name, m.spec, m.unit, l.name as location_name, i.quantity, i.min_stock, i.max_stock
    FROM inventory i JOIN materials m ON i.material_id = m.id JOIN locations l ON i.location_id = l.id ORDER BY l.name, m.code
  `).all<any>();
  const rows = results ?? [];
  const headers = ["库位", "物料编码", "物料名称", "规格型号", "单位", "数量", "最小库存", "最大库存"];
  const lines = [headers.join(","), ...rows.map((r: any) => [r.location_name || "", r.code || "", r.name || "", r.spec || "", r.unit || "", r.quantity ?? 0, r.min_stock ?? 0, r.max_stock ?? 0].map(escapeCsv).join(","))];
  const csv = "\uFEFF" + lines.join("\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=inventory_${Date.now()}.csv` } });
});

app.get("/export/transactions", async (c) => {
  const user = await requirePermission(c, "export_transactions");
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
  const params: any[] = [];
  if (type && (type === "IN" || type === "OUT")) { sql += " AND t.type = ?"; params.push(type); }
  if (start_date) { sql += " AND t.timestamp >= ?"; params.push(String(start_date)); }
  if (end_date) { sql += " AND t.timestamp <= ?"; params.push(String(end_date) + " 23:59:59"); }
  sql += " ORDER BY t.timestamp DESC LIMIT 5000";
  const { results } = await c.env.DB.prepare(sql).bind(...params).all<any>();
  const rows = results ?? [];
  const headers = ["ID", "时间", "类型", "物料编码", "物料名称", "库位", "往来单位", "数量", "经办人", "部门", "领用人", "备注"];
  const lines = [headers.join(","), ...rows.map((r: any) => [r.id, r.timestamp, r.type === "IN" ? "入库" : "出库", r.material_code, r.material_name, r.location_name, r.partner_name || "", r.quantity, r.operator_name || "", r.department_name || "", r.recipient_name || "", (r.note || "").replace(/,/g, "，")].map(escapeCsv).join(","))];
  const csv = "\uFEFF" + lines.join("\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=transactions_${Date.now()}.csv` } });
});

app.get("/export/operation-logs", async (c) => {
  const user = await requirePermission(c, "export_operation_logs");
  if (!user) return c.res;
  const url = new URL(c.req.url);
  const { action, actions, operator, keyword, start_date, end_date } = Object.fromEntries(url.searchParams);
  let sql = "SELECT * FROM operation_logs WHERE 1=1";
  const params: any[] = [];
  if (action) { sql += " AND action LIKE ?"; params.push("%" + String(action) + "%"); }
  if (actions) { const list = String(actions).split(",").map((s) => s.trim()).filter(Boolean); if (list.length) { sql += ` AND action IN (${list.map(() => "?").join(",")})`; params.push(...list); } }
  if (operator) { sql += " AND operator LIKE ?"; params.push("%" + String(operator) + "%"); }
  if (keyword) { const k = "%" + String(keyword) + "%"; sql += " AND (description LIKE ? OR old_value LIKE ? OR new_value LIKE ?)"; params.push(k, k, k); }
  if (start_date) { sql += " AND created_at >= ?"; params.push(String(start_date)); }
  if (end_date) { sql += " AND created_at <= ?"; params.push(String(end_date) + " 23:59:59"); }
  sql += " ORDER BY created_at DESC LIMIT 2000";
  const { results } = await c.env.DB.prepare(sql).bind(...params).all<any>();
  const rows = results ?? [];
  const headers = ["ID", "时间", "操作类型", "描述", "操作人", "客户端IP", "旧值", "新值"];
  const lines = [headers.join(","), ...rows.map((r: any) => [r.id, r.created_at, r.action, (r.description || "").replace(/,/g, "，"), r.operator || "", r.client_ip || "", (r.old_value || "").replace(/,/g, "，"), (r.new_value || "").replace(/,/g, "，")].map(escapeCsv).join(","))];
  const csv = "\uFEFF" + lines.join("\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=operation_logs_${Date.now()}.csv` } });
});

app.get("/export/report/:type", async (c) => {
  const user = await requirePermission(c, "export");
  if (!user) return c.res;
  const type = c.req.param("type");
  const url = new URL(c.req.url);
  const start_date = url.searchParams.get("start_date");
  const end_date = url.searchParams.get("end_date");
  if (!start_date || !end_date) return c.json({ error: "请提供开始日期和结束日期" }, 400);
  const start = String(start_date);
  const end = String(end_date) + " 23:59:59";
  let rows: any[] = [];
  let headers: string[] = [];
  try {
    if (type === "inventory-turnover") {
      const { results } = await c.env.DB.prepare(`
        SELECT m.code, m.name, COALESCE((SELECT SUM(quantity) FROM inventory WHERE material_id = m.id), 0) as ending_stock,
          COALESCE((SELECT SUM(quantity) FROM transactions WHERE material_id = m.id AND type = 'IN' AND (reverted IS NULL OR reverted = 0) AND timestamp BETWEEN ? AND ?), 0) as inbound,
          COALESCE((SELECT SUM(quantity) FROM transactions WHERE material_id = m.id AND type = 'OUT' AND (reverted IS NULL OR reverted = 0) AND timestamp BETWEEN ? AND ?), 0) as outbound
        FROM materials m WHERE m.id IN (SELECT material_id FROM transactions WHERE timestamp BETWEEN ? AND ?) ORDER BY m.code
      `).bind(start, end, start, end, start, end).all<any>();
      const data = results ?? [];
      rows = data.map((r: any) => {
        const avg = (r.ending_stock || 0) / 2;
        return { code: r.code, name: r.name, beginning_stock: (r.ending_stock || 0) - (r.inbound || 0) + (r.outbound || 0), ending_stock: r.ending_stock || 0, outbound: r.outbound || 0, turnover_rate: avg > 0 ? (r.outbound || 0) / avg : 0 };
      });
      headers = ["物料编码", "物料名称", "期初库存", "期末库存", "本期出库", "周转率"];
    } else if (type === "inout-stats") {
      const { results } = await c.env.DB.prepare(`SELECT DATE(timestamp) as date, SUM(CASE WHEN type = 'IN' AND (reverted IS NULL OR reverted = 0) THEN quantity ELSE 0 END) as inbound, SUM(CASE WHEN type = 'OUT' AND (reverted IS NULL OR reverted = 0) THEN quantity ELSE 0 END) as outbound FROM transactions WHERE timestamp BETWEEN ? AND ? GROUP BY DATE(timestamp) ORDER BY date`).bind(start, end).all<any>();
      rows = (results ?? []).map((r: any) => ({ date: r.date, inbound: r.inbound || 0, outbound: r.outbound || 0, net_change: (r.inbound || 0) - (r.outbound || 0) }));
      headers = ["日期", "入库数量", "出库数量", "净变化"];
    } else if (type === "partner-inout-stats") {
      const { results } = await c.env.DB.prepare(`SELECT COALESCE(p.name, '未填写') as partner_name, SUM(CASE WHEN t.type = 'IN' AND (t.reverted IS NULL OR t.reverted = 0) THEN t.quantity ELSE 0 END) as inbound, SUM(CASE WHEN t.type = 'OUT' AND (t.reverted IS NULL OR t.reverted = 0) THEN t.quantity ELSE 0 END) as outbound FROM transactions t LEFT JOIN partners p ON t.partner_id = p.id WHERE t.timestamp BETWEEN ? AND ? GROUP BY COALESCE(p.name, '未填写') ORDER BY (inbound+outbound) DESC`).bind(start, end).all<any>();
      rows = (results ?? []).map((r: any) => ({ partner_name: r.partner_name, inbound: r.inbound || 0, outbound: r.outbound || 0, net_change: (r.inbound || 0) - (r.outbound || 0) }));
      headers = ["往来单位", "入库数量", "出库数量", "净变化"];
    } else if (type === "material-analysis") {
      const { results } = await c.env.DB.prepare(`SELECT m.code, m.name, SUM(t.quantity) as usage FROM transactions t JOIN materials m ON t.material_id = m.id WHERE t.type = 'OUT' AND (t.reverted IS NULL OR t.reverted = 0) AND t.timestamp BETWEEN ? AND ? GROUP BY m.id ORDER BY usage DESC`).bind(start, end).all<any>();
      const total = (results ?? []).reduce((s: number, r: any) => s + (r.usage || 0), 0);
      rows = (results ?? []).map((r: any) => ({ code: r.code, name: r.name, usage: r.usage || 0, percentage: total > 0 ? (r.usage || 0) / total : 0 }));
      headers = ["物料编码", "物料名称", "使用数量", "占比"];
    } else if (type === "inventory-value") {
      const { results } = await c.env.DB.prepare(`SELECT m.code, m.name, SUM(i.quantity) as quantity, COALESCE(m.purchase_price, 0) as unit_price, COALESCE(m.purchase_price, 0) * SUM(i.quantity) as value FROM inventory i JOIN materials m ON i.material_id = m.id WHERE i.quantity > 0 GROUP BY m.id ORDER BY value DESC`).all<any>();
      rows = (results ?? []).map((r: any) => ({ code: r.code, name: r.name, quantity: r.quantity || 0, unit_price: r.unit_price || 0, value: r.value || 0 }));
      headers = ["物料编码", "物料名称", "库存数量", "单价", "库存价值"];
    } else {
      return c.json({ error: "无效的报表类型" }, 404);
    }
    const headerToKey: Record<string, string> = { "物料编码": "code", "物料名称": "name", "期初库存": "beginning_stock", "期末库存": "ending_stock", "本期出库": "outbound", "周转率": "turnover_rate", "日期": "date", "入库数量": "inbound", "出库数量": "outbound", "净变化": "net_change", "往来单位": "partner_name", "使用数量": "usage", "占比": "percentage", "库存数量": "quantity", "单价": "unit_price", "库存价值": "value" };
    const lines = [headers.join(","), ...rows.map((r: any) => headers.map((h) => escapeCsv(r[headerToKey[h] || h] ?? "")).join(","))];
    const csv = "\uFEFF" + lines.join("\n");
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=report_${type}_${Date.now()}.csv` } });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "导出报表失败" }, 500);
  }
});

app.get("/backup", async (c) => {
  const user = await requirePermission(c, "backup_db");
  if (!user) return c.res;
  const esc = (v: any): string => {
    if (v == null) return "NULL";
    const s = String(v).replace(/'/g, "''");
    return `'${s}'`;
  };
  const tables = [
    "materials", "locations", "units", "staff", "departments", "usage_reasons",
    "material_sources", "material_categories", "partners", "inventory", "transactions",
    "operation_logs", "users", "role_permissions"
  ];
  const lines: string[] = ["-- SmartWMS D1 数据备份", `-- 导出时间: ${new Date().toISOString()}`, ""];
  for (const table of tables) {
    try {
      const { results } = await c.env.DB.prepare(`SELECT * FROM ${table}`).all<any[]>();
      const rows = results ?? [];
      if (rows.length === 0) continue;
      const cols = Object.keys(rows[0]);
      for (const row of rows) {
        const vals = cols.map((col) => esc(row[col]));
        lines.push(`INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${vals.join(", ")});`);
      }
      lines.push("");
    } catch {
      // 表不存在则跳过
    }
  }
  const sql = lines.join("\n");
  const filename = `wms_backup_${new Date().toISOString().slice(0, 10)}_${Date.now()}.sql`;
  return new Response(sql, {
    headers: {
      "Content-Type": "application/sql; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

// --- Users ---

const ALLOWED_ROLES = ["admin", "warehouse_keeper", "readonly", "reporter"] as const;

function hashPassword(pwd: string): string {
  return bcrypt.hashSync(pwd, 10);
}

app.get("/users", async (c) => {
  const user = await requirePermission(c, "manage_accounts");
  if (!user) return c.res;
  const { results } = await c.env.DB.prepare("SELECT id, username, display_name, role, disabled, created_at FROM users ORDER BY created_at DESC, id DESC").all<any>();
  return c.json(results ?? []);
});

app.post("/users", async (c) => {
  const user = await requirePermission(c, "manage_accounts");
  if (!user) return c.res;
  const body = await c.req.json<{ username?: string; password?: string; display_name?: string; role?: string }>();
  const username = String(body?.username ?? "").trim();
  if (!username || !/^[a-zA-Z0-9_]{3,32}$/.test(username)) return c.json({ error: "用户名格式不合法（3-32位，字母/数字/下划线）" }, 400);
  const password = String(body?.password ?? "");
  if (password.length < 6) return c.json({ error: "密码至少6位" }, 400);
  const role = ALLOWED_ROLES.includes(body?.role as any) ? body?.role : "readonly";
  const display_name = body?.display_name ? String(body.display_name).trim().slice(0, 50) : null;
  const exists = await c.env.DB.prepare("SELECT 1 as ok FROM users WHERE lower(username) = lower(?)").bind(username).first<{ ok: number }>();
  if (exists) return c.json({ error: "用户名已存在" }, 400);
  const r = await c.env.DB.prepare("INSERT INTO users (username, password_hash, display_name, role, disabled) VALUES (?, ?, ?, ?, 0)").bind(username, hashPassword(password), display_name, role).run();
  await addOperationLog(c.env.DB, "CREATE_USER", `新增账号：${username}（角色：${role}）`, user.displayName || user.username, { clientIp: getClientIp(c) });
  return c.json({ id: r.meta.last_row_id, success: true });
});

app.put("/users/:id", async (c) => {
  const user = await requirePermission(c, "manage_accounts");
  if (!user) return c.res;
  const id = c.req.param("id");
  const body = await c.req.json<{ display_name?: string; role?: string; disabled?: boolean | number }>();
  const target = await c.env.DB.prepare("SELECT id, username, display_name, role, disabled FROM users WHERE id = ?").bind(id).first<any>();
  if (!target) return c.json({ error: "账号不存在" }, 404);
  const nextDisabled = body.disabled != null ? (body.disabled === true || body.disabled === 1 ? 1 : 0) : (target.disabled === 1 ? 1 : 0);
  if (Number(target.id) === Number(user.id) && nextDisabled === 1) return c.json({ error: "不能禁用当前登录账号" }, 400);
  const nextRole = body.role != null && ALLOWED_ROLES.includes(body.role as any) ? body.role : target.role;
  const nextDisplay = body.display_name !== undefined ? (body.display_name ? String(body.display_name).trim().slice(0, 50) : null) : target.display_name;
  await c.env.DB.prepare("UPDATE users SET display_name = ?, role = ?, disabled = ? WHERE id = ?").bind(nextDisplay, nextRole, nextDisabled, id).run();
  await addOperationLog(c.env.DB, "UPDATE_USER", `编辑账号：${target.username}（ID：${id}）`, user.displayName || user.username, { clientIp: getClientIp(c) });
  return c.json({ success: true });
});

app.delete("/users/:id", async (c) => {
  const user = await requirePermission(c, "manage_accounts");
  if (!user) return c.res;
  const id = c.req.param("id");
  const target = await c.env.DB.prepare("SELECT id, username, role, disabled FROM users WHERE id = ?").bind(id).first<any>();
  if (!target) return c.json({ error: "账号不存在" }, 404);
  if (String(target.username || "").toLowerCase() === "admin") return c.json({ error: "用户名 admin 的账号禁止删除" }, 400);
  if (Number(target.id) === Number(user.id)) return c.json({ error: "不能删除当前登录账号" }, 400);
  await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id).run();
  await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
  await addOperationLog(c.env.DB, "DELETE_USER", `删除账号：${target.username}（ID：${id}）`, user.displayName || user.username, { clientIp: getClientIp(c) });
  return c.json({ success: true });
});

app.post("/users/:id/reset-password", async (c) => {
  const user = await requirePermission(c, "manage_accounts");
  if (!user) return c.res;
  const id = c.req.param("id");
  const body = await c.req.json<{ password?: string }>();
  const target = await c.env.DB.prepare("SELECT id, username FROM users WHERE id = ?").bind(id).first<any>();
  if (!target) return c.json({ error: "账号不存在" }, 404);
  const arr = new Uint8Array(6);
  crypto.getRandomValues(arr);
  const newPwd = body?.password && body.password.length >= 6 ? body.password : btoa(String.fromCharCode(...arr)).replace(/[+/=]/g, "").slice(0, 8);
  await c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(hashPassword(newPwd), id).run();
  await addOperationLog(c.env.DB, "RESET_USER_PASSWORD", `重置账号密码：${target.username}（ID：${id}）`, user.displayName || user.username, { clientIp: getClientIp(c) });
  return c.json({ success: true, password: newPwd });
});

// --- Role Permissions ---

const ROLES = ["admin", "warehouse_keeper", "reporter", "readonly"];
const ALLOWED_PERMS = new Set(["*", "view", "view_reports", "export", "export_transactions", "export_operation_logs", "export_materials", "export_inventory", "backup", "backup_db", "inbound", "outbound", "transactions_inbound", "transactions_outbound", "transactions_undo", "edit_material", "delete_material", "materials_view", "materials_edit", "materials_delete", "materials_import", "upload_image", "inventory_view", "inventory_alert_edit", "edit_settings", "delete_settings", "settings_view", "settings_edit", "settings_delete", "logs_view", "manage_accounts", "manage_role_permissions"]);

app.get("/role-permissions", async (c) => {
  const user = await requirePermission(c, "manage_role_permissions");
  if (!user) return c.res;
  const { results } = await c.env.DB.prepare("SELECT role, permissions FROM role_permissions").all<{ role: string; permissions: string }>();
  const map: Record<string, string[]> = {};
  for (const r of results ?? []) {
    try { map[r.role] = JSON.parse(r.permissions); } catch { map[r.role] = []; }
    if (!Array.isArray(map[r.role])) map[r.role] = [];
  }
  for (const role of ROLES) {
    if (!map[role]) map[role] = [];
  }
  return c.json({ roles: ROLES, permissionsByRole: map });
});

app.put("/role-permissions", async (c) => {
  const user = await requirePermission(c, "manage_role_permissions");
  if (!user) return c.res;
  const body = await c.req.json<{ permissionsByRole?: Record<string, string[]> }>();
  const permissionsByRole = body?.permissionsByRole;
  if (!permissionsByRole || typeof permissionsByRole !== "object") return c.json({ error: "参数错误" }, 400);
  const normalize = (arr: unknown): string[] => {
    const a = Array.isArray(arr) ? arr.map(String) : [];
    const filtered = a.map((p) => p.trim()).filter(Boolean).filter((p) => ALLOWED_PERMS.has(p));
    if (filtered.includes("*")) return ["*"];
    return [...new Set(filtered)].sort();
  };
  for (const role of ROLES) {
    const perms = JSON.stringify(normalize(permissionsByRole[role]));
    await c.env.DB.prepare("INSERT INTO role_permissions (role, permissions) VALUES (?, ?) ON CONFLICT(role) DO UPDATE SET permissions = excluded.permissions").bind(role, perms).run();
  }
  await addOperationLog(c.env.DB, "UPDATE_ROLE_PERMISSIONS", "更新角色权限配置", user.displayName || user.username, { clientIp: getClientIp(c) });
  return c.json({ success: true });
});

// --- Dashboard ---

app.get("/dashboard/stats", async (c) => {
  const user = await requireAuthUser(c);
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
  const d7StartStr = d7Start.toISOString().slice(0, 10) + " 00:00:00";
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

export const onRequest = handle(app);

