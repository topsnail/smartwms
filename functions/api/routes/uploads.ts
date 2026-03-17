import type { Hono } from "hono";
import type { Env } from "../lib/types";
import { requireAuthUser, requirePermission } from "../lib/auth";

function randomHex(len: number): string {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function registerUploadRoutes(app: Hono<Env>) {
  app.post("/upload-image", async (c) => {
    const user = await requirePermission(c, "edit_material");
    if (!user) return c.res;
    if (!c.env.R2_BUCKET) {
      return c.json(
        { success: false, error: { code: "CONFIG", message: "R2 未配置，无法上传图片" } },
        503
      );
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      filename?: string;
      data?: string;
    };
    const { filename, data } = body;
    if (!filename || !data) {
      return c.json(
        { success: false, error: { code: "VALIDATION_FAILED", message: "缺少文件名或数据" } },
        400
      );
    }
    const allowedExt = /\.(jpg|jpeg|png|gif|webp)$/i;
    if (!allowedExt.test(filename)) {
      return c.json(
        { success: false, error: { code: "VALIDATION_FAILED", message: "仅支持 JPG、PNG、GIF、WebP 格式" } },
        400
      );
    }
    const base64 = String(data).includes(",")
      ? String(data).split(",")[1]
      : String(data);
    const buf = base64ToArrayBuffer(base64);
    if (buf.byteLength > 200 * 1024) {
      return c.json(
        { success: false, error: { code: "VALIDATION_FAILED", message: "图片不能超过 200KB" } },
        400
      );
    }
    const ext =
      (filename.match(/\.(jpg|jpeg|png|gif|webp)$/i) || ["", "jpg"])[1].toLowerCase();
    const safeName = `uploads/${randomHex(12)}.${ext === "jpeg" ? "jpg" : ext}`;
    const contentType =
      { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" }[
        ext as "jpg" | "jpeg" | "png" | "gif" | "webp"
      ] || "image/webp";
    await c.env.R2_BUCKET!.put(safeName, buf, { httpMetadata: { contentType } });
    return c.json({ success: true, url: `/api/uploads/${safeName}`, size: buf.byteLength });
  });

  app.get("/uploads/*", async (c) => {
    const user = await requireAuthUser(c);
    if (!user) return c.res;
    const bucket = c.env.R2_BUCKET;
    if (!bucket) return c.notFound();
    const rawPath = new URL(c.req.url).pathname;
    const key = rawPath.replace(/^\/api\/uploads\//, "").replace(/^\/uploads\//, "");
    if (!key || key.includes("..")) return c.notFound();
    const obj = await bucket.get(key);
    if (!obj) return c.notFound();
    const ct = obj.httpMetadata?.contentType || "application/octet-stream";
    return new Response(obj.body, {
      headers: {
        "Content-Type": ct,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  });
}

