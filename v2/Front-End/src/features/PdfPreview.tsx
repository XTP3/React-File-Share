import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle, MoveHorizontal, ZoomIn, ZoomOut } from "lucide-react";
import {
  AnnotationMode, GlobalWorkerOptions, getDocument, PasswordException, TextLayer, version,
  type PDFDocumentLoadingTask, type PDFDocumentProxy, type PDFPageProxy, type RenderTask,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url&no-inline";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { shareURL } from "@/lib/api";
import type { SharedFile } from "@/lib/types";
import "./pdf-preview.css";

GlobalWorkerOptions.workerSrc = workerUrl;
const assetBase = `${import.meta.env.BASE_URL}${import.meta.env.DEV ? "node_modules/pdfjs-dist" : `pdfjs/${version}`}/`;
const pagePadding = 24;
const maxCanvasSide = 4096;
const maxCanvasPixels = 8_000_000;
const zoomLevels = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const fitWidthIndex = zoomLevels.indexOf(1);
const pdfError = "This PDF could not be displayed. Open the original file or download it to view it.";

function PdfPage({ pdf, pageNumber, zoom, width }: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  width: number;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const sheet = sheetRef.current;
    const canvas = canvasRef.current;
    const textContainer = textRef.current;
    if (!sheet || !canvas || !textContainer || !width) return;
    let active = true;
    let page: PDFPageProxy | undefined;
    let renderTask: RenderTask | undefined;
    let textLayer: TextLayer | undefined;
    setStatus("loading");

    function releasePage() {
      renderTask?.cancel();
      textLayer?.cancel();
      page?.cleanup();
    }

    void (async () => {
      try {
        const currentPage = await pdf.getPage(pageNumber);
        if (!active) return;
        page = currentPage;
        const natural = page.getViewport({ scale: 1 });
        const largestSide = Math.max(natural.width, natural.height);
        if (!Number.isFinite(largestSide) || natural.width <= 0 || natural.height <= 0) {
          throw new Error("Invalid PDF page dimensions");
        }
        const scale = Math.min(Math.max(1, width - pagePadding) / natural.width * zoom, 16_384 / largestSide);
        const viewport = page.getViewport({ scale });
        const outputScale = Math.min(
          window.devicePixelRatio || 1, 2,
          maxCanvasSide / viewport.width, maxCanvasSide / viewport.height,
          Math.sqrt(maxCanvasPixels / (viewport.width * viewport.height)),
        );
        canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
        canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
        const cssWidth = Math.max(1, Math.floor(viewport.width));
        const cssHeight = Math.max(1, Math.floor(viewport.height));
        sheet.style.width = `${cssWidth}px`;
        sheet.style.height = `${cssHeight}px`;
        sheet.style.setProperty("--total-scale-factor", String(viewport.scale * viewport.userUnit));

        renderTask = page.render({
          canvas,
          viewport,
          transform: [canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0],
          annotationMode: AnnotationMode.DISABLE,
          background: "#fff",
        });
        const renderText = async () => {
          textLayer = new TextLayer({ container: textContainer, textContentSource: currentPage.streamTextContent(), viewport });
          // Use the canvas dimensions without requiring the CSS round() function.
          const sideways = viewport.rotation % 180 !== 0;
          textContainer.style.width = `${sideways ? cssHeight : cssWidth}px`;
          textContainer.style.height = `${sideways ? cssWidth : cssHeight}px`;
          await textLayer.render();
        };
        await Promise.all([renderTask.promise, renderText()]);
        if (active) setStatus("ready");
      } catch {
        if (!active) return;
        releasePage();
        canvas.width = 0;
        canvas.height = 0;
        textContainer.replaceChildren();
        setStatus("error");
      }
    })();

    return () => {
      active = false;
      releasePage();
      canvas.width = 0;
      canvas.height = 0;
      textContainer.replaceChildren();
    };
  }, [pdf, pageNumber, zoom, width]);

  return (
    <>
      <div className="pdf-preview-sheet-row" hidden={status !== "ready"}>
        <div className="pdf-preview-sheet" ref={sheetRef}>
          <canvas ref={canvasRef} width={0} height={0} aria-label={`PDF page ${pageNumber}`} />
          <div className="pdf-preview-text-layer" ref={textRef} />
        </div>
      </div>
      {status !== "ready" && <div className="pdf-preview-feedback">
        {status === "loading"
          ? <Badge variant="secondary" className="preview-loading" role="status"><LoaderCircle className="animate-spin" />Loading PDF page…</Badge>
          : <Alert className="preview-error"><AlertDescription>{pdfError}</AlertDescription></Alert>}
      </div>}
    </>
  );
}

