import { it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Explorer } from "@/features/Explorer";
import type { SharedFile } from "@/lib/types";

it("keeps off-page selections, selects only the visible page, and submits every selected record", async () => {
  const fixtures: SharedFile[] = Array.from({ length: 26 }, (_, index) => ({
    _id: `id-${index}`, uniqueID: `id-${index}`, fileName: `file-${index}.txt`,
    fileSize: 1, fileType: "text/plain", uploaderID: "user", timeOfUpload: 1,
    timeOfUploadDate: "", category: "document",
  }));
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
    const page = Number(new URL(url, "http://test").searchParams.get("page"));
    return Promise.resolve(new Response(JSON.stringify({
      items: page === 1 ? fixtures.slice(0, 25) : fixtures.slice(25), total: 26,
      page, pageSize: 25, totalPages: 2,
    }), { headers: { "content-type": "application/json" } }));
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onDelete = vi.fn();
  const view = (completedSelection?: { ids: string[] }) => (
    <QueryClientProvider client={client}>
      <Explorer user="user" collection="all" title="All Files" onUpload={vi.fn()}
        onDelete={onDelete} onAssign={vi.fn()} onRemove={vi.fn()} onPreview={vi.fn()}
        onRefresh={vi.fn()} completedSelection={completedSelection} />
    </QueryClientProvider>
  );
  const { rerender } = render(view());
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select file-0.txt" }));
  const pageCheckbox = () => screen.getByRole("checkbox", { name: "Select all files on this page" });
  expect(pageCheckbox()).toHaveAttribute("aria-checked", "mixed");
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select file-25.txt" }));
  expect(pageCheckbox()).toHaveAttribute("aria-checked", "true");
  fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
  expect(await screen.findByRole("checkbox", { name: "Select file-0.txt" })).toBeChecked();
  fireEvent.click(pageCheckbox());
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(onDelete.mock.calls[0][0]).toHaveLength(26);
  expect(onDelete.mock.calls[0][0].map((file: SharedFile) => file.uniqueID)).toContain("id-25");
  // Opening (or cancelling) confirmation must not clear selections.
  expect(pageCheckbox()).toBeChecked();
  fireEvent.click(pageCheckbox());
  expect(pageCheckbox()).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(onDelete.mock.calls[1][0]).toEqual([fixtures[25]]);
  rerender(view({ ids: ["id-25"] }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Clear file selection" })).not.toBeInTheDocument());
  client.clear();
});
it("debounces search, cancels stale requests and resets pagination", async () => {
  const requests: { q: string; signal: AbortSignal }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, options: RequestInit) => {
      const params = new URL(url, "http://test").searchParams;
      const q = params.get("q") || "";
      requests.push({ q, signal: options.signal as AbortSignal });
      if (q === "old") return new Promise(() => {});
      return Promise.resolve(
        new Response(
          JSON.stringify({
            items: [],
            total: 0,
            page: 1,
            pageSize: 25,
            totalPages: 0,
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Explorer
        user="user"
        collection="all"
        title="All files"
        onUpload={vi.fn()}
        onDelete={vi.fn()}
        onAssign={vi.fn()}
        onRemove={vi.fn()}
        onPreview={vi.fn()}
        onRefresh={vi.fn()}
      />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(requests.length).toBe(1));
  const input = screen.getByRole("textbox", { name: "Search files" });
  fireEvent.change(input, { target: { value: "o" } });
  fireEvent.change(input, { target: { value: "old" } });
  expect(requests.length).toBe(1);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  await waitFor(() => expect(requests.some((r) => r.q === "old")).toBe(true));
  fireEvent.change(input, { target: { value: "new" } });
  fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(requests.some((r) => r.q === "new")).toBe(true));
  expect(requests.find((r) => r.q === "old")!.signal.aborted).toBe(true);
  expect(screen.getByText("No files found")).toBeVisible();
  client.clear();
});
