import React from "react";
import { apiClient } from "../api/client";

const geoCache = new Map<string, string | null>();
const waiters = new Map<string, Array<(location: string | null) => void>>();
const pendingIps = new Set<string>();
let flushTimer: number | null = null;

function scheduleFlush() {
  if (flushTimer != null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushBatch();
  }, 40);
}

async function flushBatch() {
  const ips = Array.from(pendingIps);
  pendingIps.clear();
  if (!ips.length) return;
  try {
    const res = await apiClient.post<{ items: Array<{ ip: string; location: string | null }> }>("/api/ip-geo/batch", { ips });
    const map = new Map((res.items || []).map((it) => [it.ip, it.location]));
    for (const ip of ips) {
      const location = map.has(ip) ? (map.get(ip) ?? null) : null;
      geoCache.set(ip, location);
      const ws = waiters.get(ip) || [];
      waiters.delete(ip);
      ws.forEach((resolve) => resolve(location));
    }
  } catch {
    await Promise.all(
      ips.map(async (ip) => {
        let location: string | null = null;
        try {
          const single = await apiClient.get<{ ip: string; location: string | null }>(`/api/ip-geo?ip=${encodeURIComponent(ip)}`);
          location = single.location;
        } catch {
          location = null;
        }
        geoCache.set(ip, location);
        const ws = waiters.get(ip) || [];
        waiters.delete(ip);
        ws.forEach((resolve) => resolve(location));
      })
    );
  }
}

function getGeo(ip: string): Promise<string | null> {
  if (geoCache.has(ip)) return Promise.resolve(geoCache.get(ip) ?? null);
  return new Promise((resolve) => {
    const arr = waiters.get(ip) || [];
    arr.push(resolve);
    waiters.set(ip, arr);
    pendingIps.add(ip);
    scheduleFlush();
  });
}

interface IpWithGeoProps {
  ip: string | null | undefined;
  showIp?: boolean;
}

export function IpWithGeo({ ip, showIp = true }: IpWithGeoProps) {
  const [location, setLocation] = React.useState<string | null | undefined>(undefined);

  React.useEffect(() => {
    const raw = (ip || "").trim();
    if (!raw || raw === "未知" || raw === "-") {
      setLocation(null);
      return;
    }
    if (geoCache.has(raw)) {
      setLocation(geoCache.get(raw) ?? null);
      return;
    }
    let cancelled = false;
    setLocation(undefined);
    getGeo(raw).then((loc) => {
      if (!cancelled) setLocation(loc);
    });
    return () => {
      cancelled = true;
    };
  }, [ip]);

  if (!ip) return <span>-</span>;
  const display = showIp ? ip : "";
  if (location === undefined) {
    return <span>{display}</span>;
  }
  if (location) {
    return (
      <span title={location} className="inline-flex flex-col leading-tight">
        {display && <span>{display}</span>}
        <span className="text-slate-500 text-xs">{location}</span>
      </span>
    );
  }
  return <span>{display}</span>;
}