export default function PdfPreview({ file }: { file: SharedFile }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [error, setError] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [zoomIndex, setZoomIndex] = useState(fitWidthIndex);
  const [width, setWidth] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    let task: PDFDocumentLoadingTask | undefined;
    function destroy() {
      if (task && !task.destroyed) void task.destroy().finally(() => TextLayer.cleanup()).catch(() => {});
    }
    void (async () => {
      try {
        task = getDocument({
          url: shareURL(file.uniqueID, "v"),
          disableAutoFetch: true,
          disableStream: true,
          disableWorkerRendering: true,
          cMapUrl: `${assetBase}cmaps/`,
          standardFontDataUrl: `${assetBase}standard_fonts/`,
          wasmUrl: `${assetBase}wasm/`,
          iccUrl: `${assetBase}iccs/`,
          canvasMaxAreaInBytes: maxCanvasPixels * 4,
        });
        const document = await task.promise;
        if (active) setPdf(document);
      } catch (error) {
        destroy();
        if (active) setError(error instanceof PasswordException
          ? "This PDF requires a password. Open the original file or download it to view it."
          : pdfError);
      }
    })();
    return () => {
      active = false;
      destroy();
    };
  }, [file.uniqueID]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const updateWidth = () => setWidth(scroll.clientWidth);
    const observer = new ResizeObserver(updateWidth);
    updateWidth();
    observer.observe(scroll);
    return () => observer.disconnect();
  }, []);

  function changePage(delta: -1 | 1) {
    setPageNumber((page) => Math.min(pdf?.numPages ?? 1, Math.max(1, page + delta)));
    scrollRef.current?.scrollTo({ top: 0, left: 0 });
  }

  return (
    <div className="document-preview">
      {pdf && <div className="pdf-preview-controls" aria-label="PDF controls" role="group">
        <div className="pdf-preview-controls-group">
          <Button variant="ghost" size="icon" aria-label="Previous PDF page" disabled={pageNumber <= 1} onClick={() => changePage(-1)}>
            <ChevronLeft />
          </Button>
          <span role="status" aria-live="polite">
            <span className="sr-only">Page {pageNumber} of {pdf.numPages}</span>
            <span aria-hidden="true">{pageNumber} / {pdf.numPages}</span>
          </span>
          <Button variant="ghost" size="icon" aria-label="Next PDF page" disabled={pageNumber >= pdf.numPages} onClick={() => changePage(1)}>
            <ChevronRight />
          </Button>
        </div>
        <div className="pdf-preview-controls-group">
          <Button variant="ghost" size="icon" aria-label="Zoom out" disabled={zoomIndex === 0} onClick={() => setZoomIndex((index) => index - 1)}>
            <ZoomOut />
          </Button>
          <Button variant="outline" className="pdf-preview-fit" aria-label="Fit PDF to width" title="Fit PDF to width" aria-pressed={zoomIndex === fitWidthIndex} onClick={() => setZoomIndex(fitWidthIndex)}>
            {zoomIndex === fitWidthIndex
              ? <><MoveHorizontal className="pdf-preview-fit-icon" /><span className="pdf-preview-fit-label">Fit width</span></>
              : `${Math.round(zoomLevels[zoomIndex] * 100)}%`}
          </Button>
          <Button variant="ghost" size="icon" aria-label="Zoom in" disabled={zoomIndex === zoomLevels.length - 1} onClick={() => setZoomIndex((index) => index + 1)}>
            <ZoomIn />
          </Button>
        </div>
      </div>}
      <div className="pdf-preview-view">
        <div ref={scrollRef} className="pdf-preview-scroll" role="region" aria-label="PDF page" tabIndex={0} data-document-preview-scroll>
          {pdf && <PdfPage key={pageNumber} pdf={pdf} pageNumber={pageNumber} zoom={zoomLevels[zoomIndex]} width={width} />}
        </div>
        {!pdf && <div className="pdf-preview-feedback">
          {error
            ? <Alert className="preview-error"><AlertDescription>{error}</AlertDescription></Alert>
            : <Badge variant="secondary" className="preview-loading" role="status"><LoaderCircle className="animate-spin" />Loading PDF…</Badge>}
        </div>}
      </div>
    </div>
  );
}
