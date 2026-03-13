import React from "react";
import { apiClient } from "../api/client";

const geoCache = new Map<string, string | null>();

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
    setLocation(undefined);
    apiClient
      .get<{ ip: string; location: string | null }>(`/api/ip-geo?ip=${encodeURIComponent(raw)}`)
      .then((res) => {
        geoCache.set(raw, res.location);
        setLocation(res.location);
      })
      .catch(() => {
        geoCache.set(raw, null);
        setLocation(null);
      });
  }, [ip]);

  if (!ip) return <span>-</span>;
  const display = showIp ? ip : "";
  if (location === undefined) {
    return <span>{display}</span>;
  }
  if (location) {
    return (
      <span title={location}>
        {display}
        {showIp && " "}
        <span className="text-slate-500 text-xs">{location}</span>
      </span>
    );
  }
  return <span>{display}</span>;
}
