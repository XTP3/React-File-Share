import { useEffect, useRef, useState } from "react";
import {
  CloudUpload,
  Plus,
  X,
  File as FileIcon,
  Check,
  RotateCcw,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { bytes, upload } from "@/lib/api";
interface QueueItem {
  id: string;
  file: File;
  url?: string;
  progress: number;
  status: "ready" | "queued" | "uploading" | "done" | "error" | "cancelled";
  error?: string;
  collection?: string;
}
export function UploadQueue({
  open,
  onOpenChange,
  maxSize,
  collection,
  onSuccess,
  onActiveChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  maxSize: number;
  collection: string;
  onSuccess: () => void;
  onActiveChange: (v: boolean) => void;
}) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const input = useRef<HTMLInputElement>(null);
  const controllers = useRef(new Map<string, AbortController>());
  const [dragging, setDragging] = useState(false);
  const active = items.some(
    (x) => x.status === "uploading" || x.status === "queued",
  );
  const ready = items.filter((x) => x.status === "ready");
  const duplicates = new Set(
    items
      .filter((x, i) =>
        items.some((y, j) => j !== i && x.file.name === y.file.name),
      )
      .map((x) => x.file.name),
  );
  const invalid =
    ready.some((x) => x.file.size > maxSize) || duplicates.size > 0;
  useEffect(() => {
    onActiveChange(active);
  }, [active, onActiveChange]);
  useEffect(
    () => () => {
      controllers.current.forEach((c) => c.abort());
      itemsRef.current.forEach((x) => x.url && URL.revokeObjectURL(x.url));
    },
    [],
  );
  function update(id: string, patch: Partial<QueueItem>) {
    setItems((current) =>
      current.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    );
  }
  function add(files: FileList | File[]) {
    const existing = itemsRef.current.length;
    const list = Array.from(files).slice(0, 200 - existing);
    if (!list.length) return;
    const additions = list.map((file, index) => ({
      id: crypto.randomUUID(),
      file,
      url:
        existing + index < 30 &&
        file.size <= 12 * 1024 * 1024 &&
        file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined,
      progress: 0,
      status: "ready" as const,
    }));
    setItems((current) => [...current, ...additions]);
    if (input.current) input.current.value = "";
  }
  function remove(id: string) {
    const item = itemsRef.current.find((x) => x.id === id);
    if (item?.url) URL.revokeObjectURL(item.url);
    setItems((current) => current.filter((x) => x.id !== id));
  }
  function clear() {
    itemsRef.current
      .filter((x) => x.status !== "uploading" && x.status !== "queued")
      .forEach((x) => x.url && URL.revokeObjectURL(x.url));
    setItems((current) =>
      current.filter((x) => x.status === "uploading" || x.status === "queued"),
    );
  }
  useEffect(() => {
    const running = items.filter((x) => x.status === "uploading").length;
    const queued = items
      .filter((x) => x.status === "queued")
      .slice(0, Math.max(0, 3 - running));
    for (const item of queued) {
      if (controllers.current.has(item.id)) continue;
      const controller = new AbortController();
      controllers.current.set(item.id, controller);
      update(item.id, { status: "uploading" });
      upload(
        item.file,
        item.collection || collection,
        (n) => update(item.id, { progress: n }),
        controller.signal,
      )
        .then(() => {
          update(item.id, { status: "done", progress: 100 });
          onSuccess();
        })
        .catch((e) =>
          update(item.id, {
            status: e.name === "AbortError" ? "cancelled" : "error",
            error: e.message,
          }),
        )
        .finally(() => controllers.current.delete(item.id));
    }
  }, [items, collection, onSuccess]);
  function start() {
    if (!navigator.onLine) {
      toast.error("You are offline. Reconnect to upload files.");
      return;
    }
    setItems((current) =>
      current.map((x) =>
        x.status === "ready" ? { ...x, status: "queued", collection } : x,
      ),
    );
  }
  function cancel(item: QueueItem) {
    controllers.current.get(item.id)?.abort();
    if (item.status === "queued")
      update(item.id, { status: "cancelled", error: "Upload cancelled" });
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="upload-dialog">
        <DialogHeader>
          <DialogTitle>Upload files</DialogTitle>
          <DialogDescription>
            Review your selection before sharing. Up to 3 files transfer at
            once.
          </DialogDescription>
        </DialogHeader>
        <input
          ref={input}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose files"
          onChange={(e) => e.target.files && add(e.target.files)}
        />
        <Card
          className={`dropzone ${dragging ? "dragging" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            add(e.dataTransfer.files);
          }}
        >
          <CardContent>
            <CloudUpload size={32} />
            <p>Drop your files here</p>
            <span className="muted">
              or choose from your device · {bytes(maxSize)} per file
            </span>
            <Button variant="outline" onClick={() => input.current?.click()}>
              <Plus />
              {items.length ? "Add more files" : "Choose files"}
            </Button>
          </CardContent>
        </Card>
        {duplicates.size > 0 && (
          <Alert variant="destructive">
            <AlertDescription>
              Some filenames repeat. Remove duplicates before uploading.
            </AlertDescription>
          </Alert>
        )}
        {ready.some((x) => x.file.size > maxSize) && (
          <Alert variant="destructive">
            <AlertDescription>
              A file exceeds the {bytes(maxSize)} upload limit. Remove it to
              continue.
            </AlertDescription>
          </Alert>
        )}
        <div className="upload-items" aria-label="Upload selection">
          {items.map((item) => (
            <Card key={item.id} className="upload-item">
              <CardContent>
                <div className="queue-thumbnail">
                  {item.url ? <img src={item.url} alt="" /> : <FileIcon />}
                </div>
                <div className="queue-info">
                  <p title={item.file.name}>{item.file.name}</p>
                  <span className="muted">
                    {bytes(item.file.size)} · {item.file.type || "File"}
                  </span>
                  {(item.status === "uploading" ||
                    item.status === "queued") && (
                    <Progress
                      value={item.progress}
                      aria-label={`Upload progress ${item.file.name}`}
                    />
                  )}
                  <div>
                    {item.status === "done" ? (
                      <Badge variant="secondary">
                        <Check />
                        Uploaded
                      </Badge>
                    ) : item.error ? (
                      <span className="text-destructive" role="status">
                        {item.error}
                      </span>
                    ) : item.status === "uploading" ? (
                      <span className="muted">{item.progress}% uploaded</span>
                    ) : item.status === "queued" ? (
                      <span className="muted">Waiting…</span>
                    ) : null}
                  </div>
                </div>
                {item.status === "uploading" || item.status === "queued" ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Cancel ${item.file.name}`}
                    onClick={() => cancel(item)}
                  >
                    <Square />
                  </Button>
                ) : (
                  <>
                    {(item.status === "error" ||
                      item.status === "cancelled") && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Retry ${item.file.name}`}
                        disabled={invalid || !navigator.onLine}
                        onClick={() =>
                          update(item.id, {
                            status: "queued",
                            progress: 0,
                            error: undefined,
                            collection: item.collection || collection,
                          })
                        }
                      >
                        <RotateCcw />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${item.file.name}`}
                      onClick={() => remove(item.id)}
                    >
                      <X />
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="upload-footer">
          <span className="muted">
            {items.length} files ·{" "}
            {bytes(items.reduce((sum, x) => sum + x.file.size, 0))}
          </span>
          <div>
            <Button variant="ghost" onClick={clear} disabled={!items.length}>
              Clear selection
            </Button>
            <Button
              onClick={start}
              disabled={!ready.length || invalid || !navigator.onLine}
            >
              <CloudUpload />
              Upload {ready.length || ""} files
            </Button>
          </div>
        </div>
        {active && (
          <p className="muted upload-hint">
            Keep this app open while files upload. You can close this panel and
            continue browsing.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
