import { useCallback, useRef, useState, type ReactElement } from "react";
import { AppWindow, ChevronLeft, ChevronRight, Download, Ellipsis, ExternalLink, File, Fullscreen, Info, Link, LoaderCircle, PanelsTopLeft, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { bytes, shareURL } from "@/lib/api";
import type { PublicConfig, SharedFile } from "@/lib/types";
import { FileDetails } from "./FileDetails";
import { DocumentPreview, documentPreviewKind } from "./DocumentPreview";
import { AudioPreview, VideoPreview, type FullscreenVideo } from "./PreviewMedia";
import { toggleMedia } from "./MediaControls";
import { usePersistentAudio } from "./PersistentAudio";
import "./preview.css";

function ImagePreview({ file }: { file: SharedFile }) {
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  return <div className="preview-stage preview-image-stage">
    {!failed && <img src={shareURL(file.uniqueID, "v")} alt={file.fileName}
      onLoad={() => setLoading(false)} onError={() => { setFailed(true); setLoading(false); }} />}
    {loading && <Badge variant="secondary" className="preview-loading" role="status"><LoaderCircle className="animate-spin" />Loading image…</Badge>}
    {failed && <Alert className="preview-error"><AlertDescription>This image could not be loaded. Open the original file or download it to view it.</AlertDescription></Alert>}
  </div>;
}

function ActionHint({ label, container, children }: { label: string; container: HTMLElement | null; children: ReactElement }) {
  return <Tooltip disableHoverableContent>
    <TooltipTrigger asChild onFocus={event => event.preventDefault()}>{children}</TooltipTrigger>
    <TooltipContent side="bottom" container={container}>{label}</TooltipContent>
  </Tooltip>;
}

export interface PreviewNavigation {
  position: number;
  total: number;
  loading: boolean;
  error: string;
  onNavigate: (direction: -1 | 1) => void;
  onRetry: () => void;
}

const keyboardControls = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="slider"],[role="combobox"],[role="menu"],[role="menuitem"],[aria-haspopup],audio,video,iframe,[data-document-preview-scroll]';

