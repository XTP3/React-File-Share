import { it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LibraryPicker } from "@/features/LibraryPicker";
import type { Collection, SharedFile } from "@/lib/types";

const collection: Collection = {
  id: "collection/one",
  title: "Favourites",
  createdAt: 0,
  updatedAt: 0,
  fileCount: 1,
  totalBytes: 100,
};
function file(uniqueID: string): SharedFile {
  return {
    _id: uniqueID,
    uniqueID,
    fileName: `${uniqueID}.pdf`,
    fileSize: 100,
    fileType: "application/pdf",
    uploaderID: "user",
    timeOfUpload: 1000,
    timeOfUploadDate: "1970-01-01",
    category: "document",
  };
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

it("keeps selections across pages and searches, then keeps them available after an add fails", async () => {
  const requested: URLSearchParams[] = [];
  const additions: { path: string; ids: string[] }[] = [];
  let rejectAdd = true;
  vi.stubGlobal("fetch", vi.fn().mockImplementation((path: string, options: RequestInit) => {
    if (options.method === "POST") {
      additions.push({ path, ids: JSON.parse(options.body as string).fileIds });
      return Promise.resolve(rejectAdd ? response({ error: "Please retry this selection" }, 503) : response({ ok: true }));
    }
    const params = new URL(path, "http://test").searchParams;
    requested.push(params);
    const page = Number(params.get("page"));
    return Promise.resolve(response({
      items: [file(params.get("q") ? "search-result" : page === 1 ? "first" : "second")],
      total: 50,
      page,
      pageSize: 25,
      totalPages: 2,
    }));
  }));
  const onAdded = vi.fn();
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><LibraryPicker user="user" collection={collection} onAdded={onAdded} onClose={onClose} /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select first.pdf" }));
  expect(screen.getByRole("checkbox", { name: "Select this page" })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Next library page" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select second.pdf" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search library" }), { target: { value: "search" } });
  fireEvent.click(screen.getByRole("button", { name: "Search library now" }));
  await screen.findByRole("checkbox", { name: "Select search-result.pdf" });
  expect(screen.getByRole("button", { name: "Add selected (2)" })).toBeEnabled();
  expect(requested.every((params) => params.get("pageSize") === "25" && !params.has("collectionId"))).toBe(true);
  expect(requested.at(-1)?.get("page")).toBe("1");
  fireEvent.click(screen.getByRole("button", { name: "Add selected (2)" }));
  await screen.findByText("Please retry this selection");
  expect(onAdded).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Add selected (2)" })).toBeEnabled();
  rejectAdd = false;
  fireEvent.click(screen.getByRole("button", { name: "Add selected (2)" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(onAdded).toHaveBeenCalledOnce();
  expect(additions).toEqual([
    { path: "/api/v2/collections/collection%2Fone/files", ids: ["first", "second"] },
    { path: "/api/v2/collections/collection%2Fone/files", ids: ["first", "second"] },
  ]);
  client.clear();
});

it("aborts an unmounted picker without closing its replacement", async () => {
  let finish: (value: Response) => void = () => {};
  let requestSignal: AbortSignal | null | undefined;
  vi.stubGlobal("fetch", vi.fn().mockImplementation((_path: string, options: RequestInit) => {
    if (options.method === "POST") {
      requestSignal = options.signal;
      return new Promise<Response>((resolve) => { finish = resolve; });
    }
    return Promise.resolve(response({ items: [file("first")], total: 1, page: 1, pageSize: 25, totalPages: 1 }));
  }));
  const onAdded = vi.fn();
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><LibraryPicker user="user" collection={collection} onAdded={onAdded} onClose={onClose} /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select first.pdf" }));
  fireEvent.click(screen.getByRole("button", { name: "Add selected (1)" }));
  await waitFor(() => expect(requestSignal).toBeDefined());
  view.unmount();
  expect(requestSignal?.aborted).toBe(true);
  finish(response({ ok: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(onAdded).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  client.clear();
});
