import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Music, Pause, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { shareURL } from "@/lib/api";
import type { SharedFile } from "@/lib/types";
import { playMedia, timeLabel, useMediaState } from "./MediaControls";
import "./preview.css";

interface AudioPlayer {
  media: HTMLAudioElement | null;
  file: SharedFile | null;
  started: boolean;
  prepare: (file: SharedFile) => void;
  releasePreview: (id: string) => void;
  toggle: (file: SharedFile) => void;
  stop: () => void;
  pauseForVideo: () => void;
}

const AudioContext = createContext<AudioPlayer | null>(null);

export function usePersistentAudio() {
  const player = useContext(AudioContext);
  if (!player) throw new Error("The audio player requires a signed-in audio provider.");
  return player;
}

export function notifyAudioFilesDeleted(ids: readonly string[]) {
  window.dispatchEvent(new CustomEvent("fileshare:files-deleted", { detail: ids }));
}

function releaseAudio(media: HTMLAudioElement | null) {
  if (!media?.hasAttribute("src")) return;
  media.pause();
  media.removeAttribute("src");
  media.load();
}

function useSystemPlayback(media: HTMLAudioElement | null, file: SharedFile | null, stop: () => void) {
  useEffect(() => {
    const session = navigator.mediaSession;
    if (!session || !media || !file) return;
    if (typeof MediaMetadata === "function") {
      session.metadata = new MediaMetadata({
        title: file.fileName,
        artwork: [192, 512].map(size => ({ src: `/icon-${size}.png`, sizes: `${size}x${size}`, type: "image/png" })),
      });
    }

    function seek(value: number) {
      if (media && Number.isFinite(media.duration) && Number.isFinite(value))
        media.currentTime = Math.max(0, Math.min(media.duration, value));
    }
    const actions: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
      play: () => void playMedia(media),
      pause: () => media.pause(),
      stop,
      seekto: ({ seekTime }) => { if (seekTime !== undefined) seek(seekTime); },
      seekbackward: ({ seekOffset }) => seek(media.currentTime - (seekOffset ?? 10)),
      seekforward: ({ seekOffset }) => seek(media.currentTime + (seekOffset ?? 10)),
    };
    const supported: MediaSessionAction[] = [];
    for (const action of Object.keys(actions) as MediaSessionAction[]) {
      try {
        session.setActionHandler(action, actions[action]!);
        supported.push(action);
      } catch { /* Browsers support different system transport actions. */ }
    }
    const sync = () => {
      session.playbackState = media.paused || media.ended ? "paused" : "playing";
      if (Number.isFinite(media.duration) && media.duration > 0 && media.playbackRate > 0) {
        session.setPositionState?.({ duration: media.duration, playbackRate: media.playbackRate, position: Math.max(0, Math.min(media.duration, media.currentTime)) });
      }
    };
    const events = ["play", "pause", "ended", "loadedmetadata", "durationchange", "seeked", "ratechange", "timeupdate"];
    events.forEach(event => media.addEventListener(event, sync));
    sync();
    return () => {
      events.forEach(event => media.removeEventListener(event, sync));
      supported.forEach(action => session.setActionHandler(action, null));
      session.metadata = null;
      session.playbackState = "none";
      session.setPositionState?.();
    };
  }, [media, file, stop]);
}

export function PersistentAudioProvider({ children }: { children: ReactNode }) {
  const [media, setMedia] = useState<HTMLAudioElement | null>(null);
  const [file, setFile] = useState<SharedFile | null>(null);
  const [started, setStarted] = useState(false);
  const [systemOwner, setSystemOwner] = useState(false);
  // Gesture handlers and preview cleanup can run before React renders the new track.
  const selected = useRef<SharedFile | null>(null);
  const userStarted = useRef(false);

  const select = useCallback((next: SharedFile) => {
    if (!media || selected.current?.uniqueID === next.uniqueID) return;
    if (!media.paused) media.pause();
    selected.current = next;
    setFile(next);
    media.src = shareURL(next.uniqueID, "v");
    media.load();
  }, [media]);

  const prepare = useCallback((next: SharedFile) => {
    if (!userStarted.current) select(next);
  }, [select]);

  const stop = useCallback(() => {
    userStarted.current = false;
    selected.current = null;
    setStarted(false);
    setSystemOwner(false);
    setFile(null);
    releaseAudio(media);
  }, [media]);

  const releasePreview = useCallback((id: string) => {
    if (selected.current?.uniqueID === id && !userStarted.current) stop();
  }, [stop]);

  const toggle = useCallback((next: SharedFile) => {
    if (!media) return;
    if (selected.current?.uniqueID === next.uniqueID && !media.paused) {
      media.pause();
      return;
    }
    select(next);
    userStarted.current = true;
    setStarted(true);
    setSystemOwner(true);
    if (media.error) media.load();
    void playMedia(media);
  }, [media, select]);

  const pauseForVideo = useCallback(() => {
    if (media && !media.paused) media.pause();
    setSystemOwner(false);
  }, [media]);

  useSystemPlayback(media, systemOwner ? file : null, stop);

  useEffect(() => () => releaseAudio(media), [media]);
  useEffect(() => {
    function deleted(event: Event) {
      const ids = (event as CustomEvent<readonly string[]>).detail;
      if (selected.current && ids.includes(selected.current.uniqueID)) stop();
    }
    window.addEventListener("fileshare:files-deleted", deleted);
    return () => window.removeEventListener("fileshare:files-deleted", deleted);
  }, [stop]);

  const player = useMemo(() => ({ media, file, started, toggle, stop, prepare, releasePreview, pauseForVideo }),
    [media, file, started, toggle, stop, prepare, releasePreview, pauseForVideo]);
  return <AudioContext.Provider value={player}>
    <audio ref={setMedia} preload="metadata" aria-label={file?.fileName || "Audio playback"} />
    {children}
  </AudioContext.Provider>;
}

export function AudioMiniPlayer() {
  const player = useContext(AudioContext);
  const { playing, current, duration, error } = useMediaState(player?.started ? player.media : null);
  if (!player?.file || !player.started) return null;
  const { media, file, toggle, stop } = player;
  return <section className="audio-mini-player" aria-label="Audio player">
    <Music aria-hidden="true" />
    <span className="audio-mini-title" title={file.fileName}>{file.fileName}</span>
    <Button variant="ghost" size="icon" aria-label={playing ? "Pause" : "Play"} onClick={() => toggle(file)}>
      {playing ? <Pause /> : <Play />}
    </Button>
    <Slider aria-label="Seek audio" aria-valuetext={`${timeLabel(current)} of ${timeLabel(duration)}`}
      value={[current]} min={0} max={duration || 1} step={1} disabled={!duration || error}
      onValueChange={([value]) => { if (media) media.currentTime = value; }} />
    <span className="preview-time">{timeLabel(current)}</span>
    <Button variant="ghost" size="icon" aria-label="Stop audio" title="Stop audio" onClick={stop}><X /></Button>
  </section>;
}
