import { Copy } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { api, bytes, formatDate } from "@/lib/api";
import type { PublicConfig, SharedFile } from "@/lib/types";

export function FileDetails({ file, config, onClose }: {
  file: SharedFile | null;
  config?: PublicConfig;
  onClose: () => void;
}) {
  const thumbnail = useQuery({
    queryKey: ["thumbnail-details", file?.uniqueID, file?.timeOfUpload],
    enabled: !!file && (file.category === "photo" || file.category === "gif"),
    queryFn: ({ signal }) => api<{ available: boolean; reason: string }>(`/files/${encodeURIComponent(file!.uniqueID)}/thumbnail?details=1`, { signal }),
    retry: false,
  });
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
          {(file.category === "photo" || file.category === "gif") && <div><dt>Thumbnail</dt><dd role="status">
            {thumbnail.isPending ? "Checking preview…" : thumbnail.isError ? "Could not check preview availability" : thumbnail.data?.available ? "Available" : thumbnail.data?.reason || "Preview unavailable"}
          </dd></div>}
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
