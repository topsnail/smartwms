-- 创建默认管理员（用户名 admin，密码 admin123）
-- 执行：wrangler d1 execute wms-db --remote --file=./scripts/seed-admin.sql
INSERT OR IGNORE INTO users (username, password_hash, display_name, role)
VALUES ('admin', '$2a$10$iNZUM/HxAtMz5AuxWU0MIe.tAz41u1W4osTjDoqr4uK6TnSI9qDZ.', '管理员', 'admin');
