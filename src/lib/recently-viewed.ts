import { get, set } from "idb-keyval";

const RECENTLY_VIEWED_KEY = "aavora_recently_viewed_items";

export interface RecentItem {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  modifiedTime?: string;
  iconLink?: string;
  thumbnailLink?: string;
  viewedAt: string;
}

export async function getRecentlyViewed(limit = 10): Promise<RecentItem[]> {
  const items = await get<RecentItem[]>(RECENTLY_VIEWED_KEY);
  if (!items) return [];
  return items.slice(0, limit);
}

export async function addRecentlyViewed(item: Omit<RecentItem, "viewedAt">): Promise<void> {
  const current = (await get<RecentItem[]>(RECENTLY_VIEWED_KEY)) || [];
  const filtered = current.filter((x) => x.id !== item.id);
  const updated: RecentItem[] = [
    {
      ...item,
      viewedAt: new Date().toISOString(),
    },
    ...filtered,
  ].slice(0, 30); // Keep top 30 in cache

  await set(RECENTLY_VIEWED_KEY, updated);
}
