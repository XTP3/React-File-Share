import { expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "@/App";
import type { SharedFile } from "@/lib/types";

// Trigger a realistic two-batch action without coupling this session test to
// Explorer pagination and selection, which have their own behavioral tests.
vi.mock("@/features/Explorer", () => ({
  FileThumbnail: () => null,
  Explorer: ({ user, onRemove }: { user: string; onRemove: (files: SharedFile[]) => void }) => (
    <div>
      <p>File list for {user}</p>
      <button onClick={() => onRemove(Array.from({ length: 1001 }, (_, index) => ({
        uniqueID: `file-${index}`,
        fileName: `file-${index}.pdf`,
      } as SharedFile)))}>Remove selected files</button>
    </div>
  ),
}));
vi.mock("@/features/Connection", () => ({ Connection: () => null }));

function response(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

it("does not restore an old membership action when its 401 finishes after another login", async () => {
  const initialPath = location.pathname;
  history.replaceState({}, "", "/collections/favourites");
  const batches: string[][] = [];
  let finishExpiredResponse!: (body: { error: string }) => void;
  const expiredBody = new Promise<{ error: string }>((resolve) => { finishExpiredResponse = resolve; });
  vi.stubGlobal("fetch", vi.fn().mockImplementation((path: string, options: RequestInit) => {
    if (path === "/api/v2/auth/me") return Promise.resolve(response({ user: { uniqueID: "first-user", username: "First" }, csrfToken: "first-token" }));
    if (path === "/api/v2/auth/login") return Promise.resolve(response({ user: { uniqueID: "next-user", username: "Next" }, csrfToken: "next-token" }));
    if (path === "/api/v2/collections/favourites/files" && options.method === "DELETE") {
      batches.push(JSON.parse(options.body as string).fileIds);
      if (batches.length === 1) return Promise.resolve(response({ ok: true }));
      const expired = new Response(null, { status: 401 });
      // The API announces expiry before parsing the response body. Keep parsing
      // pending so the previous action's rejection arrives in the new session.
      expired.json = () => expiredBody;
      return Promise.resolve(expired);
    }
    if (path === "/api/v2/config") return Promise.resolve(response({ version: "test", maxUploadSize: 1000, timeZone: "UTC" }));
    if (path === "/api/v2/collections") return Promise.resolve(response({ items: [{ id: "favourites", title: "Favourites", fileCount: 1001, totalBytes: 0, createdAt: 0, updatedAt: 0 }] }));
    if (path.startsWith("/api/v2/storage")) return Promise.resolve(response({ totalFiles: 1001, totalBytes: 0, categories: [], updatedAt: 0, missingFiles: 0, untrackedBytes: 0 }));
    return Promise.reject(new Error(`Unexpected request: ${path}`));
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    const ui = render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Remove selected files" }));
    await screen.findByRole("dialog", { name: "Remove from collection?" });
    fireEvent.click(screen.getByRole("button", { name: "Remove membership" }));
    await screen.findByText("Your session expired. Log in to continue.");
    expect(batches.map((batch) => batch.length)).toEqual([1000, 1]);
    expect(screen.queryByRole("dialog", { name: "Remove from collection?" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "Next" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password" } });
    fireEvent.click(screen.getByRole("button", { name: "Login" }));
    await screen.findByText("File list for next-user");
    await act(async () => { finishExpiredResponse({ error: "Previous session expired" }); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText("Previous session expired")).not.toBeInTheDocument();
    expect(screen.getByText("File list for next-user")).toBeVisible();
    expect(batches).toHaveLength(2);
    ui.unmount();
  } finally {
    client.clear();
    history.replaceState({}, "", initialPath);
    vi.unstubAllGlobals();
  }
});
