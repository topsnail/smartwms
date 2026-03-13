import * as React from "react";

export type ColumnKey = string;

export function useColumnVisibility(opts: {
  defaultKeys: ColumnKey[];
  storageKey?: string;
}) {
  const { defaultKeys, storageKey } = opts;
  const [visibleKeys, setVisibleKeys] = React.useState<ColumnKey[]>(() => {
    if (!storageKey) return defaultKeys;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return defaultKeys;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : defaultKeys;
    } catch {
      return defaultKeys;
    }
  });

  React.useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(visibleKeys));
    } catch {
      // ignore
    }
  }, [visibleKeys, storageKey]);

  const toggle = React.useCallback((key: ColumnKey, checked: boolean) => {
    setVisibleKeys((prev) => {
      const set = new Set(prev);
      if (checked) set.add(key);
      else set.delete(key);
      return Array.from(set);
    });
  }, []);

  const reset = React.useCallback(() => setVisibleKeys(defaultKeys), [defaultKeys]);

  return { visibleKeys, setVisibleKeys, toggle, reset };
}

