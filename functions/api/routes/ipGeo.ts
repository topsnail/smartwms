import type { Hono } from "hono";
import type { Env } from "../lib/types";

function isPrivateIp(ip: string): boolean {
  if (!ip || ip === "未知") return true;
  if (ip.startsWith("127.") || ip === "::1") return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (ip.startsWith("172.")) {
    const parts = ip.split(".");
    const s2 = Number(parts[1] || "0");
    if (s2 >= 16 && s2 <= 31) return true;
  }
  return false;
}

type Deps = {
  requireAuthUser: (c: unknown) => Promise<{ id: number } | null>;
};

export function registerIpGeoRoutes(app: Hono<Env>, deps: Deps) {
  app.get("/ip-geo", async (c) => {
    const user = await deps.requireAuthUser(c);
    if (!user) return c.res;
    const ip = c.req.query("ip") || "";
    const raw = ip.trim();
    if (!raw || isPrivateIp(raw)) return c.json({ ip, location: null });

    async function queryIpApi(base: "https" | "http") {
      const url = `${base}://ip-api.com/json/${encodeURIComponent(raw)}?fields=status,country,regionName,city&lang=zh-CN`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      const data = (await res.json()) as { status?: string; country?: string; regionName?: string; city?: string };
      if (data?.status !== "success") return null;
      const parts = [data.country, data.regionName, data.city].filter(Boolean);
      return parts.length ? parts.join(" ") : null;
    }

    try {
      let location = await queryIpApi("https").catch(() => null);
      if (!location) location = await queryIpApi("http").catch(() => null);
      return c.json({ ip, location });
    } catch {
      return c.json({ ip, location: null });
    }
  });
}
