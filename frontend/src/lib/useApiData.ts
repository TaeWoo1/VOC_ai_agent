import { useEffect, useState } from "react";

/** Loads data once on mount. Mock-fallback loaders never throw, so `error`
 *  stays null for them (behavior unchanged). Strict loaders (no silent mock)
 *  reject on backend failure, which surfaces here as `error` so the page can
 *  fail closed instead of showing stale/fake data. */
export function useApiData<T>(
  loader: () => Promise<T>,
): { data: T | null; loading: boolean; error: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    loader()
      .then((d) => {
        if (active) {
          setData(d);
        }
      })
      .catch(() => {
        if (active) {
          setError(true);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
    // Loaders are stable module methods; intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { data, loading, error };
}
