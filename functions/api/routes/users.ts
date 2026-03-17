import bcrypt from "bcryptjs";
import type { Hono } from "hono";
import type { D1Database } from "../lib/types";
import type { Env } from "../lib/types";

const ALLOWED_ROLES = ["admin", "warehouse_keeper", "readonly", "reporter"] as const;

function hashPassword(pwd: string): string {
  return bcrypt.hashSync(pwd, 10);
}

type Deps = {
  requirePermission: (c: unknown, perm: string) => Promise<{ id: number; username: string; displayName: string | null } | null>;
  addOperationLog: (db: D1Database, action: string, description: string, operator?: string, opts?: { clientIp?: string }) => Promise<void>;
  getClientIp: (c: unknown) => string;
};

export function registerUsersRoutes(app: Hono<Env>, deps: Deps) {
  app.get("/users", async (c) => {
    const user = await deps.requirePermission(c, "manage_accounts");
    if (!user) return c.res;
    const { results } = await c.env.DB.prepare("SELECT id, username, display_name, role, disabled, created_at FROM users ORDER BY created_at DESC, id DESC").all<Record<string, unknown>>();
    return c.json(results ?? []);
  });

  app.post("/users", async (c) => {
    const user = await deps.requirePermission(c, "manage_accounts");
    if (!user) return c.res;
    const body = await c.req.json<{ username?: string; password?: string; display_name?: string; role?: string }>();
    const username = String(body?.username ?? "").trim();
    if (!username || !/^[a-zA-Z0-9_]{3,32}$/.test(username)) return c.json({ error: "用户名格式不合法（3-32位，字母/数字/下划线）" }, 400);
    const password = String(body?.password ?? "");
    if (password.length < 6) return c.json({ error: "密码至少6位" }, 400);
    const role = body?.role && ALLOWED_ROLES.includes(body.role as (typeof ALLOWED_ROLES)[number]) ? body.role : "readonly";
    const display_name = body?.display_name ? String(body.display_name).trim().slice(0, 50) : null;
    const exists = await c.env.DB.prepare("SELECT 1 as ok FROM users WHERE lower(username) = lower(?)").bind(username).first<{ ok: number }>();
    if (exists) return c.json({ error: "用户名已存在" }, 400);
    const r = await c.env.DB.prepare("INSERT INTO users (username, password_hash, display_name, role, disabled) VALUES (?, ?, ?, ?, 0)").bind(username, hashPassword(password), display_name, role).run();
    await deps.addOperationLog(c.env.DB, "CREATE_USER", `新增账号：${username}（角色：${role}）`, user.displayName || user.username, { clientIp: deps.getClientIp(c) });
    return c.json({ id: r.meta.last_row_id, success: true });
  });

  app.put("/users/:id", async (c) => {
    const user = await deps.requirePermission(c, "manage_accounts");
    if (!user) return c.res;
    const id = c.req.param("id");
    const body = await c.req.json<{ display_name?: string; role?: string; disabled?: boolean | number }>();
    const target = await c.env.DB.prepare("SELECT id, username, display_name, role, disabled FROM users WHERE id = ?").bind(id).first<Record<string, unknown>>();
    if (!target) return c.json({ error: "账号不存在" }, 404);
    const nextDisabled = body.disabled != null ? (body.disabled === true || body.disabled === 1 ? 1 : 0) : (Number(target.disabled) === 1 ? 1 : 0);
    if (Number(target.id) === Number(user.id) && nextDisabled === 1) return c.json({ error: "不能禁用当前登录账号" }, 400);
    const nextRole = body.role != null && ALLOWED_ROLES.includes(body.role as (typeof ALLOWED_ROLES)[number]) ? body.role : target.role;
    const nextDisplay = body.display_name !== undefined ? (body.display_name ? String(body.display_name).trim().slice(0, 50) : null) : target.display_name;
    await c.env.DB.prepare("UPDATE users SET display_name = ?, role = ?, disabled = ? WHERE id = ?").bind(nextDisplay, nextRole, nextDisabled, id).run();
    await deps.addOperationLog(c.env.DB, "UPDATE_USER", `编辑账号：${target.username}（ID：${id}）`, user.displayName || user.username, { clientIp: deps.getClientIp(c) });
    return c.json({ success: true });
  });

  app.delete("/users/:id", async (c) => {
    const user = await deps.requirePermission(c, "manage_accounts");
    if (!user) return c.res;
    const id = c.req.param("id");
    const target = await c.env.DB.prepare("SELECT id, username, role, disabled FROM users WHERE id = ?").bind(id).first<Record<string, unknown>>();
    if (!target) return c.json({ error: "账号不存在" }, 404);
    if (String(target.username || "").toLowerCase() === "admin") return c.json({ error: "用户名 admin 的账号禁止删除" }, 400);
    if (Number(target.id) === Number(user.id)) return c.json({ error: "不能删除当前登录账号" }, 400);
    await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id).run();
    await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
    await deps.addOperationLog(c.env.DB, "DELETE_USER", `删除账号：${target.username}（ID：${id}）`, user.displayName || user.username, { clientIp: deps.getClientIp(c) });
    return c.json({ success: true });
  });

  app.post("/users/:id/reset-password", async (c) => {
    const user = await deps.requirePermission(c, "manage_accounts");
    if (!user) return c.res;
    const id = c.req.param("id");
    const body = await c.req.json<{ password?: string }>();
    const target = await c.env.DB.prepare("SELECT id, username FROM users WHERE id = ?").bind(id).first<Record<string, unknown>>();
    if (!target) return c.json({ error: "账号不存在" }, 404);
    const arr = new Uint8Array(6);
    crypto.getRandomValues(arr);
    const newPwd = body?.password && body.password.length >= 6 ? body.password : btoa(String.fromCharCode(...arr)).replace(/[+/=]/g, "").slice(0, 8);
    await c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(hashPassword(newPwd), id).run();
    await deps.addOperationLog(c.env.DB, "RESET_USER_PASSWORD", `重置账号密码：${target.username}（ID：${id}）`, user.displayName || user.username, { clientIp: deps.getClientIp(c) });
    return c.json({ success: true, password: newPwd });
  });
}
