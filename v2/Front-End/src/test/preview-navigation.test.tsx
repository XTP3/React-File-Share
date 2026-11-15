import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { usePreviewNavigation, type PreviewSession } from "@/lib/preview-context";
import { defaultPreferences, type Page, type SharedFile } from "@/lib/types";

vi.mock("@/lib/api", async (original) => ({
  ...await original<typeof import("@/lib/api")>(), api: vi.fn(),
}));
const fixtures: SharedFile[] = Array.from({ length: 5 }, (_, i) => ({
  _id: String(i), uniqueID: String(i), fileName: `photo-${i}.jpg`, fileSize: 10,
  fileType: "image/jpeg", uploaderID: "owner", timeOfUpload: i, timeOfUploadDate: "", category: "photo",
}));
const page = (number: number): Page => ({ items: fixtures.slice((number - 1) * 2, number * 2), page: number, pageSize: 2, total: 5, totalPages: 3 });
const session = (): PreviewSession => ({ file: fixtures[1], context: {
  user: "owner", collection: "collection-one", page: page(1),
  preferences: { ...defaultPreferences, pageSize: 2, sort: "name", direction: "asc", q: "photo", categories: ["photo"] },
} });

it("browses captured collection results across page boundaries and stops at the ends", async () => {
  vi.mocked(api).mockImplementation(async (path) => page(Number(new URL(path, "http://fixture").searchParams.get("page"))));
  const { result } = renderHook(() => usePreviewNavigation(session()));
  await act(() => result.current.navigation.onNavigate(1));
  expect(result.current.file).toEqual(fixtures[2]);
  expect(result.current.navigation.position).toBe(3);
  const query = new URL(vi.mocked(api).mock.calls[0][0], "http://fixture").searchParams;
  expect(Object.fromEntries(query)).toMatchObject({ collectionId: "collection-one", q: "photo", category: "photo", sort: "name", direction: "asc", page: "2", pageSize: "2" });
  await act(() => result.current.navigation.onNavigate(-1));
  await act(() => result.current.navigation.onNavigate(-1));
  await act(() => result.current.navigation.onNavigate(-1));
  expect(result.current.navigation.position).toBe(1);
  expect(result.current.file).toEqual(fixtures[0]);
  for (let i = 0; i < 6; i++) await act(() => result.current.navigation.onNavigate(1));
  expect(result.current.file).toEqual(fixtures[4]);
  expect(result.current.navigation.position).toBe(5);
  expect(api).toHaveBeenCalledTimes(2); // initial page and neighboring pages are reused
});

it("keeps the current file on failure and retries the failed direction", async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce(page(2));
  const { result } = renderHook(() => usePreviewNavigation(session()));
  await act(() => result.current.navigation.onNavigate(1));
  expect(result.current.navigation.error).toBe("Connection lost");
  expect(result.current.file).toEqual(fixtures[1]);
  await act(() => result.current.navigation.onRetry());
  expect(result.current.navigation.error).toBe("");
  expect(result.current.file).toEqual(fixtures[2]);
});

it("cancels an outstanding page request when its preview closes", async () => {
  let signal: AbortSignal | undefined;
  let finish!: (page: Page) => void;
  vi.mocked(api).mockImplementation((_path, options) => {
    signal = options?.signal as AbortSignal;
    return new Promise(resolve => { finish = resolve; });
  });
  const { result, unmount } = renderHook(() => usePreviewNavigation(session()));
  act(() => { void result.current.navigation.onNavigate(1); });
  await waitFor(() => expect(result.current.navigation.loading).toBe(true));
  unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(page(2)));
});

it("refetches an incomplete result page when retrying navigation", async () => {
  vi.mocked(api).mockResolvedValueOnce({ ...page(2), items: [] }).mockResolvedValueOnce(page(2));
  const { result } = renderHook(() => usePreviewNavigation(session()));
  await act(() => result.current.navigation.onNavigate(1));
  expect(result.current.file).toEqual(fixtures[1]);
  expect(result.current.navigation.error).toContain("results changed");
  await act(() => result.current.navigation.onRetry());
  expect(result.current.file).toEqual(fixtures[2]);
  expect(result.current.navigation.error).toBe("");
});
