import type { Hono } from "hono";
import type { Env } from "../lib/types";

type Deps = {
  requirePermission: (c: unknown, perm: string) => Promise<{ id: number } | null>;
};

export function registerBackupRoutes(app: Hono<Env>, deps: Deps) {
  app.get("/backup", async (c) => {
    const user = await deps.requirePermission(c, "backup_db");
    if (!user) return c.res;
    const esc = (v: unknown): string => {
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
        const { results } = await c.env.DB.prepare(`SELECT * FROM ${table}`).all<Record<string, unknown>>();
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
}
