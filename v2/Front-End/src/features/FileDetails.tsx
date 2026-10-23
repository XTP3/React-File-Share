import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { bytes, formatDate } from "@/lib/api";
import type { PublicConfig, SharedFile } from "@/lib/types";

export function FileDetails({ file, config, onClose }: {
  file: SharedFile | null;
  config?: PublicConfig;
  onClose: () => void;
}) {
  return <Dialog open={!!file} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="file-details-dialog">
      <DialogHeader>
        <DialogTitle>File details</DialogTitle>
        <DialogDescription>Full filename and file information.</DialogDescription>
      </DialogHeader>
      {file && <>
        <dl className="file-details">
          <div><dt>Filename</dt><dd className="full-filename">{file.fileName}</dd></div>
          <div><dt>Size</dt><dd>{bytes(file.fileSize)}</dd></div>
          <div><dt>Type</dt><dd>{file.fileType || file.category}</dd></div>
          <div><dt>Uploaded</dt><dd>{formatDate(file.timeOfUpload, config)}</dd></div>
        </dl>
        <DialogFooter>
          <Button variant="outline" onClick={async () => {
            try {
              await navigator.clipboard.writeText(file.fileName);
              toast.success("Filename copied");
            } catch {
              toast.error("Could not copy the filename. Select the name above to copy it.");
            }
          }}><Copy />Copy filename</Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </>}
    </DialogContent>
  </Dialog>;
}
