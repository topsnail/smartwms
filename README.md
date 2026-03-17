SmartWMS 是一个面向中文用户的轻量级仓储管理系统，支持物料、库存、出入库流水、报表、系统设置与权限体系，并提供操作日志审计与 IP 归属地展示。

本仓库已按 **Cloudflare Pages + Pages Functions + D1 +（可选）R2** 形态优化，适用于生产环境部署。

---

目录
----

- [1. 核心特性](#1-核心特性)
- [2. 技术栈与架构](#2-技术栈与架构)
- [3. 目录结构](#3-目录结构)
- [4. Cloudflare Pages 生产部署](#4-cloudflare-pages-生产部署)
- [5. 环境变量与绑定](#5-环境变量与绑定)
- [6. 数据库初始化（D1）](#6-数据库初始化d1)
- [7. 默认账号与安全建议](#7-默认账号与安全建议)
- [8. 图片上传与压缩策略](#8-图片上传与压缩策略)
- [9. 操作日志与 IP 归属地](#9-操作日志与-ip-归属地)
- [10. 权限模型](#10-权限模型)
- [11. 常见运维与排障](#11-常见运维与排障)
- [12. 二次开发指南](#12-二次开发指南)
- [13. UI 与交互规范（团队约定）](#13-ui-与交互规范团队约定)
- [14. 开发/测试/发布流程](#14-开发测试发布流程)

---

## 1. 核心特性

- **物料管理**
  - 物料新增/编辑/删除
  - 图片上传（可选 R2）
  - CSV 导入导出

- **实时库存**
  - 按物料 + 库位展示库存
  - 低库存/高库存预警阈值（可配置）

- **出入库**
  - 入库/出库登记
  - 出库库存校验（后端原子更新，避免并发超卖）
  - 支持撤销（在有效窗口内）

- **报表与导出**
  - 多维报表（按日期、按物料等）
  - CSV 导出（权限控制）

- **系统设置（基础资料）**
  - 库位、单位、人员、部门、事由、分类、往来单位等基础数据维护

- **账号与权限**
  - 账号管理、角色权限矩阵
  - 前端菜单与按钮按权限显示，后端接口强制校验

- **操作日志审计**
  - 记录关键操作变更（old/new 值）
  - 支持筛选与导出
  - 显示客户端 IP + 中文归属地

---

## 2. 技术栈与架构

- **前端**
  - React + TypeScript
  - Vite 构建
  - Ant Design + Tailwind CSS

- **后端**
  - Cloudflare Pages Functions
  - Hono 路由框架
  - JWT 鉴权

- **数据与存储**
  - Cloudflare D1（业务数据）
  - Cloudflare R2（可选：物料图片）

### 请求流简述

- 浏览器访问 Pages 静态资源（`dist/`）
- 前端通过同源 `/api/*` 调用 Pages Functions
- Functions 访问 D1（`DB` 绑定）与 R2（`R2_BUCKET` 绑定）

---

## 3. 目录结构

主要目录如下：

- `src/`：前端源码
  - `src/pages/`：页面（物料、库存、出入库、报表、日志、设置等）
  - `src/components/`：通用组件（布局、页头、图片预览、IP 归属地等）
  - `src/api/`：前端 API 调用封装
  - `src/constants/`：常量（表格、日期快捷、操作日志中文映射等）
  - `src/contexts/`：认证与权限上下文
  - `src/utils/`：工具函数（时间解析、统一错误提示等），例如：
    - `src/utils/notify.ts`：`notifyError()` 统一封装 AntD 的错误提示，替代散落的 `message.error`

- `functions/`：Cloudflare Pages Functions（后端）
  - `functions/api/[[route]].ts`：API 入口，仅负责挂载各领域路由与通用中间件
  - `functions/api/lib/`：后端共享工具
    - `lib/types.ts`：Env/Bindings/D1/R2 等类型定义
    - `lib/auth.ts`：JWT、会话、权限校验等
    - `lib/migrations.ts`：基于 `schema_migrations` 的版本化数据库迁移
  - `functions/api/routes/`：按领域拆分的路由模块（`/api/*`）
    - `auth.ts`、`uploads.ts`、`materials.ts`、`inventory.ts`、`transactions.ts`
    - `settings.ts`（基础资料）、`reports.ts`、`operationLogs.ts`、`ipGeo.ts`
    - `export.ts`、`backup.ts`、`users.ts`、`rolePermissions.ts`、`dashboard.ts`
  - `functions/_middleware.ts`：全站安全响应头 + 缓存策略

- `shared/permissions.ts`：前后端共享的权限常量与 `hasPermission()` 实现，保证两端权限点完全一致

- `public/`：静态资源
  - `public/_redirects`：SPA 回退规则（非 `/api/*` 回到 `index.html`）

- `scripts/`：运维脚本
  - `scripts/d1-schema.sql`：D1 建表脚本
  - `scripts/seed-admin.sql`：初始化管理员账号

- `wrangler.toml`：绑定参考（建议保留，便于本地模拟/迁移）
- `vite.config.ts` / `tsconfig.json` / `package.json`：构建与工程配置

---

## 4. Cloudflare Pages 生产部署

### 4.1 Pages 项目构建配置

- **Build command**：`npm run build`
- **Build output directory**：`dist`

### 4.2 SPA 路由回退

仓库已提供 `public/_redirects`，用于保证前端路由可刷新访问：

- 非 `/api/*` 路径 → 回退 `index.html`
- `/api/*` → 由 Pages Functions 处理

---

## 5. 环境变量与绑定

### 5.1 必需环境变量（Cloudflare Pages → Settings → Environment variables）

- `JWT_SECRET`（必填）：JWT 签名密钥（必须是强随机值）
- `JWT_EXPIRES_IN`（可选）：默认 `7d`，支持 `12h`、`30d` 等

> 注意：当前后端已强制要求 `JWT_SECRET` 必须配置，否则会直接报错以避免生产弱密钥。

### 5.2 必需绑定（Cloudflare Pages → Settings → Functions）

- **D1 绑定（必需）**
  - Binding name：`DB`
  - 指向你的 D1 数据库实例

- **R2 绑定（可选）**
  - Binding name：`R2_BUCKET`
  - 指向你的 R2 bucket（用于图片上传/读取）

---

## 6. 数据库初始化（D1）

### 6.1 建表（首次部署）

在 Cloudflare 控制台的 D1 Console 中执行：

- 运行一次 `scripts/d1-schema.sql`

### 6.2 版本化迁移（后续升级）

从当前版本开始，后端不再在各路由中零散地 `CREATE TABLE / ALTER TABLE`，而是通过 `functions/api/lib/migrations.ts` 中的 **版本化迁移** 统一管理：

- 迁移元信息表：`schema_migrations (id, name, applied_at)`
- 应用启动时，入口中的 `ensureSchema()` 会调用 `runMigrations(DB)`：
  - 按顺序执行尚未记录到 `schema_migrations` 的迁移
  - 任意迁移失败会写入日志并抛出错误（返回 500），**不会静默吞掉**

如需新增字段/表，建议：

1. 在 `lib/migrations.ts` 中追加一个新的 `Migration`（自增 `id`）
2. 本地跑一次 `npm run typecheck && npm run build`
3. 部署到 Pages 后自动执行迁移

### 6.3 初始化管理员

执行 `scripts/seed-admin.sql` 创建默认管理员：

- 用户名：`admin`
- 密码：`admin123`

> 强烈建议：首次登录后立即修改默认密码，并创建独立管理员账号后禁用/删除默认账号（视你的管理策略）。

---

## 7. 默认账号与安全建议

- **默认账号（仅用于首次初始化）**
  - `admin / admin123`

- **安全建议**
  - 生产环境请使用强随机 `JWT_SECRET`
  - 限制管理员权限发放（尤其是导出/备份/日志查看）
  - 建议为 Cloudflare 侧开启 WAF / Rate Limiting（尤其是登录接口）

---

## 8. 图片上传与压缩策略

### 8.1 原图限制

- 上传时原始图片大小 **不超过 3MB**

### 8.2 自动压缩（前端完成）

为保证全站加载速度，图片会在浏览器端自动压缩后再上传：

- 目标格式：**WebP**
- 最大尺寸：**宽 ≤ 600，高 ≤ 400**（等比缩放）
- 目标体积：**≤ 200KB**
- 压缩质量：从 `0.9` 尝试，必要时递减，最低不低于 `0.5`

### 8.3 服务端兜底校验（Functions）

- 后端 `/api/upload-image` 会校验接收的数据体积 **≤ 200KB**，防止绕过前端。

### 8.4 图片访问与缓存

- 图片读取接口为 `/api/uploads/*`
- 需要登录才能访问
- 响应带长缓存头：`Cache-Control: public, max-age=31536000, immutable`

---

## 9. 操作日志与 IP 归属地

### 9.1 操作日志

- 列表接口：`GET /api/operation-logs`（需要 `logs_view` 权限）
- 导出接口：`GET /api/export/operation-logs`
- 清空接口（管理员）：`DELETE /api/operation-logs`

### 9.2 IP 归属地（中文）

- 前端通过 `/api/ip-geo?ip=xxx` 查询归属地（中文）
- 对私有 IP / 无效 IP 会返回 `location: null`
- 外部查询使用 HTTPS 调用第三方服务

---

## 10. 权限模型

项目采用“角色 → 权限点数组”的矩阵模型：

- `admin`：通常为 `["*"]` 全权限
- 其他角色：分配具体权限点（如 `inbound`、`outbound`、`export_*`、`logs_view` 等）

后端会对关键接口做权限校验，前端也会基于 `can(action)` 控制 UI 显示。

常见权限点举例：

- 浏览与报表：`view`、`view_reports`
- 出入库：`inbound`、`outbound`
- 导出：`export_materials`、`export_inventory`、`export_transactions`、`export_operation_logs`
- 日志：`logs_view`
- 账号与权限：`manage_accounts`、`manage_role_permissions`
- 图片：`upload_image`

---

## 11. 常见运维与排障

### 11.1 401/未登录

- 检查 Pages 环境变量 `JWT_SECRET` 是否配置
- 确认浏览器本地 token 是否过期（重新登录）

### 11.2 图片上传失败

- 确认已绑定 `R2_BUCKET`
- 确认原图 ≤ 3MB、压缩后 ≤ 200KB（系统会自动压缩，但超大图可能仍失败）

### 11.3 出库提示库存不足

- 属于正常保护：后端采用原子更新防并发超卖
- 建议刷新库存后重试，或核对是否有其他人同时出库同一物料

---

## 12. 二次开发指南

### 12.1 安装依赖

```bash
npm install
```

### 12.2 本地构建（与生产一致）

```bash
npm run build
```

### 12.3 代码阅读建议

- API 后端入口：`functions/api/[[route]].ts`
- 全站安全头与缓存：`functions/_middleware.ts`
- 前端 API 客户端：`src/api/client.ts`
- 认证与权限：`src/contexts/AuthContext.tsx`
- 关键业务页：
  - `src/pages/Materials.tsx`
  - `src/pages/Inventory.tsx`
  - `src/pages/TransactionForm.tsx`
  - `src/pages/OperationLogs.tsx`

### 12.4 开发注意事项

- **不要在前端打包注入敏感密钥**（如 API Key）。
- **接口返回结构尽量统一**，避免前端到处做兼容分支。
- 涉及库存扣减等关键数据写入，请优先使用数据库层面的条件更新确保原子性。

---

## 13. UI 与交互规范（团队约定）

本项目已统一为 Ant Design 为主的组件风格，并用 Tailwind 做布局与细节。为避免“改 A 影响 B”，建议新增/修改 UI 时遵循以下约定。

### 13.1 按钮统一

- **优先使用 AntD `Button`**，避免自绘 `<button>`。
- **按钮语义**
  - 主操作：`<Button type="primary">`
  - 次操作：`<Button type="default">`
  - 文本/图标操作：`<Button type="text">` 或 `type="link"`
  - 危险操作：`<Button danger>`
- **加载态**：异步请求时使用 `loading={true}`，不要手动拼接“保存中.../备份中...”来模拟 disabled。

> 说明：目前仅保留了一个用于触发文件选择的 `<label htmlFor="material-import">`，其余页面已不再使用原生 `<button>`。

### 13.2 统一错误提示

项目提供 `src/utils/notify.ts`：

- `notifyError(message)`：统一封装 `message.error`，并在弹新提示前 `message.destroy()`，避免错误提示堆叠。
- 约定：页面中的错误提示统一使用 `notifyError()`；成功/信息提示仍可使用 `message.success/info/warning`。

### 13.3 表格与筛选区

- 列表页建议保持“**筛选区 → 操作区 → 表格**”的顺序。
- 表格列可见性与分页等行为尽量复用现有 hooks（如 `useColumnVisibility`、`useDebouncedValue`）。

---

## 14. 开发/测试/发布流程

### 14.1 本地开发（前端）

```bash
npm install
npm run dev
```

### 14.2 类型检查与构建

```bash
npm run typecheck
npm run build
```

### 14.3 数据库升级（迁移）

新增/修改表结构时：

1. 在 `functions/api/lib/migrations.ts` 追加新的迁移（递增 `id`，保持只追加不重排）。
2. 在迁移 `up()` 中写 D1 SQL（必要时注意 `ALTER TABLE` 的幂等处理）。
3. 本地跑 `npm run typecheck && npm run build`
4. 部署到 Pages 后，`runMigrations(DB)` 会自动执行未执行迁移，并记录到 `schema_migrations`。

### 14.4 发布建议（避免影响线上）

- **小步提交**：一次只做一个领域/一个页面改动，便于回滚与定位问题。
- **每次迭代必跑**：`npm run typecheck`；涉及路由与构建产物变更时再跑 `npm run build`。

