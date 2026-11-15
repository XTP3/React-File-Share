import { useRef, useState } from "react";
import { Copy, TextSelect } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { shareURL } from "@/lib/api";
import type { SharedFile } from "@/lib/types";
import "./bulk-actions.css";

export function useCopyLinks() {
  const [fallback, setFallback] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  async function copyLinks(files: SharedFile[]) {
    if (!files.length) return;
    const value = files.map(file => shareURL(file.uniqueID, "v")).join("\n");
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${files.length} view ${files.length === 1 ? "link" : "links"} copied`);
    } catch {
      setFallback(value);
    }
  }
  function selectLinks() {
    textarea.current?.focus();
    textarea.current?.select();
  }
  return {
    copyLinks,
    dialog: <Dialog open={fallback !== null} onOpenChange={open => { if (!open) setFallback(null); }}>
      <DialogContent className="copy-links-dialog">
        <DialogHeader>
          <DialogTitle>Copy view links</DialogTitle>
          <DialogDescription>Clipboard access is unavailable. Select the links below and use your device’s Copy action. Links are listed in selection order.</DialogDescription>
        </DialogHeader>
        <Textarea ref={textarea} aria-label="Selected view links" readOnly value={fallback || ""} onFocus={event => event.currentTarget.select()} />
        <DialogFooter>
          <Button variant="outline" onClick={selectLinks}><TextSelect />Select all links</Button>
          <Button onClick={async () => {
            try {
              await navigator.clipboard.writeText(fallback || "");
              toast.success("View links copied");
              setFallback(null);
            } catch {
              selectLinks();
              toast.info("Links selected. Use your device’s Copy action.");
            }
          }}><Copy />Copy links</Button>
          <Button variant="ghost" onClick={() => setFallback(null)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>,
  };
}