export function FilePreview({ file, config, onClose, navigation }: {
  file: SharedFile | null;
  config?: PublicConfig;
  onClose: () => void;
  navigation?: PreviewNavigation;
}) {
  const [viewer, setViewer] = useState<HTMLDivElement | null>(null);
  const video = useRef<FullscreenVideo | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const moreButton = useRef<HTMLButtonElement | null>(null);
  const nativeButton = useRef<HTMLButtonElement | null>(null);
  const { toggle: toggleAudio } = usePersistentAudio();
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState<{ file: SharedFile; returnFocus: HTMLElement | null } | null>(null);

  const focusAfterFullscreen = useCallback(() => {
    const button = nativeButton.current?.getClientRects().length ? nativeButton.current : moreButton.current;
    button?.focus({ preventScroll: true });
  }, []);

  function closePreview() {
    video.current?.pause();
    setExpanded(false);
    setDetails(null);
    onClose();
  }

  function navigate(direction: -1 | 1) {
    if (!navigation || navigation.loading ||
        (direction === -1 && navigation.position <= 1) ||
        (direction === 1 && navigation.position >= navigation.total)) return;
    video.current?.pause();
    navigation.onNavigate(direction);
  }

  async function toggleFullscreen() {
    const movie = video.current;
    if (movie) {
      // Keep the inline element (and its clock) for the entire native player session.
      movie.controls = true;
      if (movie.requestFullscreen) {
        try { await movie.requestFullscreen(); return; } catch { /* Try Safari's native video API. */ }
      }
      if (movie.webkitEnterFullscreen) {
        try { movie.webkitEnterFullscreen(); return; } catch { /* The browser may require decoded metadata. */ }
      }
      movie.controls = false;
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

  const isMedia = file?.category === "video" || file?.category === "audio";
  const stageNavigation = navigation && <nav className="preview-navigation" aria-label="Preview navigation">
    <Button variant="outline" size="icon" aria-label="Previous file" disabled={navigation.loading || navigation.position <= 1} onClick={() => navigate(-1)}><ChevronLeft /></Button>
    <Button variant="outline" size="icon" aria-label="Next file" disabled={navigation.loading || navigation.position >= navigation.total} onClick={() => navigate(1)}><ChevronRight /></Button>
  </nav>;
  return <Dialog open={!!file} onOpenChange={open => { if (!open) closePreview(); }}>
    <DialogContent ref={setViewer} className="file-preview-dialog" showCloseButton={false} data-expanded={expanded} tabIndex={-1}
      onEscapeKeyDown={event => {
        const movie = video.current;
        if (!movie || (document.fullscreenElement !== movie && !movie.webkitDisplayingFullscreen)) return;
        event.preventDefault();
        if (document.fullscreenElement === movie) void document.exitFullscreen().catch(() => {});
        else movie.webkitExitFullscreen?.();
      }}
      onKeyDown={event => {
        if (!file || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const target = event.target;
        if (!(target instanceof Element) || target.closest('[role="dialog"]') !== event.currentTarget || target.closest(keyboardControls)) return;
        if (event.key === " " && (file.category === "video" || file.category === "audio")) {
          if (target.closest('a,button,summary,[role="button"],[role="link"],[role="checkbox"],[tabindex="0"]') && target !== event.currentTarget) return;
          event.preventDefault();
          if (event.repeat || navigation?.loading) return;
          if (file.category === "audio") toggleAudio(file);
          else if (video.current) toggleMedia(video.current);
        } else if (navigation && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
          event.preventDefault();
          navigate(event.key === "ArrowLeft" ? -1 : 1);
        }
      }}
      onOpenAutoFocus={event => {
        if (document.activeElement instanceof HTMLElement) previousFocus.current = document.activeElement;
        event.preventDefault();
        (event.currentTarget as HTMLElement)?.focus?.({ preventScroll: true });
      }}
      onCloseAutoFocus={event => {
        event.preventDefault();
        if (previousFocus.current?.isConnected) previousFocus.current.focus();
      }}>
      {file && <>
        <header className="preview-header">
          <div className="preview-heading">
            <DialogTitle title={file.fileName}>{file.fileName}</DialogTitle>
            <DialogDescription>
              {navigation && <span className="preview-position" role="status" aria-live="polite">{navigation.position.toLocaleString()} / {navigation.total.toLocaleString()}</span>}
              {bytes(file.fileSize)} · {file.fileType || file.category}
            </DialogDescription>
          </div>
          <div className="preview-window-actions">
            <Button className="preview-desktop-action" variant="outline" asChild>
              <a href={shareURL(file.uniqueID, "v")} target="_blank" rel="noopener noreferrer" aria-label="Open original file in a new tab"><ExternalLink />Open original</a>
            </Button>
            <Button className="preview-desktop-action" variant="outline" asChild>
              <a href={shareURL(file.uniqueID, "d")} download={file.fileName}><Download />Download</a>
            </Button>
            <ActionHint container={viewer} label={expanded ? "Restore viewer size" : "Expand viewer to browser window"}>
              <Button className="preview-desktop-action preview-resize" variant="ghost" size="icon"
                aria-label={expanded ? "Restore preview size" : "Maximize preview"} aria-pressed={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? <PanelsTopLeft /> : <AppWindow />}</Button>
            </ActionHint>
            {file.category === "video" && <ActionHint container={viewer} label="Enter device fullscreen">
              <Button className="preview-desktop-action" ref={nativeButton} variant="ghost" size="icon" aria-label="Enter fullscreen"
                onClick={toggleFullscreen}><Fullscreen /></Button>
            </ActionHint>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button ref={moreButton} variant="ghost" size="icon" aria-label="More preview actions"><Ellipsis /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="preview-actions-menu">
                <DropdownMenuItem className="preview-mobile-action" asChild>
                  <a href={shareURL(file.uniqueID, "v")} target="_blank" rel="noopener noreferrer"><ExternalLink />Open original</a>
                </DropdownMenuItem>
                <DropdownMenuItem className="preview-mobile-action" asChild>
                  <a href={shareURL(file.uniqueID, "d")} download={file.fileName}><Download />Download</a>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={copyLink}><Link />Copy link</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDetails({ file, returnFocus: moreButton.current })}><Info />File details</DropdownMenuItem>
                {file.category === "video" && <DropdownMenuItem className="preview-mobile-action" onSelect={toggleFullscreen}><Fullscreen />Enter fullscreen</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
            <ActionHint container={viewer} label="Close preview">
              <Button variant="ghost" size="icon" aria-label="Close preview" onClick={closePreview}><X /></Button>
            </ActionHint>
          </div>
        </header>
        <div className="preview-body" aria-busy={navigation?.loading || false}>
          <div className="preview-content" inert={navigation?.loading || undefined} data-loading={navigation?.loading || undefined}>
            {file.category === "photo" || file.category === "gif" ? <ImagePreview key={file.uniqueID} file={file} />
              : file.category === "video" ? <VideoPreview key={file.uniqueID} file={file} videoRef={video} restoreFocus={focusAfterFullscreen}>{stageNavigation}</VideoPreview>
              : file.category === "audio" ? <AudioPreview key={file.uniqueID} file={file}>{stageNavigation}</AudioPreview>
              : documentPreviewKind(file) ? <DocumentPreview key={file.uniqueID} file={file} />
              : <div className="preview-stage preview-unsupported"><File aria-hidden="true" /><p>Open or download this file to view it.</p></div>}
          </div>
          {!isMedia && stageNavigation}
          {navigation?.loading && <Badge variant="secondary" className="preview-navigation-loading" role="status"><LoaderCircle className="animate-spin" />Loading file…</Badge>}
          {navigation?.error && <Alert className="preview-navigation-error" variant="destructive"><AlertDescription>
            <p>{navigation.error}</p>
            <Button variant="outline" onClick={navigation.onRetry}><RotateCcw />Retry</Button>
          </AlertDescription></Alert>}
        </div>
        {details && <FileDetails file={details.file} config={config} returnFocus={details.returnFocus} onClose={() => setDetails(null)} />}
      </>}
    </DialogContent>
  </Dialog>;
}
