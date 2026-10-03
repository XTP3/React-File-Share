import { it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UploadQueue } from "@/features/UploadQueue";
import { upload } from "@/lib/api";
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  upload: vi.fn(),
}));
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
    target: string;
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
  expect(calls.every((c) => c.target === "one")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Cancel file-1.txt" }));
  await waitFor(() => expect(calls[1].signal.aborted).toBe(true));
  expect(calls.find((c) => c.file.name === "file-4.txt")).toBeUndefined();
  ui.unmount();
});
