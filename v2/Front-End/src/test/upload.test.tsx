import { it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { UploadQueue } from "@/features/UploadQueue";
import { upload } from "@/lib/api";
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  upload: vi.fn(),
}));
beforeEach(() => { vi.mocked(upload).mockReset(); });
it("keeps previews local, releases resources and bounds decoded thumbnails", async () => {
  const create = vi.fn((_: Blob) => "blob:" + crypto.randomUUID()),
    revoke = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    value: create,
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: revoke,
    configurable: true,
  });
  const ui = render(
    <UploadQueue
      open
      onOpenChange={vi.fn()}
      maxSize={1000000}
      collection="one"
      collections={[{ id: "one", title: "One", createdAt: 0, updatedAt: 0, fileCount: 0, totalBytes: 0 }]}
      collectionsLoading={false}
      collectionsError={false}
      onRetryCollections={vi.fn()}
      onSuccess={vi.fn()}
      onActiveChange={vi.fn()}
    />,
  );
  const files = Array.from(
    { length: 40 },
    (_, i) => new File(["small"], `photo-${i}.png`, { type: "image/png" }),
  );
  fireEvent.change(screen.getByLabelText("Choose files"), {
    target: { files },
  });
  expect(create).toHaveBeenCalledTimes(30);
  expect(upload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Remove photo-0.png" }));
  expect(revoke).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(revoke).toHaveBeenCalledTimes(30);
  expect(screen.queryByText("photo-1.png")).not.toBeInTheDocument();
  ui.unmount();
});
it("limits transfers to three, snapshots collection and cancels queued files", async () => {
  const calls: {
    file: File;
    target: string[];
    signal: AbortSignal;
    finish: () => void;
  }[] = [];
  vi.mocked(upload).mockImplementation(
    (file, target, _progress, signal) =>
      new Promise((resolve, reject) => {
        calls.push({ file, target, signal, finish: resolve });
        signal.addEventListener("abort", () =>
          reject(new DOMException("cancelled", "AbortError")),
        );
      }),
  );
  const props = {
    open: true,
    collections: ["one", "two"].map((id) => ({ id, title: id, createdAt: 0, updatedAt: 0, fileCount: 0, totalBytes: 0 })),
    collectionsLoading: false,
    collectionsError: false,
    onRetryCollections: vi.fn(),
    onOpenChange: vi.fn(),
    maxSize: 1000000,
    onSuccess: vi.fn(),
    onActiveChange: vi.fn(),
  };
  const ui = render(<UploadQueue {...props} collection="one" />);
  fireEvent.change(screen.getByLabelText("Choose files"), {
    target: {
      files: Array.from(
        { length: 5 },
        (_, i) => new File(["small"], `file-${i}.txt`, { type: "text/plain" }),
      ),
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Upload 5 files" }));
  await waitFor(() => expect(calls.length).toBe(3));
  ui.rerender(<UploadQueue {...props} collection="two" />);
  fireEvent.click(screen.getByRole("button", { name: "Cancel file-4.txt" }));
  calls[0].finish();
  await waitFor(() => expect(calls.length).toBe(4));
  expect(calls.every((c) => JSON.stringify(c.target) === JSON.stringify(["one"]))).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Cancel file-1.txt" }));
  await waitFor(() => expect(calls[1].signal.aborted).toBe(true));
  expect(calls.find((c) => c.file.name === "file-4.txt")).toBeUndefined();
  ui.unmount();
});

const collectionOptions = ["one", "two", "three"].map((id) => ({ id, title: id, createdAt: 0, updatedAt: 0, fileCount: 0, totalBytes: 0 }));
const queueProps = { open: true, onOpenChange: vi.fn(), maxSize: 1000000, collection: "one", collections: collectionOptions, collectionsLoading: false, collectionsError: false, onRetryCollections: vi.fn(), onSuccess: vi.fn(), onActiveChange: vi.fn() };
function addFile(name: string) {
  fireEvent.change(screen.getByLabelText("Choose files"), { target: { files: [new File(["small"], name)] } });
}
function picker(label: string) {
  const summary = screen.getByLabelText(label);
  fireEvent.click(summary);
  return within(summary.parentElement!);
}
it("updates ready inheritors while keeping explicit empty and multi-collection overrides independent", async () => {
  vi.mocked(upload).mockResolvedValue(undefined);
  render(<UploadQueue {...queueProps} />);
  addFile("inherited.txt");
  addFile("empty.txt");
  const empty = picker("Collections for empty.txt");
  fireEvent.click(empty.getByRole("button", { name: "No collections" }));
  const batch = picker("Batch collections");
  fireEvent.click(batch.getByRole("checkbox", { name: "two" }));
  fireEvent.change(batch.getByRole("textbox"), { target: { value: "three" } });
  expect(batch.queryByRole("checkbox", { name: "one" })).not.toBeInTheDocument();
  fireEvent.click(batch.getByRole("checkbox", { name: "three" }));
  addFile("later.txt");
  fireEvent.click(screen.getByRole("button", { name: "Upload 3 files" }));
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(3));
  const targets = Object.fromEntries(vi.mocked(upload).mock.calls.map(([file, ids]) => [file.name, ids]));
  expect(targets).toEqual({ "inherited.txt": ["one", "two", "three"], "empty.txt": [], "later.txt": ["one", "two", "three"] });
});
it("freezes failed assignments across batch changes and permits explicit correction before retry", async () => {
  vi.mocked(upload).mockRejectedValue(new Error("Try again"));
  render(<UploadQueue {...queueProps} />);
  addFile("retry.txt");
  fireEvent.click(screen.getByRole("button", { name: "Upload 1 files" }));
  await screen.findByRole("button", { name: "Retry retry.txt" });
  const batch = picker("Batch collections");
  fireEvent.click(batch.getByRole("checkbox", { name: "two" }));
  fireEvent.click(screen.getByRole("button", { name: "Retry retry.txt" }));
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
  expect(vi.mocked(upload).mock.calls[1][1]).toEqual(["one"]);
  await screen.findByRole("button", { name: "Retry retry.txt" });
  const perFile = picker("Collections for retry.txt");
  fireEvent.click(perFile.getByRole("button", { name: "No collections" }));
  fireEvent.click(screen.getByRole("button", { name: "Retry retry.txt" }));
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(3));
  expect(vi.mocked(upload).mock.calls[2][1]).toEqual([]);
});
it("blocks unavailable assignments until corrected and resets an empty reopened queue to its current collection", () => {
  const ui = render(<UploadQueue {...queueProps} collections={collectionOptions.slice(1)} />);
  addFile("missing.txt");
  expect(screen.getByRole("button", { name: "Upload 1 files" })).toBeDisabled();
  const perFile = picker("Collections for missing.txt");
  fireEvent.click(perFile.getByRole("button", { name: "Remove unavailable" }));
  expect(screen.getByRole("button", { name: "Upload 1 files" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
  ui.rerender(<UploadQueue {...queueProps} open={false} collection="two" />);
  ui.rerender(<UploadQueue {...queueProps} collection="two" />);
  expect(screen.getByLabelText("Batch collections")).toHaveTextContent("two");
});
it("allows explicit no-collection uploads while collection loading fails and exposes retry", () => {
  const retry = vi.fn();
  const ui = render(<UploadQueue {...queueProps} collectionsLoading />);
  addFile("offline-list.txt");
  expect(screen.getByRole("button", { name: "Upload 1 files" })).toBeDisabled();
  ui.rerender(<UploadQueue {...queueProps} collectionsError onRetryCollections={retry} />);
  const batch = picker("Batch collections");
  fireEvent.click(batch.getByRole("button", { name: "Retry collections" }));
  expect(retry).toHaveBeenCalledOnce();
  fireEvent.click(batch.getByRole("button", { name: "No collections" }));
  expect(screen.getByRole("button", { name: "Upload 1 files" })).toBeEnabled();
});
it("reattaches an override to live batch defaults", () => {
  render(<UploadQueue {...queueProps} />);
  addFile("reattach.txt");
  const perFile = picker("Collections for reattach.txt");
  fireEvent.click(perFile.getByRole("button", { name: "No collections" }));
  fireEvent.click(screen.getByRole("button", { name: "Use batch defaults" }));
  const batch = picker("Batch collections");
  fireEvent.click(batch.getByRole("checkbox", { name: "two" }));
  expect(screen.getByLabelText("Collections for reattach.txt")).toHaveTextContent("one, two");
});
