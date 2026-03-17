import type { D1Database } from "./types";

export type Migration = {
  id: number;
  name: string;
  up: (db: D1Database) => Promise<void>;
};

const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "partners_table",
    up: async (db) => {
      await db
        .prepare(
          "CREATE TABLE IF NOT EXISTS partners (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, invoice_info TEXT, contact TEXT, mailing_address TEXT)"
        )
        .run();
    },
  },
  {
    id: 2,
    name: "transactions_partner_id",
    up: async (db) => {
      try {
        await db.prepare("ALTER TABLE transactions ADD COLUMN partner_id INTEGER").run();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("duplicate column")) throw e;
      }
    },
  },
];

const TABLE_NAME = "schema_migrations";

/**
 * 创建 schema_migrations 表（若不存在），并执行所有未执行的迁移。
 * 任一迁移失败时记录日志并抛出，不静默吞错。
 */
export async function runMigrations(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`
    )
    .run();

  const applied = await db
    .prepare(`SELECT id FROM ${TABLE_NAME} ORDER BY id ASC`)
    .all<{ id: number }>();
  const appliedSet = new Set((applied.results ?? []).map((r) => r.id));

  for (const m of MIGRATIONS) {
    if (appliedSet.has(m.id)) continue;
    try {
      await m.up(db);
      await db
        .prepare(`INSERT INTO ${TABLE_NAME} (id, name) VALUES (?, ?)`)
        .bind(m.id, m.name)
        .run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[migrations] Migration ${m.id} (${m.name}) failed:`, message);
      throw new Error(`数据库迁移失败: ${m.name} - ${message}`);
    }
  }
}
