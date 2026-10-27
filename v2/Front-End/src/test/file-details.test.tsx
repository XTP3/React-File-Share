import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FileDetails } from "@/features/FileDetails";
import { api } from "@/lib/api";
import type { SharedFile } from "@/lib/types";
vi.mock("@/lib/api", async (original) => ({ ...await original<typeof import("@/lib/api")>(), api: vi.fn() }));
it.each([
  [true, "", "Available"],
  [false, "Original file is unavailable", "Original file is unavailable"],
])("shows thumbnail availability %s in file details", async (available, reason, expected) => {
  vi.mocked(api).mockResolvedValue({ available, reason });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const file = { uniqueID: "photo", fileName: "camera.jpeg", fileSize: 4000000, fileType: "image/jpeg", category: "photo", timeOfUpload: 1 } as SharedFile;
  render(<QueryClientProvider client={client}><FileDetails file={file} onClose={vi.fn()} /></QueryClientProvider>);
  expect(await screen.findByText(expected)).toBeVisible();
  expect(api).toHaveBeenCalledWith("/files/photo/thumbnail?details=1", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  client.clear();
});
