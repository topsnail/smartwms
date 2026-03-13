SmartWMS（Cloudflare Pages 生产部署版）
====================================

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
  - `src/utils/`：工具函数（时间解析等）

- `functions/`：Cloudflare Pages Functions（后端）
  - `functions/api/[[route]].ts`：主要 API（`/api/*`）
  - `functions/_middleware.ts`：全站安全响应头 + 缓存策略

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

### 6.1 建表

在 Cloudflare 控制台的 D1 Console 中执行：

- `scripts/d1-schema.sql`

### 6.2 初始化管理员

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

