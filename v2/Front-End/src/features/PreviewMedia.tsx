import { useCallback, useEffect, useState, type ReactNode, type RefObject } from "react";
import { LoaderCircle, Music, RotateCcw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { shareURL } from "@/lib/api";
import type { SharedFile } from "@/lib/types";
import { MediaControls, toggleMedia } from "./MediaControls";
import { usePersistentAudio } from "./PersistentAudio";

export type FullscreenVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
};

function MediaStatus({ media }: { media: HTMLMediaElement | null }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!media) return;
    const ready = () => { setLoading(false); setError(false); };
    const waiting = () => { setLoading(true); setError(false); };
    const failed = () => { setLoading(false); setError(true); };
    const events: [string, () => void][] = [
      ["loadedmetadata", ready], ["canplay", ready], ["playing", ready], ["seeked", ready],
      ["ended", ready], ["waiting", waiting], ["loadstart", waiting], ["error", failed],
    ];
    if (media.error) failed();
    else if (media.readyState >= 1) ready();
    else waiting();
    events.forEach(([name, handler]) => media.addEventListener(name, handler));
    return () => events.forEach(([name, handler]) => media.removeEventListener(name, handler));
  }, [media]);
  if (!media) return null;
  if (error) return <Alert className="preview-error"><AlertDescription>
    <p>This media could not be played. Open the original file or download it to use another player.</p>
    <Button variant="secondary" onClick={() => { setError(false); setLoading(true); media.load(); }}><RotateCcw />Try again</Button>
  </AlertDescription></Alert>;
  return loading && <Badge variant="secondary" className="preview-loading" role="status"><LoaderCircle className="animate-spin" />Loading media…</Badge>;
}

export function AudioPreview({ file, children }: { file: SharedFile; children?: ReactNode }) {
  const player = usePersistentAudio();
  const { prepare, releasePreview } = player;
  useEffect(() => {
    prepare(file);
    return () => releasePreview(file.uniqueID);
  }, [file, prepare, releasePreview]);
  const media = player.file?.uniqueID === file.uniqueID ? player.media : null;
  return <div className="preview-player">
    <div className="preview-stage preview-audio-stage">
      <div className="preview-audio-art" aria-hidden="true"><Music /></div>
      <MediaStatus media={media} />
      {children}
    </div>
    <MediaControls media={media} onToggle={() => player.toggle(file)} />
  </div>;
}

export function VideoPreview({ file, videoRef, restoreFocus, children }: {
  file: SharedFile;
  videoRef: RefObject<FullscreenVideo | null>;
  restoreFocus: () => void;
  children?: ReactNode;
}) {
  const [video, setVideo] = useState<FullscreenVideo | null>(null);
  const attach = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element;
    setVideo(element);
  }, [videoRef]);
  const { pauseForVideo } = usePersistentAudio();

  useEffect(() => {
    if (!video) return;
    if (!video.hasAttribute("src")) {
      video.src = shareURL(file.uniqueID, "v");
      video.load();
    }
    function sync(active: boolean) {
      if (!video) return;
      const leavingNativeControls = video.controls && !active;
      video.controls = active;
      if (leavingNativeControls) restoreFocus();
    }
    const standard = () => sync(document.fullscreenElement === video);
    const entered = () => sync(true);
    const exited = () => sync(false);
    document.addEventListener("fullscreenchange", standard);
    video.addEventListener("webkitbeginfullscreen", entered);
    video.addEventListener("webkitendfullscreen", exited);
    return () => {
      document.removeEventListener("fullscreenchange", standard);
      video.removeEventListener("webkitbeginfullscreen", entered);
      video.removeEventListener("webkitendfullscreen", exited);
      video.pause();
      if (document.fullscreenElement === video) void document.exitFullscreen().catch(() => {});
      if (video.webkitDisplayingFullscreen) video.webkitExitFullscreen?.();
      video.removeAttribute("src");
      video.load();
    };
  }, [video, file.uniqueID, restoreFocus]);
  return <div className="preview-player">
    <div className="preview-stage preview-video-stage">
      <video ref={attach} src={shareURL(file.uniqueID, "v")} playsInline preload="metadata" aria-label={file.fileName} onPlay={pauseForVideo} />
      <MediaStatus media={video} />
      {children}
    </div>
    <MediaControls media={video} onToggle={() => { if (video) toggleMedia(video); }} />
  </div>;
}
