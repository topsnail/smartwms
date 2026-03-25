import { sign } from "hono/jwt";
import bcrypt from "bcryptjs";
import type { Hono } from "hono";
import type { Env } from "../lib/types";
import {
  getJwtSecret,
  getJwtExpiresInMs,
  loadUserWithPermissions,
  getAuthUser,
} from "../lib/auth";

const DEFAULT_LOGIN_WINDOW_MINUTES = 15;
const DEFAULT_LOGIN_LOCK_MINUTES = 15;
const DEFAULT_LOGIN_MAX_ATTEMPTS = 5;

function readPositiveIntEnv(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

function getClientIp(c: any): string {
  const xff = c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For");
  if (xff) return String(xff).split(",")[0]?.trim() || "unknown";
  return "unknown";
}

export function registerAuthRoutes(app: Hono<Env>) {
  const fail = (code: string, message: string) => ({ success: false, error: { code, message } } as const);

  app.post("/auth/login", async (c) => {
    const { username, password } = await c.req
      .json<{ username?: string; password?: string }>()
      .catch(() => ({} as any));
    if (!username || !password) {
      return c.json(fail("VALIDATION_FAILED", "请输入用户名和密码"), 400);
    }

    const loginWindowMinutes = readPositiveIntEnv(c.env.LOGIN_WINDOW_MINUTES, DEFAULT_LOGIN_WINDOW_MINUTES);
    const loginLockMinutes = readPositiveIntEnv(c.env.LOGIN_LOCK_MINUTES, DEFAULT_LOGIN_LOCK_MINUTES);
    const loginMaxAttempts = readPositiveIntEnv(c.env.LOGIN_MAX_ATTEMPTS, DEFAULT_LOGIN_MAX_ATTEMPTS);

    const normalizedUsername = String(username).trim().toLowerCase();
    const attemptKey = `${getClientIp(c)}|${normalizedUsername}`;
    await c.env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, fail_count INTEGER NOT NULL DEFAULT 0, first_failed_at TEXT, last_failed_at TEXT, locked_until TEXT)"
    ).run();
    const now = Date.now();
    const attemptsRow = await c.env.DB.prepare("SELECT fail_count, first_failed_at, locked_until FROM login_attempts WHERE key = ?").bind(attemptKey).first<{ fail_count: number; first_failed_at: string | null; locked_until: string | null }>();
    if (attemptsRow?.locked_until) {
      const lockUntilTs = Date.parse(attemptsRow.locked_until);
      if (Number.isFinite(lockUntilTs) && lockUntilTs > now) {
        return c.json(fail("AUTH_RATE_LIMITED", "登录失败次数过多，请稍后重试"), 429);
      }
    }

    const row = await c.env.DB
      .prepare(
        "SELECT id, username, password_hash, display_name, role, disabled FROM users WHERE username = ?"
      )
      .bind(username)
      .first<any>();

    const handleLoginFail = async () => {
      const current = attemptsRow?.fail_count ?? 0;
      const firstFailedAt = attemptsRow?.first_failed_at ? Date.parse(attemptsRow.first_failed_at) : NaN;
      const resetWindow = !Number.isFinite(firstFailedAt) || now - firstFailedAt > loginWindowMinutes * 60 * 1000;
      const nextFailCount = resetWindow ? 1 : current + 1;
      const firstFailedIso = resetWindow
        ? new Date(now).toISOString()
        : (attemptsRow?.first_failed_at || new Date(now).toISOString());
      const lockedUntil = nextFailCount >= loginMaxAttempts
        ? new Date(now + loginLockMinutes * 60 * 1000).toISOString()
        : null;
      await c.env.DB.prepare(
        "INSERT INTO login_attempts (key, fail_count, first_failed_at, last_failed_at, locked_until) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET fail_count = excluded.fail_count, first_failed_at = excluded.first_failed_at, last_failed_at = excluded.last_failed_at, locked_until = excluded.locked_until"
      ).bind(attemptKey, nextFailCount, firstFailedIso, new Date(now).toISOString(), lockedUntil).run();
    };

    if (!row || row.disabled) {
      await handleLoginFail();
      return c.json(fail("AUTH_INVALID_CREDENTIALS", "用户名或密码错误"), 401);
    }

    const ok = bcrypt.compareSync(password, row.password_hash);
    if (!ok) {
      await handleLoginFail();
      return c.json(fail("AUTH_INVALID_CREDENTIALS", "用户名或密码错误"), 401);
    }
    await c.env.DB.prepare("DELETE FROM login_attempts WHERE key = ?").bind(attemptKey).run();

    const secret = getJwtSecret(c.env);
    const expiresMs = getJwtExpiresInMs(c.env);
    const issuedAt = Date.now();
    const exp = new Date(issuedAt + expiresMs).getTime();

    const token = await sign(
      { userId: row.id, username: row.username, exp: Math.floor(exp / 1000) },
      secret,
      "HS256"
    );

    const user = await loadUserWithPermissions(c.env.DB, row.id);
    if (!user) {
      return c.json(fail("AUTH_USER_STATE_INVALID", "账号状态异常"), 500);
    }

    return c.json({
      token,
      user,
    });
  });

  app.post("/auth/logout", (c) => {
    return c.json({ success: true });
  });

  app.get("/auth/me", async (c) => {
    const user = await getAuthUser(c);
    if (!user) {
      return c.json(
        { success: false, error: { code: "AUTH_UNAUTHORIZED", message: "未登录" } },
        401
      );
    }
    return c.json({ success: true, user });
  });
}

