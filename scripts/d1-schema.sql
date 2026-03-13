-- D1 完整建表脚本（在 Cloudflare Dashboard → D1 → wms-db → Console 中执行）
-- 执行前请确保数据库为空，否则会跳过已存在的表

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  spec TEXT,
  unit TEXT,
  category_id INTEGER,
  image_url TEXT,
  source TEXT,
  purchase_price REAL,
  sale_price REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS locations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS units (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS staff (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, role TEXT);
CREATE TABLE IF NOT EXISTS departments (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS usage_reasons (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS material_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS material_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, parent_id INTEGER, description TEXT);
CREATE TABLE IF NOT EXISTS partners (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, invoice_info TEXT, contact TEXT, mailing_address TEXT);

CREATE TABLE IF NOT EXISTS inventory (
  material_id INTEGER NOT NULL,
  location_id INTEGER NOT NULL,
  quantity REAL DEFAULT 0,
  min_stock REAL DEFAULT 0,
  max_stock REAL DEFAULT 0,
  PRIMARY KEY (material_id, location_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT CHECK(type IN ('IN','OUT')),
  material_id INTEGER NOT NULL,
  location_id INTEGER NOT NULL,
  quantity REAL NOT NULL,
  operator_id INTEGER,
  department_id INTEGER,
  recipient_id INTEGER,
  partner_id INTEGER,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  note TEXT,
  reverted INTEGER DEFAULT 0,
  revert_transaction_id INTEGER
);

CREATE TABLE IF NOT EXISTS operation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  description TEXT NOT NULL,
  operator TEXT,
  old_value TEXT,
  new_value TEXT,
  client_ip TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  role TEXT DEFAULT 'readonly',
  disabled INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at DATETIME NOT NULL);
CREATE TABLE IF NOT EXISTS role_permissions (role TEXT PRIMARY KEY, permissions TEXT NOT NULL);

-- 初始角色权限
INSERT OR IGNORE INTO role_permissions (role, permissions) VALUES ('admin', '["*"]');
INSERT OR IGNORE INTO role_permissions (role, permissions) VALUES ('warehouse_keeper', '["view","inbound","outbound","edit_material","edit_settings","export"]');
INSERT OR IGNORE INTO role_permissions (role, permissions) VALUES ('reporter', '["view","export","backup","view_reports"]');
INSERT OR IGNORE INTO role_permissions (role, permissions) VALUES ('readonly', '["view","view_reports"]');

-- 初始用户：首次部署后需通过 API 创建。可用 wrangler d1 execute 执行 scripts/seed-admin.sql 或通过管理界面添加。
