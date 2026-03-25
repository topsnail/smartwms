import type { Hono } from "hono";
import type { D1Database } from "../lib/types";
import type { Env } from "../lib/types";

const ROLES = ["admin", "warehouse_keeper", "reporter", "readonly"];
const ALLOWED_PERMS = new Set(["*", "view", "view_reports", "export", "export_transactions", "export_operation_logs", "export_materials", "export_inventory", "backup", "backup_db", "inbound", "outbound", "transactions_inbound", "transactions_outbound", "transactions_undo", "edit_material", "delete_material", "materials_view", "materials_edit", "materials_delete", "materials_import", "upload_image", "inventory_view", "inventory_alert_edit", "edit_settings", "delete_settings", "settings_view", "settings_edit", "settings_delete", "logs_view", "manage_accounts", "manage_role_permissions"]);

type Deps = {
  requirePermission: (c: unknown, perm: string) => Promise<{ id: number; username: string; displayName: string | null } | null>;
  addOperationLog: (db: D1Database, action: string, description: string, operator?: string, opts?: { clientIp?: string }) => Promise<void>;
  getClientIp: (c: unknown) => string;
};

export function registerRolePermissionRoutes(app: Hono<Env>, deps: Deps) {
  const fail = (message: string, status = 400, code?: string) =>
    ({ success: false, error: { code: code || (status >= 500 ? "INTERNAL_ERROR" : "VALIDATION_FAILED"), message } } as const);

  app.get("/role-permissions", async (c) => {
    const user = await deps.requirePermission(c, "manage_role_permissions");
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
    const user = await deps.requirePermission(c, "manage_role_permissions");
    if (!user) return c.res;
    const body = await c.req.json<{ permissionsByRole?: Record<string, string[]> }>();
    const permissionsByRole = body?.permissionsByRole;
    if (!permissionsByRole || typeof permissionsByRole !== "object") return c.json(fail("参数错误", 400), 400);
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
    await deps.addOperationLog(c.env.DB, "UPDATE_ROLE_PERMISSIONS", "更新角色权限配置", user.displayName || user.username, { clientIp: deps.getClientIp(c) });
    return c.json({ success: true });
  });
}
