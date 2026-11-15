import { useEffect, useRef, useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, bytes, shareURL } from "@/lib/api";
import type { SharedFile } from "@/lib/types";
import "./bulk-actions.css";

type DownloadTicket = { id: string; downloadUrl: string; expiresAt: number };

// Browser-managed downloads stream to disk rather than buffering an archive in JS.
function requestDownloads(files: { url: string; name?: string }[]) {
  const link = document.createElement("a");
  link.hidden = true;
  document.body.append(link);
  try {
    for (const file of files) {
      link.href = file.url;
      link.download = file.name || "";
      link.click();
    }
  } finally {
    link.remove();
  }
}

function DownloadChoice({ files, onClose }: { files: SharedFile[]; onClose: () => void }) {
  const [format, setFormat] = useState("zip");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  function close() {
    controller.current?.abort();
    onClose();
  }

  async function download() {
    if (busy) return;
    setError("");
    setBusy(true);
    const request = new AbortController();
    controller.current = request;
    try {
      if (format === "zip") {
        const ticket = await api<DownloadTicket>("/downloads", {
          method: "POST",
          body: JSON.stringify({ fileIds: files.map(file => file.uniqueID) }),
          signal: request.signal,
        });
        if (request.signal.aborted) return;
        const url = new URL(ticket.downloadUrl, location.origin);
        if (url.origin !== location.origin || !url.pathname.startsWith("/api/v2/downloads/"))
          throw new Error("The download could not be prepared. Try again.");
        requestDownloads([{ url: url.href }]);
      } else {
        requestDownloads(files.map(file => ({ url: shareURL(file.uniqueID, "d"), name: file.fileName })));
      }
      toast.success(format === "zip" ? "ZIP download requested" : `${files.length} file downloads requested`);
      onClose();
    } catch (error) {
      if (!request.signal.aborted)
        setError(error instanceof Error ? error.message : "The download could not be prepared. Try again.");
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }

  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="bulk-download-dialog">
      <DialogHeader>
        <DialogTitle>Download selected files</DialogTitle>
        <DialogDescription>{files.length} {files.length === 1 ? "file" : "files"} · {bytes(files.reduce((total, file) => total + file.fileSize, 0))}. Choose how to download your selection.</DialogDescription>
      </DialogHeader>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="bulk-download-choice">
        <Label htmlFor="bulk-download-format">Download format</Label>
        <Select value={format} onValueChange={setFormat} disabled={busy}>
          <SelectTrigger id="bulk-download-format" aria-label="Download format"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="zip">One ZIP</SelectItem>
            <SelectItem value="separate">Separate files</SelectItem>
          </SelectContent>
        </Select>
        <p className="muted">{format === "zip"
          ? "One archive with original filenames. Duplicate references to the same filename appear once."
          : "Files download separately in selection order. Your browser may ask you to allow multiple downloads."}</p>
        <p className="muted">Check your browser’s download manager for progress and completion.</p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close}>Cancel</Button>
        <Button onClick={download} disabled={busy || !files.length}>
          {busy ? <LoaderCircle className="animate-spin" /> : <Download />}
          {busy ? "Preparing download…" : "Download"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function BulkDownloadDialog({ files, onClose }: { files: SharedFile[] | null; onClose: () => void }) {
  // Unmount the choice form when closed, so every operation starts with ZIP.
  return files ? <DownloadChoice files={files} onClose={onClose} /> : null;
}
