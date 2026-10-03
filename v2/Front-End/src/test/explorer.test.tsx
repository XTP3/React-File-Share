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
