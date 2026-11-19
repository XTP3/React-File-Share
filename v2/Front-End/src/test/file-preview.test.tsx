import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FilePreview, type PreviewNavigation } from "@/features/FilePreview";
import { AudioMiniPlayer, PersistentAudioProvider, notifyAudioFilesDeleted } from "@/features/PersistentAudio";
import type { SharedFile } from "@/lib/types";

const file: SharedFile = {
  _id: "1", uniqueID: "first", fileName: "first.zip", fileSize: 20, category: "archive", fileType: "application/zip",
  uploaderID: "owner", timeOfUpload: 1700000000000, timeOfUploadDate: "2023-11-14",
};
const audioFile: SharedFile = { ...file, fileName: "song.wav", category: "audio", fileType: "audio/wav" };
const videoFile: SharedFile = { ...file, uniqueID: "video", fileName: "movie.webm", category: "video", fileType: "video/webm" };
const nav = (): PreviewNavigation => ({ position: 2, total: 3, loading: false, error: "", onNavigate: vi.fn(), onRetry: vi.fn() });

function preview(file: SharedFile | null, navigation: PreviewNavigation, session = "user") {
  return <TooltipProvider><PersistentAudioProvider key={session}>
    <AudioMiniPlayer /><FilePreview file={file} onClose={vi.fn()} navigation={navigation} />
  </PersistentAudioProvider></TooltipProvider>;
}

function mockPlayback() {
  const playing = new WeakSet<HTMLMediaElement>();
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(function (this: HTMLMediaElement) {
    return !playing.has(this);
  });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    playing.add(this);
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    playing.delete(this);
    this.dispatchEvent(new Event("pause"));
  });
  return play;
}

it("supports preview arrow keys and preserves expansion while changing files", () => {
  const navigation = nav();
  const ui = render(preview(file, navigation));
  expect(screen.getByRole("dialog")).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
  expect(navigation.onNavigate).toHaveBeenCalledWith(1);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowLeft" });
  expect(navigation.onNavigate).toHaveBeenCalledWith(-1);
  fireEvent.click(screen.getByRole("button", { name: "Maximize preview" }));
  ui.rerender(preview({ ...file, uniqueID: "second", fileName: "second.zip" }, { ...navigation, position: 3 }));
  expect(screen.getByRole("dialog")).toHaveAttribute("data-expanded", "true");
  expect(screen.getByRole("button", { name: "Next file" })).toBeDisabled();
  expect(screen.getByRole("link", { name: "Open original file in a new tab" })).toHaveAttribute("href", expect.stringContaining("/f/v/second"));
  expect(screen.queryByRole("button", { name: "Enter fullscreen" })).toBeNull();
});

it("shows the full filename in details and returns focus to the preview menu", async () => {
  const user = userEvent.setup();
  const name = "Long filename ".repeat(24) + ".zip";
  render(<QueryClientProvider client={new QueryClient()}>{preview({ ...file, fileName: name }, nav())}</QueryClientProvider>);
  const more = screen.getByRole("button", { name: "More preview actions" });
  await user.click(more);
  await user.click(screen.getByRole("menuitem", { name: "File details" }));
  const details = screen.getByRole("dialog", { name: "File details" });
  expect(within(details).getByText(name)).toBeVisible();
  await user.click(within(details).getByRole("button", { name: "Done" }));
  await waitFor(() => expect(more).toHaveFocus());
});

it("retains user-started audio across navigation and closing, preserving interactive key bindings", () => {
  const play = mockPlayback();
  const navigation = nav();
  const ui = render(preview(audioFile, navigation));
  const media = document.querySelector("audio")!;
  Object.defineProperty(media, "duration", { value: 120 });
  fireEvent.loadedMetadata(media);
  const seek = screen.getByRole("slider", { name: "Seek" });
  fireEvent.keyDown(seek, { key: "ArrowRight" });
  fireEvent.keyDown(seek, { key: "ArrowRight" });
  expect(media.currentTime).toBe(2);
  expect(seek).toHaveAttribute("aria-valuenow", "2");
  fireEvent.keyDown(screen.getByRole("button", { name: "Next file" }), { key: " " });
  expect(navigation.onNavigate).not.toHaveBeenCalled();
  expect(play).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: " " });
  expect(play).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Next file" }));
  const next = { ...audioFile, uniqueID: "next", fileName: "next.wav" };
  ui.rerender(preview(next, navigation));
  expect(document.querySelectorAll("audio")).toHaveLength(1);
  expect(media.src).toContain("/first");
  expect(media.paused).toBe(false);
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Play" }));
  expect(media.src).toContain("/next");
  ui.rerender(preview(null, navigation));
  const mini = screen.getByRole("region", { name: "Audio player" });
  expect(within(mini).getByText(next.fileName)).toBeVisible();
  expect(media.paused).toBe(false);
  fireEvent.click(within(mini).getByRole("button", { name: "Pause" }));
  expect(media.paused).toBe(true);
  fireEvent.click(within(mini).getByRole("button", { name: "Play" }));
  act(() => notifyAudioFilesDeleted(["first"]));
  expect(media.paused).toBe(false);
  act(() => notifyAudioFilesDeleted(["next"]));
  expect(media).not.toHaveAttribute("src");
  expect(screen.queryByRole("region", { name: "Audio player" })).toBeNull();
});

