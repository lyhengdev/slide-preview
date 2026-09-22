export class ApiError extends Error {
  status: number;
  details?: string[];

  constructor(status: number, message: string, details?: string[]) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
  getDeviceId?: () => string | null;
}

export function createApiClient(opts: ApiClientOptions = {}) {
  const baseUrl = opts.baseUrl ?? "";

  async function request<T>(
    path: string,
    init: RequestInit = {},
    asForm = false
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (!asForm) headers["Content-Type"] = "application/json";
    const deviceId = opts.getDeviceId?.();
    if (deviceId) headers["X-Device-Id"] = deviceId;

    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      credentials: "include",
    });

    if (!res.ok) {
      let body: { error?: string; details?: string[] } = {};
      try {
        body = await res.json();
      } catch {
        // ignore
      }
      throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`, body.details);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
    patch: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
    del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
    upload: <T>(path: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return request<T>(path, { method: "POST", body: form }, true);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/**
 * `VITE_API_URL` may be either the API origin (`https://api.example.com`) or an
 * origin that already includes the versioned prefix. Render's `fromService: url`
 * injects the bare origin, so normalise here instead of at every call site.
 */
function normalizeApiBase(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return "/api/v1";
  return trimmed.endsWith("/api/v1") ? trimmed : `${trimmed}/api/v1`;
}

export const API_BASE_URL = normalizeApiBase(import.meta.env.VITE_API_URL);

/** Origin used for Socket.IO. Empty string means "same origin" (dev proxy). */
export const API_ORIGIN = API_BASE_URL.replace(/\/api\/v1$/, "");