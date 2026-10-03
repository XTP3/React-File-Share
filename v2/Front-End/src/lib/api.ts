import type { ExplorerPreferences, PublicConfig } from "./types";
let csrfToken = "";
export function setCSRF(token: string) {
  csrfToken = token;
}
export class APIError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  if (options.method && options.method !== "GET")
    headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch("/api/v2" + path, {
    ...options,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("fileshare:session-expired"));
    const body = await response.json().catch(() => ({}));
    throw new APIError(
      body.error || `Request failed (${response.status})`,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  const raw = await response.text();
  return raw
    ? response.headers.get("content-type")?.includes("application/json")
      ? JSON.parse(raw)
      : (raw as T)
    : (undefined as T);
}
export function fileQuery(
  p: ExplorerPreferences,
  page: number,
  collection: string,
) {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(p.pageSize),
    sort: p.sort,
    direction: p.direction,
  });
  if (p.q.trim()) query.set("q", p.q.trim());
  if (p.categories.length) query.set("category", p.categories.join(","));
  if (p.minSize && Number.isFinite(Number(p.minSize)))
    query.set("minSize", String(Math.ceil(Number(p.minSize) * 1024 * 1024)));
  if (p.maxSize && Number.isFinite(Number(p.maxSize)))
    query.set("maxSize", String(Math.floor(Number(p.maxSize) * 1024 * 1024)));
  if (p.from)
    query.set("from", String(new Date(p.from + "T00:00:00").getTime()));
  if (p.to) query.set("to", String(new Date(p.to + "T23:59:59.999").getTime()));
  if (collection !== "all") query.set("collectionId", collection);
  return query.toString();
}
export function bytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4);
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: unit ? 1 : 0 }).format(value / 1024 ** unit)} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
}
export function formatDate(value: number, config?: PublicConfig) {
  try {
    return new Intl.DateTimeFormat(config?.dateLanguage || undefined, {
      dateStyle: "medium",
      ...(config?.timeZone ? { timeZone: config.timeZone } : {}),
    }).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
      new Date(value),
    );
  }
}
export function shareURL(id: string, kind: "v" | "d") {
  return `${location.origin}/f/${kind}/${encodeURIComponent(id)}`;
}
export function upload(
  file: File,
  collection: string,
  onProgress: (n: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      "/api/v2/files/upload" +
        (collection !== "all" && collection !== "uncollected"
          ? `?collectionId=${encodeURIComponent(collection)}`
          : ""),
    );
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-CSRF-Token", csrfToken);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status === 401)
        window.dispatchEvent(new Event("fileshare:session-expired"));
      signal.removeEventListener("abort", abort);
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let message = "Upload failed";
        try {
          message = JSON.parse(xhr.responseText).error || message;
        } catch {
          /* plain proxy response */
        }
        reject(new Error(message));
      }
    };
    xhr.onerror = () => {
      signal.removeEventListener("abort", abort);
      reject(new Error("Connection lost. Retry when you are online."));
    };
    xhr.onabort = () => {
      signal.removeEventListener("abort", abort);
      reject(new DOMException("Upload cancelled", "AbortError"));
    };
    function abort() {
      xhr.abort();
    }
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      reject(new DOMException("Upload cancelled", "AbortError"));
      return;
    }
    const form = new FormData();
    form.append("files", file);
    xhr.send(form);
  });
}
