import * as React from "react";

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState<T>(value);
  const latest = React.useRef(value);
  latest.current = value;

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(latest.current), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

