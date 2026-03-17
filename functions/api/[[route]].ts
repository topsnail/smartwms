import { Hono } from "hono";
import { handle } from "hono/cloudflare-pages";
import { sign, verify } from "hono/jwt";
import { hasPermission, type PermissionKey } from "../../shared/permissions";
import { runMigrations } from "./lib/migrations";
import type { Bindings, D1Database, Env, R2Bucket } from "./lib/types";
import {
  getJwtSecret as _getJwtSecret,
  getJwtExpiresInMs as _getJwtExpiresInMs,
  loadUserWithPermissions as _loadUserWithPermissions,
  getAuthUser as _getAuthUser,
  requireAuthUser as _requireAuthUser,
  requirePermission as _requirePermission,
  issueToken as _issueToken,
  type UserPayload,
} from "./lib/auth";
import { registerAuthRoutes } from "./routes/auth";
import { registerUploadRoutes } from "./routes/uploads";
import { registerMaterialsRoutes } from "./routes/materials";
import { registerInventoryRoutes } from "./routes/inventory";
import { registerTransactionRoutes } from "./routes/transactions";
import { registerSettingsRoutes } from "./routes/settings";
import { registerReportsRoutes } from "./routes/reports";
import { registerOperationLogRoutes } from "./routes/operationLogs";
import { registerIpGeoRoutes } from "./routes/ipGeo";
import { registerExportRoutes } from "./routes/export";
import { registerBackupRoutes } from "./routes/backup";
import { registerUsersRoutes } from "./routes/users";
import { registerRolePermissionRoutes } from "./routes/rolePermissions";
import { registerDashboardRoutes } from "./routes/dashboard";

const app = new Hono<Env>().basePath("/api");

let schemaReady: Promise<void> | null = null;
/** 执行版本化迁移；失败时打日志并抛出，供上层返回 500。 */
async function ensureSchema(db: D1Database): Promise<void> {
  if (!schemaReady) {
    schemaReady = runMigrations(db);
  }
  await schemaReady;
}

const getJwtSecret = _getJwtSecret;
const getJwtExpiresInMs = _getJwtExpiresInMs;
const loadUserWithPermissions = _loadUserWithPermissions;
const getAuthUser = _getAuthUser;
const requireAuthUser = _requireAuthUser;
const requirePermission = _requirePermission;
const issueToken = _issueToken;

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
registerAuthRoutes(app);

// --- 图片上传（R2）---
registerUploadRoutes(app);

// --- Materials ---
registerMaterialsRoutes(app, {
  ensureSchema,
  requireAuthUser,
  requirePermission,
  addOperationLog,
  getClientIp,
  cleanRequiredText,
  cleanOptionalText,
  cleanOptionalPositiveInt,
  cleanOptionalNonNegativeNumber,
  cleanPositiveInt,
});

// --- Inventory ---
registerInventoryRoutes(app, {
  ensureSchema,
  requireAuthUser,
  requirePermission,
  addOperationLog,
  getClientIp,
  cleanOptionalNonNegativeNumber,
  cleanPositiveInt,
});

// --- Transactions (Inbound / Outbound) ---
registerTransactionRoutes(app, { ensureSchema, requireAuthUser, addOperationLog, getClientIp });

// --- Settings / Base Data ---
registerSettingsRoutes(app, { ensureSchema, requireAuthUser, requirePermission, addOperationLog, getClientIp });

// --- Reports ---
registerReportsRoutes(app, { requirePermission });

// --- IP 归属地 ---
registerIpGeoRoutes(app, { requireAuthUser });

// --- Operation Logs ---
registerOperationLogRoutes(app, { requireAuthUser, requirePermission });

// --- Export (CSV) ---
registerExportRoutes(app, { requirePermission });

// --- Backup ---
registerBackupRoutes(app, { requirePermission });

// --- Users ---
registerUsersRoutes(app, { requirePermission, addOperationLog, getClientIp });

// --- Role Permissions ---
registerRolePermissionRoutes(app, { requirePermission, addOperationLog, getClientIp });

// --- Dashboard ---
registerDashboardRoutes(app, { requireAuthUser });

export const onRequest = handle(app);