import { useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";

export function timeLabel(seconds: number) {
  const total = Math.floor(Number.isFinite(seconds) ? Math.max(0, seconds) : 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}

export async function playMedia(media: HTMLMediaElement) {
  try {
    await media.play();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    toast.error("Playback could not start. Try again or open the original file.");
  }
}

export function toggleMedia(media: HTMLMediaElement) {
  if (media.paused) void playMedia(media);
  else media.pause();
}

function readMedia(media: HTMLMediaElement | null) {
  const duration = media && Number.isFinite(media.duration) ? media.duration : 0;
  return {
    playing: !!media && !media.paused && !media.ended,
    current: media?.currentTime || 0,
    duration,
    volume: media?.volume ?? 1,
    muted: media?.muted || media?.volume === 0,
    speed: media?.playbackRate || 1,
    buffered: media && media.buffered.length && duration ? Math.min(100, 100 * media.buffered.end(media.buffered.length - 1) / duration) : 0,
    error: !!media?.error,
  };
}

export function useMediaState(media: HTMLMediaElement | null) {
  const [state, setState] = useState(() => readMedia(media));
  useEffect(() => {
    const update = () => setState(readMedia(media));
    const events = ["timeupdate", "durationchange", "loadedmetadata", "volumechange", "ratechange", "progress", "play", "pause", "ended", "seeked", "error", "emptied"];
    update();
    events.forEach(event => media?.addEventListener(event, update));
    return () => events.forEach(event => media?.removeEventListener(event, update));
  }, [media]);
  function showPosition(position: number) {
    setState(previous => ({ ...previous, current: position }));
  }
  return { ...state, showPosition };
}

export function MediaControls({ media, onToggle }: { media: HTMLMediaElement | null; onToggle: () => void }) {
  const { playing, current, duration, volume, muted, speed, buffered, error, showPosition } = useMediaState(media);
  const [scrub, setScrub] = useState<number | null>(null);
  const pointerSeeking = useRef(false);
  const endPointerSeek = () => { pointerSeeking.current = false; setScrub(null); };
  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
  return <div className="preview-playback-controls" aria-label="Media controls">
    <div className="preview-timeline">
      <span className="preview-time">{timeLabel(scrub ?? current)}</span>
      <div className="preview-seek">
        <span className="preview-buffer" aria-hidden="true" style={{ width: `${buffered}%` }} />
        <Slider aria-label="Seek" aria-valuetext={`${timeLabel(scrub ?? current)} of ${timeLabel(duration)}`}
          value={[scrub ?? current]} min={0} max={duration || 1} step={1} disabled={!duration || error}
          onPointerDown={() => { pointerSeeking.current = true; }}
          onValueChange={([value]) => {
            if (pointerSeeking.current) setScrub(value);
            else showPosition(value);
          }}
          onPointerCancel={endPointerSeek} onPointerUp={endPointerSeek} onLostPointerCapture={endPointerSeek}
          onValueCommit={([value]) => {
            if (media) media.currentTime = value;
            showPosition(value);
            setScrub(null);
          }} />
      </div>
      <span className="preview-time">{duration ? timeLabel(duration) : "--:--"}</span>
    </div>
    <div className="preview-control-row">
      <Button variant="secondary" size="icon" aria-label={playing ? "Pause" : "Play"}
        disabled={error} onClick={onToggle}>{playing ? <Pause /> : <Play />}</Button>
      <Button variant="ghost" size="icon" aria-label={muted ? "Unmute" : "Mute"} disabled={!media}
        aria-pressed={muted} onClick={() => {
          if (!media) return;
          if (muted && !media.volume) media.volume = 1;
          media.muted = !muted;
        }}>{muted ? <VolumeX /> : <Volume2 />}</Button>
      <Slider className="preview-volume" aria-label="Volume" disabled={!media}
        aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)} percent`}
        value={[muted ? 0 : volume]} min={0} max={1} step={0.05}
        onValueChange={([value]) => { if (media) { media.volume = value; media.muted = false; } }} />
      <Button variant="outline" className="preview-speed" disabled={!media}
        aria-label={`Playback speed: ${speed}×. Change playback speed`}
        title="Change playback speed: 0.5×, 0.75×, 1×, 1.25×, 1.5×, 2×"
        onClick={() => { if (media) media.playbackRate = speeds[(speeds.indexOf(speed) + 1) % speeds.length]; }}>{speed}×</Button>
    </div>
  </div>;
}
