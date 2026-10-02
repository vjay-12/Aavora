import { QueryClient } from "@tanstack/react-query";
import { get, set, del } from "idb-keyval";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2, // 2 minutes stale time
      gcTime: 1000 * 60 * 60 * 24, // 24 hours in cache
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Simple IndexedDB Query Cache Persister
const QUERY_CACHE_KEY = "aavora_react_query_cache";

export async function restoreQueryCache() {
  try {
    const cached = await get<string>(QUERY_CACHE_KEY);
    if (cached) {
      const data = JSON.parse(cached);
      // Populate dehydrated query cache if valid
      for (const [key, val] of Object.entries(data)) {
        queryClient.setQueryData(JSON.parse(key), (val as any).data);
      }
    }
  } catch (err) {
    console.warn("Failed to restore query cache from IndexedDB:", err);
  }
}

export async function persistQueryCache() {
  try {
    const cache = queryClient.getQueryCache();
    const serialized: Record<string, unknown> = {};
    for (const query of cache.getAll()) {
      if (query.state.status === "success" && query.state.data) {
        serialized[JSON.stringify(query.queryKey)] = {
          data: query.state.data,
          updatedAt: query.state.dataUpdatedAt,
        };
      }
    }
    await set(QUERY_CACHE_KEY, JSON.stringify(serialized));
  } catch (err) {
    console.warn("Failed to persist query cache:", err);
  }
}

export async function clearQueryCache() {
  await del(QUERY_CACHE_KEY);
  queryClient.clear();
}

// Automatically persist on every successful query update
queryClient.getQueryCache().subscribe((event) => {
  if (event?.type === "updated" && event.query.state.status === "success") {
    persistQueryCache().catch(console.warn);
  }
});
