import { useEffect, useRef, useState, type RefObject } from "react";
import {
  Download, ExternalLink, File, Link, LoaderCircle, Maximize, Minimize,
  Music, Pause, Play, RotateCcw, Scan, Volume2, VolumeX, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { bytes, shareURL } from "@/lib/api";
import type { SharedFile } from "@/lib/types";
import "./preview.css";

type FullscreenVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
};

function timeLabel(seconds: number) {
  const total = Math.floor(Number.isFinite(seconds) ? Math.max(0, seconds) : 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}

// Playback updates stay here so the dialog and its actions do not render on every timeupdate.
function MediaPlayer({ file, mediaRef }: {
  file: SharedFile;
  mediaRef: RefObject<HTMLMediaElement | null>;
}) {
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [buffered, setBuffered] = useState(0);
  const scrubbing = useRef(false);
  const video = file.category === "video";
  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];

  useEffect(() => {
    const media = mediaRef.current;
    // Strict Mode replays effects after cleanup; restore the source for that setup.
    if (media && !media.getAttribute("src")) {
      media.src = shareURL(file.uniqueID, "v");
      media.load();
    }
    return () => {
      if (!media) return;
      media.pause();
      if ((media as FullscreenVideo).webkitDisplayingFullscreen)
        (media as FullscreenVideo).webkitExitFullscreen?.();
      media.removeAttribute("src");
      media.load();
    };
  }, [file.uniqueID, mediaRef]);

  function updateDuration(media: HTMLMediaElement) {
    setDuration(Number.isFinite(media.duration) ? media.duration : 0);
    setLoading(false);
  }

  async function togglePlayback() {
    const media = mediaRef.current;
    if (!media) return;
    if (!media.paused) {
      media.pause();
      return;
    }
    try {
      await media.play();
    } catch {
      toast.error("Playback could not start. Try again or open the original file.");
      setLoading(false);
    }
  }

  function finishScrubbing() {
    scrubbing.current = false;
    if (mediaRef.current) setCurrent(mediaRef.current.currentTime);
  }

  const mediaEvents = {
    onLoadedMetadata: (event: React.SyntheticEvent<HTMLMediaElement>) => updateDuration(event.currentTarget),
    onDurationChange: (event: React.SyntheticEvent<HTMLMediaElement>) => updateDuration(event.currentTarget),
    onTimeUpdate: (event: React.SyntheticEvent<HTMLMediaElement>) => {
      if (!scrubbing.current) setCurrent(event.currentTarget.currentTime);
    },
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => { setPlaying(false); setLoading(false); },
    onWaiting: () => setLoading(true),
    onSeeking: () => setLoading(true),
    onSeeked: () => setLoading(false),
    onPlaying: () => setLoading(false),
    onCanPlay: () => setLoading(false),
    onVolumeChange: (event: React.SyntheticEvent<HTMLMediaElement>) => {
      setVolume(event.currentTarget.volume);
      setMuted(event.currentTarget.muted);
    },
    onRateChange: (event: React.SyntheticEvent<HTMLMediaElement>) => setSpeed(event.currentTarget.playbackRate),
    onProgress: (event: React.SyntheticEvent<HTMLMediaElement>) => {
      const media = event.currentTarget;
      if (media.buffered.length && Number.isFinite(media.duration) && media.duration > 0)
        setBuffered(Math.min(100, media.buffered.end(media.buffered.length - 1) / media.duration * 100));
    },
    onError: () => {
      setError("This media could not be played. Open the original file or download it to use another player.");
      setPlaying(false);
      setLoading(false);
    },
  };

  return (
    <div className="preview-player">
      <div className={`preview-stage ${video ? "preview-video-stage" : "preview-audio-stage"}`}>
        {video ? (
          <video
            ref={(element) => { mediaRef.current = element; }}
            src={shareURL(file.uniqueID, "v")}
            playsInline preload="metadata" aria-label={file.fileName}
            {...mediaEvents}
          />
        ) : (
          <>
            <audio
              ref={(element) => { mediaRef.current = element; }}
              src={shareURL(file.uniqueID, "v")}
              preload="metadata" aria-label={file.fileName}
              {...mediaEvents}
            />
            <div className="preview-audio-art" aria-hidden="true"><Music /></div>
          </>
        )}
        {loading && !error && (
          <Badge variant="secondary" className="preview-loading" role="status"><LoaderCircle className="animate-spin" />Loading media…</Badge>
        )}
        {error && (
          <Alert className="preview-error"><AlertDescription>
              <p>{error}</p>
              <Button variant="secondary" onClick={() => {
                setError(""); setLoading(true); setBuffered(0); mediaRef.current?.load();
              }}><RotateCcw />Try again</Button>
          </AlertDescription></Alert>
        )}
      </div>
      <div className="preview-playback-controls" aria-label="Media controls">
        <div className="preview-timeline">
          <span className="preview-time">{timeLabel(current)}</span>
          <div className="preview-seek">
            <span className="preview-buffer" aria-hidden="true" style={{ width: `${buffered}%` }} />
            <Slider
              aria-label="Seek" aria-valuetext={`${timeLabel(current)} of ${timeLabel(duration)}`}
              value={[current]} min={0} max={duration || 1} step={1} disabled={!duration || !!error}
              onPointerDown={() => { scrubbing.current = true; }}
              onPointerUp={finishScrubbing}
              onPointerCancel={finishScrubbing}
              onLostPointerCapture={finishScrubbing}
              onValueChange={([value]) => setCurrent(value)}
              onValueCommit={([value]) => {
                const media = mediaRef.current;
                if (media) media.currentTime = value;
                setCurrent(value);
              }}
            />
          </div>
          <span className="preview-time">{duration ? timeLabel(duration) : "--:--"}</span>
        </div>
        <div className="preview-control-row">
          <Button variant="secondary" size="icon" aria-label={playing ? "Pause" : "Play"}
            disabled={!!error} onClick={togglePlayback}>{playing ? <Pause /> : <Play />}</Button>
          <Button variant="ghost" size="icon" aria-label={muted || !volume ? "Unmute" : "Mute"}
            aria-pressed={muted || !volume}
            onClick={() => {
              const media = mediaRef.current;
              if (!media) return;
              if (media.muted || media.volume === 0) {
                if (!media.volume) media.volume = 1;
                media.muted = false;
              } else media.muted = true;
            }}>{muted || !volume ? <VolumeX /> : <Volume2 />}</Button>
          <Slider className="preview-volume" aria-label="Volume"
            aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)} percent`}
            value={[muted ? 0 : volume]} min={0} max={1} step={0.05}
            onValueChange={([value]) => {
              const media = mediaRef.current;
              if (media) { media.volume = value; media.muted = false; }
            }} />
          <Button variant="outline" className="preview-speed"
            aria-label={`Playback speed: ${speed}×. Change playback speed`}
            title="Change playback speed: 0.5×, 0.75×, 1×, 1.25×, 1.5×, 2×"
            onClick={() => {
              if (mediaRef.current)
                mediaRef.current.playbackRate = speeds[(speeds.indexOf(speed) + 1) % speeds.length];
            }}>{speed}×</Button>
        </div>
      </div>
    </div>
  );
}

function ImagePreview({ file }: { file: SharedFile }) {
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  return (
    <div className="preview-stage preview-image-stage">
      {!failed && <img src={shareURL(file.uniqueID, "v")} alt={file.fileName}
        onLoad={() => setLoading(false)} onError={() => { setFailed(true); setLoading(false); }} />}
      {loading && <Badge variant="secondary" className="preview-loading" role="status"><LoaderCircle className="animate-spin" />Loading image…</Badge>}
      {failed && <Alert className="preview-error"><AlertDescription>This image could not be loaded. Open the original file or download it to view it.</AlertDescription></Alert>}
    </div>
  );
}

export function FilePreview({ file, onClose }: { file: SharedFile | null; onClose: () => void }) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [previousFile, setPreviousFile] = useState(file);
  const [expanded, setExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // Reset before rendering a different file, including reopening a closed preview.
  if (previousFile !== file) {
    setPreviousFile(file);
    setExpanded(false);
  }

  useEffect(() => {
    const viewer = viewerRef.current;
    if (viewer && document.fullscreenElement === viewer)
      void document.exitFullscreen().catch(() => {});
    return () => {
      if (viewer && document.fullscreenElement === viewer)
        void document.exitFullscreen().catch(() => {});
    };
  }, [file?.uniqueID]);

  useEffect(() => {
    function syncFullscreen() {
      setFullscreen(!!document.fullscreenElement && document.fullscreenElement === viewerRef.current);
    }
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  function closePreview() {
    mediaRef.current?.pause();
    if (document.fullscreenElement === viewerRef.current && document.exitFullscreen)
      void document.exitFullscreen().catch(() => {});
    onClose();
  }

  async function toggleFullscreen() {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (document.fullscreenElement === viewer) {
      await document.exitFullscreen().catch(() => {});
      return;
    }
    try {
      if (viewer.requestFullscreen) {
        await viewer.requestFullscreen();
        return;
      }
    } catch { /* Fall back to iOS video fullscreen or viewport expansion. */ }
    const video = mediaRef.current as FullscreenVideo | null;
    if (file?.category === "video" && video?.webkitEnterFullscreen) {
      try { video.webkitEnterFullscreen(); return; } catch { /* Metadata may not be ready yet. */ }
    }
    setExpanded(true);
    toast.info("Preview expanded. Fullscreen is unavailable in this browser.");
  }

  async function copyLink() {
    if (!file) return;
    try {
      await navigator.clipboard.writeText(shareURL(file.uniqueID, "v"));
      toast.success("View link copied");
    } catch {
      toast.error("Could not copy the link. Open the original file to copy its address.");
    }
  }

  return (
    <Dialog open={!!file} onOpenChange={(open) => { if (!open) closePreview(); }}>
      <DialogContent ref={viewerRef} className="file-preview-dialog" showCloseButton={false}
        data-expanded={expanded || fullscreen}
        onOpenAutoFocus={() => {
          if (document.activeElement instanceof HTMLElement && !viewerRef.current?.contains(document.activeElement))
            previousFocus.current = document.activeElement;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (previousFocus.current?.isConnected) previousFocus.current.focus();
        }}>
        {file && <>
          <header className="preview-header">
            <div className="preview-heading">
              <DialogTitle title={file.fileName}>{file.fileName}</DialogTitle>
              <DialogDescription>{bytes(file.fileSize)} · {file.fileType || file.category}</DialogDescription>
            </div>
            <div className="preview-window-actions">
              <Button variant="ghost" size="icon" aria-label={expanded || fullscreen ? "Restore preview size" : "Maximize preview"}
                aria-pressed={expanded || fullscreen} onClick={() => {
                  if (fullscreen) void document.exitFullscreen().catch(() => {});
                  setExpanded(fullscreen ? false : !expanded);
                }}>
                {expanded || fullscreen ? <Minimize /> : <Maximize />}
              </Button>
              <Button variant="ghost" size="icon" aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                aria-pressed={fullscreen} onClick={toggleFullscreen}><Scan /></Button>
              <Button variant="ghost" size="icon" aria-label="Close preview" onClick={closePreview}><X /></Button>
            </div>
          </header>
          <div className="preview-body">
            {file.category === "photo" || file.category === "gif" ? <ImagePreview key={file.uniqueID} file={file} />
              : file.category === "video" || file.category === "audio" ? <MediaPlayer key={file.uniqueID} file={file} mediaRef={mediaRef} />
              : <div className="preview-stage preview-unsupported"><File aria-hidden="true" /><p>Open or download this file to view it.</p></div>}
          </div>
          <footer className="preview-file-actions" aria-label="File actions">
            <Button variant="outline" asChild><a href={shareURL(file.uniqueID, "v")} target="_blank" rel="noopener noreferrer"
              aria-label="Open original file in a new tab"><ExternalLink />Open original</a></Button>
            <Button variant="outline" onClick={copyLink}><Link />Copy link</Button>
            <Button variant="default" asChild><a href={shareURL(file.uniqueID, "d")} download={file.fileName}><Download />Download</a></Button>
          </footer>
        </>}
      </DialogContent>
    </Dialog>
  );
}
