import { useEffect, useRef, useState } from "react";
import { api, fileQuery } from "./api";
import type { ExplorerPreferences, Page, SharedFile } from "./types";

export interface PreviewContext {
  user: string;
  collection: string;
  preferences: ExplorerPreferences;
  page: Page;
}

export interface PreviewSession {
  file: SharedFile;
  context: PreviewContext;
}

// A viewer owns this snapshot, independently of explorer pagination/preferences.
// Cache only nearby pages so browsing a large library does not retain all records.
export function usePreviewNavigation(initial: PreviewSession) {
  const [current, setCurrent] = useState(() => ({
    file: initial.file,
    index: (initial.context.page.page - 1) * initial.context.page.pageSize +
      initial.context.page.items.findIndex((file) => file.uniqueID === initial.file.uniqueID),
  }));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retryDirection, setRetryDirection] = useState<-1 | 1>(1);
  const request = useRef<AbortController | null>(null);
  const pages = useRef(new Map([[initial.context.page.page, initial.context.page]]));
  const total = initial.context.page.total;

  useEffect(() => () => request.current?.abort(), []);

  async function navigate(direction: -1 | 1) {
    if (request.current) return;
    const index = current.index + direction;
    if (index < 0 || index >= total) return;
    const size = initial.context.page.pageSize;
    const pageNumber = Math.floor(index / size) + 1;
    let next = pages.current.get(pageNumber);
    const controller = new AbortController();
    request.current = controller;
    setError("");
    setRetryDirection(direction);
    try {
      if (!next) {
        setLoading(true);
        const context = initial.context;
        next = await api<Page>("/files?" + fileQuery({ ...context.preferences, pageSize: size }, pageNumber, context.collection), { signal: controller.signal });
        if (controller.signal.aborted) return;
        pages.current.set(pageNumber, next);
        for (const key of pages.current.keys()) {
          if (Math.abs(key - pageNumber) > 1) pages.current.delete(key);
        }
      }
      const file = next.items[index % size];
      if (!file) {
        pages.current.delete(pageNumber);
        throw new Error("These results changed. Close the preview and refresh files, or try again.");
      }
      if (!controller.signal.aborted) setCurrent({ file, index });
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "The next file could not be loaded.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  }

  return {
    file: current.file,
    navigation: {
      position: current.index + 1,
      total,
      loading,
      error,
      onNavigate: navigate,
      onRetry: () => navigate(retryDirection),
    },
  };
}
