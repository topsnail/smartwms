import { apiClient } from "./client";

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadWithAuth(url: string, filename: string): Promise<void> {
  const blob = await apiClient.getBlob(url);
  triggerBrowserDownload(blob, filename);
}

