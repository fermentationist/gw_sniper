export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: "include",
    headers: body !== undefined ? { "content-type": "application/json" } : {},
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  const res = await fetch(path, init);
  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!res.ok) {
    const message =
      (payload && typeof payload === "object" && "error" in payload
        ? String((payload as Record<string, unknown>).error)
        : res.statusText) || `HTTP ${res.status}`;
    throw new ApiError(res.status, message, payload);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

// ─── typed helpers ───────────────────────────────────────────────────────────

export interface AppConfig {
  goodwillUsername: string | null;
  goodwillPasswordSet: boolean;
  notificationEmail: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPassSet: boolean;
  globalEmailAlertsEnabled: boolean;
}

export interface SavedSearch {
  id: string;
  name: string;
  queryString: string | null;
  categoryId: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  excludePickupOnly: boolean;
  cronSchedule: string;
  emailAlertsEnabled: boolean;
  isActive: boolean;
  createdAt: string | null;
}

export interface InboxItem {
  id: string;
  title: string;
  currentPrice: number;
  endTime: string;
  imageUrl: string | null;
  status: "unread" | "read" | "deleted";
  discoveredAt: string | null;
  discoveredBySearchId: string | null;
}

export interface InboxLiveEntry {
  currentPrice?: number;
  bidCount?: number;
  endTime?: string;
  error?: string;
}

export interface SniperJob {
  id: string;
  title: string;
  maxBid: number;
  snipingBufferSeconds: number;
  endTime: string;
  jobStatus: "scheduled" | "executed" | "cancelled" | "outbid" | "failed";
  lastCheckedPrice: number | null;
  lastResultMessage: string | null;
  updatedAt: string | null;
}
