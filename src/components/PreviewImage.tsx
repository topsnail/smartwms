import React from "react";
import { Popover } from "antd";
import AntdImage from "antd/es/image";
import { apiClient } from "../api/client";

const Image = AntdImage as any;

export function PreviewImage(props: {
  url: string | null | undefined;
  name?: string;
  thumbSize?: number;
  popoverPreview?: boolean;
  onClick?: () => void;
}) {
  const { url, name, thumbSize = 40, popoverPreview = false, onClick } = props;
  if (!url) return <span className="text-slate-300 text-xs">无</span>;

  const [resolvedUrl, setResolvedUrl] = React.useState<string>(url);

  React.useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;

    async function run() {
      setResolvedUrl(url);
      if (!url.startsWith("/api/uploads/")) return;
      try {
        const blob = await apiClient.getBlob(url);
        objectUrl = URL.createObjectURL(blob);
        if (alive) setResolvedUrl(objectUrl);
      } catch {
        if (alive) setResolvedUrl(url);
      }
    }

    run();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  const thumb = (
    <Image
      src={resolvedUrl}
      alt={name}
      width={thumbSize}
      height={thumbSize}
      style={{ objectFit: "cover", borderRadius: 8, cursor: onClick ? "pointer" : undefined }}
      preview={{ mask: "点击放大" }}
      fallback="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'></svg>"
      onClick={onClick}
    />
  );

  if (!popoverPreview) return thumb;

  return (
    <Popover
      content={<Image src={resolvedUrl} alt={name} width={200} style={{ objectFit: "contain" }} preview={false} />}
    >
      {thumb}
    </Popover>
  );
}

