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

function detectImageExt(bytes: Uint8Array): "jpg" | "png" | "gif" | "webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) return "png";
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) return "gif";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) return "webp";
  return null;
}

export function registerUploadRoutes(app: Hono<Env>) {
  app.post("/upload-image", async (c) => {
    const user = await requirePermission(c, "upload_image");
    if (!user) return c.res;
    if (!c.env.R2_BUCKET) {
      return c.json(
        { success: false, error: { code: "CONFIG", message: "R2 未配置，无法上传图片" } },
        503
      );
    }
    let filename = "";
    let buf: ArrayBuffer | null = null;
    const contentType = c.req.header("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return c.json(
          { success: false, error: { code: "VALIDATION_FAILED", message: "缺少上传文件" } },
          400
        );
      }
      filename = file.name || "upload.webp";
      buf = await file.arrayBuffer();
    } else {
      const body = (await c.req.json().catch(() => ({}))) as {
        filename?: string;
        data?: string;
      };
      const data = body.data;
      filename = body.filename || "";
      if (!filename || !data) {
        return c.json(
          { success: false, error: { code: "VALIDATION_FAILED", message: "缺少文件名或数据" } },
          400
        );
      }
      const base64 = String(data).includes(",")
        ? String(data).split(",")[1]
        : String(data);
      buf = base64ToArrayBuffer(base64);
    }
    if (!buf) {
      return c.json(
        { success: false, error: { code: "VALIDATION_FAILED", message: "文件内容为空" } },
        400
      );
    }
    if (buf.byteLength > 200 * 1024) {
      return c.json(
        { success: false, error: { code: "VALIDATION_FAILED", message: "图片不能超过 200KB" } },
        400
      );
    }
    const detected = detectImageExt(new Uint8Array(buf));
    if (!detected) {
      return c.json(
        { success: false, error: { code: "VALIDATION_FAILED", message: "文件内容不是合法图片格式" } },
        400
      );
    }
    const ext = detected;
    const safeName = `uploads/${randomHex(12)}.${ext}`;
    const fileContentType =
      { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" }[
        ext as "jpg" | "jpeg" | "png" | "gif" | "webp"
      ] || "image/webp";
    await c.env.R2_BUCKET!.put(safeName, buf, { httpMetadata: { contentType: fileContentType } });
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

