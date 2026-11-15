import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BulkDownloadDialog } from "@/features/BulkDownloadDialog";
import { useCopyLinks } from "@/features/useCopyLinks";
import { api, shareURL } from "@/lib/api";
import type { SharedFile } from "@/lib/types";

vi.mock("@/lib/api", async original => ({ ...await original<typeof import("@/lib/api")>(), api: vi.fn() }));
const files = ["third", "first", "second"].map(id => ({
  uniqueID: id, fileName: `${id}.txt`, fileSize: 50, fileType: "text/plain", category: "document",
} as SharedFile));

function CopyHarness() {
  const { copyLinks, dialog } = useCopyLinks();
  return <><button onClick={() => copyLinks(files)}>Copy selection</button>{dialog}</>;
}

describe("bulk actions", () => {
  it("copies one view link per line in selection order", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<CopyHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Copy selection" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(files.map(file => shareURL(file.uniqueID, "v")).join("\n")));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers selectable ordered links when clipboard access is denied", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("Permission denied")) } });
    render(<CopyHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Copy selection" }));
    const textarea = await screen.findByRole("textbox", { name: "Selected view links" });
    expect(textarea).toHaveValue(files.map(file => shareURL(file.uniqueID, "v")).join("\n"));
    fireEvent.click(screen.getByRole("button", { name: "Select all links" }));
    expect(textarea).toHaveFocus();
    expect((textarea as HTMLTextAreaElement).selectionStart).toBe(0);
    expect((textarea as HTMLTextAreaElement).selectionEnd).toBe((textarea as HTMLTextAreaElement).value.length);
  });

  it("requests a ZIP ticket with ordered IDs and hands the archive to the browser", async () => {
    const onClose = vi.fn();
    vi.mocked(api).mockResolvedValue({ id: "ticket", downloadUrl: "/api/v2/downloads/ticket/archive", expiresAt: Date.now() + 300000 });
    const requested: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function(this: HTMLAnchorElement) { requested.push(this.href); });
    render(<BulkDownloadDialog files={files} onClose={onClose} />);
    expect(screen.getByRole("combobox", { name: "Download format" })).toHaveTextContent("One ZIP");
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(api).toHaveBeenCalledWith("/downloads", expect.objectContaining({ method: "POST", body: JSON.stringify({ fileIds: ["third", "first", "second"] }) }));
    expect(requested).toEqual([new URL("/api/v2/downloads/ticket/archive", location.origin).href]);
    expect(document.querySelectorAll("a[hidden]")).toHaveLength(0);
  });

  it("starts separate downloads in selection order and resets the next choice to ZIP", async () => {
    const user = userEvent.setup();
    const requested: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function(this: HTMLAnchorElement) { requested.push(this.href); });
    const close = vi.fn();
    const ui = render(<BulkDownloadDialog files={files} onClose={close} />);
    await user.click(screen.getByRole("combobox", { name: "Download format" }));
    await user.click(screen.getByRole("option", { name: "Separate files" }));
    expect(screen.getByText(/browser may ask you to allow multiple downloads/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Download" }));
    expect(requested).toEqual(files.map(file => shareURL(file.uniqueID, "d")));
    ui.rerender(<BulkDownloadDialog files={null} onClose={close} />);
    ui.rerender(<BulkDownloadDialog files={files} onClose={close} />);
    expect(screen.getByRole("combobox", { name: "Download format" })).toHaveTextContent("One ZIP");
  });

  it("shows ticket preparation failures and allows retry without losing the selection", async () => {
    vi.mocked(api).mockRejectedValueOnce(new Error("A selected file is no longer available"));
    render(<BulkDownloadDialog files={files} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A selected file is no longer available");
    expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();
  });

  it("cancels a pending ticket request when the dialog closes", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(api).mockImplementation((_path, options) => {
      signal = options?.signal as AbortSignal;
      return new Promise(() => {});
    });
    const close = vi.fn();
    render(<BulkDownloadDialog files={files} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(signal?.aborted).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });
});
