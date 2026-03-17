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

export function registerAuthRoutes(app: Hono<Env>) {
  app.post("/auth/login", async (c) => {
    const { username, password } = await c.req
      .json<{ username?: string; password?: string }>()
      .catch(() => ({} as any));
    if (!username || !password) {
      return c.json({ error: "请输入用户名和密码" }, 400);
    }

    const row = await c.env.DB
      .prepare(
        "SELECT id, username, password_hash, display_name, role, disabled FROM users WHERE username = ?"
      )
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

