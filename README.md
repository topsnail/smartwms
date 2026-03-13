SmartWMS（Cloudflare Pages 生产部署版）
====================================

本项目**仅用于 Cloudflare Pages 生产环境部署**，后端使用 **Pages Functions + D1**，可选绑定 **R2** 存储物料图片。

## 架构

- **前端**：React + Vite + Ant Design（构建产物 `dist/`）
- **后端**：Pages Functions（`functions/api/[[route]].ts`，统一前缀 `/api`）
- **数据库**：D1（绑定名 `DB`）
- **对象存储（可选）**：R2（绑定名 `R2_BUCKET`）

## Cloudflare Pages 部署

### 1) 创建并绑定资源

- 创建 D1 数据库（示例名：`wms-db`），并在 Pages 项目中绑定为 `DB`
- （可选）创建 R2 bucket（示例名：`wms`），并绑定为 `R2_BUCKET`

仓库内 `wrangler.toml` 提供了绑定参考（仅供参考，以 Pages 项目设置绑定为准）。

### 2) 初始化数据库表结构

在 Cloudflare 控制台的 D1 Console 执行：

- `scripts/d1-schema.sql`

### 3) 配置 Pages 环境变量（必需）

在 Cloudflare Pages 项目设置中配置：

- `JWT_SECRET`：JWT 签名密钥（**必须**，请使用强随机值）
- `JWT_EXPIRES_IN`：可选，默认 `7d`

### 4) Pages 构建设置

- **Build command**：`npm run build`
- **Build output directory**：`dist`

### 5) 初始化管理员账号

执行 `scripts/seed-admin.sql`（会插入默认管理员）：

- 用户名：`admin`
- 密码：`admin123`

## SPA 回退

`public/_redirects` 已配置 SPA 回退：非 `/api/*` 的路径会回退到 `index.html`。

## 生产优化

- `functions/_middleware.ts`：统一安全响应头 + `/assets/` 长缓存（immutable）
- `functions/api/[[route]].ts`：`JWT_SECRET` 缺失会直接报错，避免生产误用弱默认值

