import { sign, verify } from "hono/jwt";
import type { Bindings, D1Database } from "./types";
import type { PermissionKey } from "../../../shared/permissions";
import { hasPermission } from "../../../shared/permissions";

export type UserPayload = {
  id: number;
  username: string;
  displayName: string;
  role: string;
  permissions: string[];
};

export function getJwtSecret(env: Bindings): string {
  const raw = (env.JWT_SECRET || "").trim();
  if (raw) return raw;
  throw new Error("JWT_SECRET 缺失：请在 Cloudflare Pages 的环境变量中配置 JWT_SECRET");
}

export function getJwtExpiresInMs(env: Bindings): number {
  const v = (env.JWT_EXPIRES_IN || "").trim() || "7d";
  if (v.endsWith("d")) return parseInt(v) * 24 * 60 * 60 * 1000;
  if (v.endsWith("h")) return parseInt(v) * 60 * 60 * 1000;
  if (v.endsWith("m")) return parseInt(v) * 60 * 1000;
  if (v.endsWith("s")) return parseInt(v) * 1000;
  return parseInt(v) || 7 * 24 * 60 * 60 * 1000;
}

export async function loadUserWithPermissions(db: D1Database, id: number): Promise<UserPayload | null> {
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

export async function getAuthUser(c: any): Promise<UserPayload | null> {
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

export async function requireAuthUser(c: any): Promise<UserPayload | null> {
  const user = await getAuthUser(c);
  if (!user) {
    c.status(401);
    c.json({ success: false, error: { code: "AUTH_UNAUTHORIZED", message: "未登录" } });
    return null;
  }
  return user;
}

export async function requirePermission(c: any, perm: PermissionKey): Promise<UserPayload | null> {
  const user = await requireAuthUser(c);
  if (!user) return null;
  if (!hasPermission(user.permissions, perm)) {
    c.status(403);
    c.json({ success: false, error: { code: "PERMISSION_DENIED", message: "无操作权限" } });
    return null;
  }
  return user;
}

export async function issueToken(env: Bindings, userId: number): Promise<string> {
  const secret = getJwtSecret(env);
  const expMs = getJwtExpiresInMs(env);
  const payload = { userId, exp: Math.floor((Date.now() + expMs) / 1000) };
  return await sign(payload, secret, "HS256");
}

