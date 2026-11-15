import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FilePreview, type PreviewNavigation } from "@/features/FilePreview";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SharedFile } from "@/lib/types";

const file = { uniqueID: "first", fileName: "first.txt", fileSize: 20, category: "other", fileType: "text/plain" } as SharedFile;
const nav = (): PreviewNavigation => ({ position: 2, total: 3, loading: false, error: "", onNavigate: vi.fn(), onRetry: vi.fn() });

it("supports preview arrow keys and preserves expansion while changing files", () => {
  const navigation = nav();
  const ui = render(<TooltipProvider><FilePreview file={file} onClose={vi.fn()} navigation={navigation} /></TooltipProvider>);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
  expect(navigation.onNavigate).toHaveBeenCalledWith(1);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowLeft" });
  expect(navigation.onNavigate).toHaveBeenCalledWith(-1);
  fireEvent.click(screen.getByRole("button", { name: "Maximize preview" }));
  ui.rerender(<TooltipProvider><FilePreview file={{ ...file, uniqueID: "second", fileName: "second.txt" }} onClose={vi.fn()} navigation={{ ...navigation, position: 3 }} /></TooltipProvider>);
  expect(screen.getByRole("dialog")).toHaveAttribute("data-expanded", "true");
  expect(screen.getByRole("button", { name: "Next file" })).toBeDisabled();
  expect(screen.getByRole("link", { name: "Open original file in a new tab" })).toHaveAttribute("href", expect.stringContaining("/f/v/second"));
});

it("leaves media slider arrow keys to seeking and pauses/releases media on navigation", () => {
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  const navigation = nav();
  const audioFile = { ...file, category: "audio", fileType: "audio/wav" } as SharedFile;
  const ui = render(<TooltipProvider><FilePreview file={audioFile} onClose={vi.fn()} navigation={navigation} /></TooltipProvider>);
  const media = document.querySelector("audio")!;
  Object.defineProperty(media, "duration", { value: 120 });
  fireEvent.loadedMetadata(media);
  fireEvent.keyDown(screen.getByRole("slider", { name: "Seek" }), { key: "ArrowRight" });
  expect(navigation.onNavigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Next file" }));
  expect(pause).toHaveBeenCalled();
  ui.rerender(<TooltipProvider><FilePreview file={file} onClose={vi.fn()} navigation={navigation} /></TooltipProvider>);
  expect(media.getAttribute("src")).toBeNull();
});
