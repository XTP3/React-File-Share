import { describe, it, expect, vi } from "vitest";
import { api, fileQuery, formatDate, bytes, setCSRF } from "@/lib/api";
import { defaultPreferences } from "@/lib/types";
import {
  readPreferences,
  savePreferences,
  applyTheme,
} from "@/lib/preferences";
describe("API contract", () => {
  it("accepts legacy text successes and JSON successes", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("Created", { status: 201 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ items: [] }), {
            headers: { "content-type": "application/json" },
          }),
        ),
    );
    expect(await api("/auth/register", { method: "POST", body: "{}" })).toBe(
      "Created",
    );
    expect(await api("/files")).toEqual({ items: [] });
  });
  it("passes CSRF and caller cancellation without caching private data", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("OK"));
    vi.stubGlobal("fetch", fetcher);
    setCSRF("test-csrf");
    const controller = new AbortController();
    await api("/collections", {
      method: "POST",
      body: "{}",
      signal: controller.signal,
    });
    const options = fetcher.mock.calls[0][1];
    expect(options.signal).toBe(controller.signal);
    expect(options.cache).toBe("no-store");
    expect(options.credentials).toBe("same-origin");
    expect(options.headers.get("X-CSRF-Token")).toBe("test-csrf");
  });
  it("signals session expiration for protected requests", async () => {
    const expired = vi.fn();
    window.addEventListener("fileshare:session-expired", expired);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response('{"error":"Session expired"}', {
            status: 401,
            headers: { "content-type": "application/json" },
          }),
        ),
    );
    await expect(api("/files")).rejects.toThrow("Session expired");
    expect(expired).toHaveBeenCalledOnce();
    window.removeEventListener("fileshare:session-expired", expired);
  });
  it("composes OR categories and integer AND ranges and collection pagination", () => {
    const p = {
      ...defaultPreferences,
      q: "report",
      categories: ["photo", "archive"] as const,
      minSize: "0.0001",
      maxSize: "0.1",
      from: "2026-01-01",
      to: "2026-02-01",
    };
    const q = new URLSearchParams(
      fileQuery({ ...p, categories: [...p.categories] }, 2, "collection-1"),
    );
    expect(q.get("category")).toBe("photo,archive");
    expect(q.get("minSize")).toBe("105");
    expect(q.get("maxSize")).toBe("104857");
    expect(q.get("q")).toBe("report");
    expect(q.get("page")).toBe("2");
    expect(q.get("collectionId")).toBe("collection-1");
    expect(Number(q.get("to"))).toBeGreaterThan(Number(q.get("from")));
  });
  it("uses configured locale and timezone, with safe invalid-config fallback", () => {
    const config = {
      version: "2",
      maxUploadSize: 10,
      dateLanguage: "en-US",
      timeZone: "America/Los_Angeles",
    };
    expect(formatDate(Date.UTC(2026, 0, 1, 1), config)).toBe("Dec 31, 2025");
    expect(() =>
      formatDate(Date.now(), { ...config, timeZone: "invalid" }),
    ).not.toThrow();
    expect(bytes(1024)).toBe("1 KB");
  });
});
describe("isolated validated preferences", () => {
  it("scopes each account and stable collection independently", () => {
    savePreferences("a", "all", { ...defaultPreferences, view: "grid" });
    savePreferences("a", "one", { ...defaultPreferences, sort: "name" });
    expect(readPreferences("a", "all").view).toBe("grid");
    expect(readPreferences("a", "one").sort).toBe("name");
    expect(readPreferences("b", "all")).toEqual(defaultPreferences);
  });
  it("ignores unsupported versions, malformed JSON and invalid ranges", () => {
    localStorage.setItem(
      "fileshare:v2:a:all",
      '{"version":1,"value":{"minSize":"NaN","from":"oops","pageSize":999,"categories":["photo","evil"]}}',
    );
    const p = readPreferences("a", "all");
    expect(p.minSize).toBe("");
    expect(p.from).toBe("");
    expect(p.pageSize).toBe(25);
    expect(p.categories).toEqual(["photo"]);
    localStorage.setItem("fileshare:v2:a:all", "bad json");
    expect(readPreferences("a", "all")).toEqual(defaultPreferences);
  });
  it("keeps dark default and restores light theme without credentials", () => {
    applyTheme("dark");
    expect(document.documentElement).toHaveClass("dark");
    applyTheme("light");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(localStorage.getItem("fileshare:theme")).toBe("light");
  });
});
