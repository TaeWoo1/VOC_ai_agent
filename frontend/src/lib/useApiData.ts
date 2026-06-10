import { useEffect, useState } from "react";

/** Loads data once on mount; pairs with the mock-fallback API client so a
 *  failed request still resolves to seeded data rather than throwing. */
export function useApiData<T>(loader: () => Promise<T>): { data: T | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loader()
      .then((d) => {
        if (active) {
          setData(d);
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

  return { data, loading };
}
