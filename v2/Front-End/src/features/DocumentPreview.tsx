import { lazy, Suspense, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { shareURL } from "@/lib/api";
import type { SharedFile } from "@/lib/types";
import "./document-preview.css";

const textExtensions = new Set([
  "txt", "md", "markdown", "csv", "tsv", "log", "json", "jsonl", "ndjson",
  "xml", "yaml", "yml", "html", "htm",
]);
const textMimeTypes = new Set([
  "application/json", "application/xml", "application/javascript", "application/ecmascript",
  "application/yaml", "application/x-yaml", "application/x-ndjson",
]);
const maxTextBytes = 256 * 1024;
const PdfPreview = lazy(() => import("./PdfPreview").catch(() => ({
  default: () => <div className="preview-stage"><Alert className="preview-error">
    <AlertDescription>The PDF reader could not be loaded. Open the original file or download it to view it.</AlertDescription>
  </Alert></div>,
})));

export function documentPreviewKind(file: SharedFile): "pdf" | "text" | undefined {
  const mime = file.fileType.split(";", 1)[0].trim().toLowerCase();
  const extension = file.fileName.match(/\.([^.]+)$/)?.[1].toLowerCase();
  const genericMime = !mime || mime === "application/octet-stream";
  if (mime === "application/pdf" || (genericMime && extension === "pdf")) return "pdf";
  if (mime.startsWith("text/") || textMimeTypes.has(mime) || /\+(?:json|xml)$/.test(mime) ||
    (genericMime && extension && textExtensions.has(extension))) return "text";
}

type TextPreviewState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; text: string; truncated: boolean };

async function readTextPreview(url: string, signal: AbortSignal) {
  const response = await fetch(url, {
    headers: { Range: `bytes=0-${maxTextBytes - 1}` },
    credentials: "omit",
    signal,
  });
  if (!response.ok || !response.body) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Text preview request failed");
  }

  const partial = response.status === 206;
  const range = /^bytes 0-\d+\/(\d+|\*)$/i.exec(response.headers.get("Content-Range") ?? "");
  const lengthHeader = partial ? range?.[1] : response.headers.get("Content-Length");
  const length = lengthHeader && !response.headers.has("Content-Encoding") ? Number(lengthHeader) : NaN;
  const reader = response.body.getReader();
  const bytes = new Uint8Array(maxTextBytes);
  let size = 0;
  let truncated = length > maxTextBytes;
  try {
    while (size < maxTextBytes) {
      const { value, done } = await reader.read();
      if (done) break;
      const count = Math.min(value.byteLength, maxTextBytes - size);
      bytes.set(value.subarray(0, count), size);
      size += count;
      truncated ||= value.byteLength > count;
    }
    if (size === maxTextBytes && Number.isNaN(length) && !truncated) {
      if (partial) truncated = true;
      else truncated = !(await reader.read()).done;
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  return { text: new TextDecoder().decode(bytes.subarray(0, size), { stream: truncated }), truncated };
}

function TextPreview({ file }: { file: SharedFile }) {
  const [state, setState] = useState<TextPreviewState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void readTextPreview(shareURL(file.uniqueID, "v"), controller.signal).then(
      (result) => { if (!controller.signal.aborted) setState({ status: "ready", ...result }); },
      () => { if (!controller.signal.aborted) setState({ status: "error" }); },
    );
    return () => controller.abort();
  }, [file.uniqueID]);

  if (state.status === "loading") {
    return <div className="preview-stage"><Badge variant="secondary" className="preview-loading" role="status">
      <LoaderCircle className="animate-spin" />Loading text…
    </Badge></div>;
  }
  if (state.status === "error") {
    return <div className="preview-stage"><Alert className="preview-error"><AlertDescription>
      This text file could not be loaded. Open the original file or download it to view it.
    </AlertDescription></Alert></div>;
  }
  return (
    <div className="document-preview">
      {state.truncated && <p className="text-preview-limit" role="status">Showing the first 256 KiB of this file.</p>}
      {state.text ? (
        <div className="text-preview-scroll" role="region" aria-label="Text preview" tabIndex={0} data-document-preview-scroll>
          <pre>{state.text}</pre>
        </div>
      ) : <div className="preview-stage text-preview-empty"><p>This file is empty.</p></div>}
    </div>
  );
}

export function DocumentPreview({ file }: { file: SharedFile }) {
  if (documentPreviewKind(file) === "pdf") {
    return (
      <Suspense fallback={<div className="preview-stage"><Badge variant="secondary" className="preview-loading" role="status">
        <LoaderCircle className="animate-spin" />Loading PDF…
      </Badge></div>}>
        <PdfPreview key={file.uniqueID} file={file} />
      </Suspense>
    );
  }
  return <TextPreview key={file.uniqueID} file={file} />;
}