it("uses video-element fullscreen, keeps its position, and releases media when the account changes", async () => {
  mockPlayback();
  const navigation = nav();
  const ui = render(preview(audioFile, navigation));
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  const audio = document.querySelector("audio")!;
  ui.rerender(preview(videoFile, navigation));
  expect(audio.paused).toBe(false);
  const movie = document.querySelector("video")!;
  fireEvent.keyDown(screen.getByRole("dialog"), { key: " " });
  expect(audio.paused).toBe(true);
  movie.currentTime = 37;
  const request = vi.fn(async () => {
    Object.defineProperty(document, "fullscreenElement", { value: movie, configurable: true });
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  movie.requestFullscreen = request;
  fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
  expect(request).toHaveBeenCalledOnce();
  expect(movie.controls).toBe(true);
  Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
  fireEvent(document, new Event("fullscreenchange"));
  expect(movie.controls).toBe(false);
  expect(movie.currentTime).toBe(37);
  ui.rerender(preview(null, navigation, "another-user"));
  expect(movie.paused).toBe(true);
  expect(movie).not.toHaveAttribute("src");
  expect(audio).not.toHaveAttribute("src");
  expect(screen.queryByRole("region", { name: "Audio player" })).toBeNull();
});

it("handles Safari native fullscreen entry and exit through the existing video element", () => {
  mockPlayback();
  render(preview(videoFile, nav()));
  const movie = document.querySelector("video")!;
  const enter = vi.fn(() => movie.dispatchEvent(new Event("webkitbeginfullscreen")));
  Object.assign(movie, { requestFullscreen: undefined, webkitEnterFullscreen: enter });
  movie.currentTime = 11;
  fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
  expect(enter).toHaveBeenCalledOnce();
  expect(movie.controls).toBe(true);
  fireEvent(movie, new Event("webkitendfullscreen"));
  expect(movie.controls).toBe(false);
  expect(movie.currentTime).toBe(11);
});

it("registers system transport for the started track and relinquishes it for video or sign-out", () => {
  mockPlayback();
  const handlers = new Map<MediaSessionAction, MediaSessionActionHandler | null>();
  const session = {
    metadata: null,
    setActionHandler: (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => handlers.set(action, handler),
    setPositionState: vi.fn(),
    playbackState: "none",
  };
  Object.defineProperty(navigator, "mediaSession", { configurable: true, value: session });
  vi.stubGlobal("MediaMetadata", class {
    constructor(data: MediaMetadataInit) { Object.assign(this, data); }
  });
  try {
    const navigation = nav();
    const ui = render(preview(audioFile, navigation));
    const media = document.querySelector("audio")!;
    Object.defineProperty(media, "duration", { value: 25 });
    expect(handlers.size).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(session.metadata).toMatchObject({ title: audioFile.fileName });
    expect(session.playbackState).toBe("playing");
    act(() => handlers.get("pause")?.({ action: "pause" }));
    expect(media.paused).toBe(true);
    act(() => handlers.get("seekto")?.({ action: "seekto", seekTime: 20 }));
    act(() => handlers.get("seekforward")?.({ action: "seekforward", seekOffset: 10 }));
    expect(media.currentTime).toBe(25);
    act(() => handlers.get("seekbackward")?.({ action: "seekbackward", seekOffset: 5 }));
    expect(media.currentTime).toBe(20);
    act(() => handlers.get("play")?.({ action: "play" }));
    expect(media.paused).toBe(false);
    fireEvent.timeUpdate(media);
    expect(session.setPositionState).toHaveBeenCalledWith({ duration: 25, position: 20, playbackRate: 1 });
    ui.rerender(preview(videoFile, navigation));
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(media.paused).toBe(true);
    expect(session.metadata).toBeNull();
    expect([...handlers.values()].every(handler => handler === null)).toBe(true);
    ui.rerender(preview(audioFile, navigation));
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(session.metadata).toMatchObject({ title: audioFile.fileName });
    ui.unmount();
    expect(session.playbackState).toBe("none");
    expect(session.metadata).toBeNull();
    expect([...handlers.values()].every(handler => handler === null)).toBe(true);
  } finally {
    Reflect.deleteProperty(navigator, "mediaSession");
    vi.unstubAllGlobals();
  }
});
