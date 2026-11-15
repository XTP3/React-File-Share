import { useCallback, useMemo, useRef, useState } from "react";
import type { SharedFile } from "./types";

// Keep the records, not just IDs from the visible page: bulk actions must also
// receive files selected on other pages. The owning explorer scopes this state.
export function useFileSelection() {
  const [selected, setSelected] = useState(new Map<string, SharedFile>());
  const anchor = useRef<{ scope: string; id: string } | null>(null);
  const resetAnchor = useCallback(() => { anchor.current = null; }, []);
  const selectedFiles = useMemo(() => Array.from(selected.values()), [selected]);
  const toggle = useCallback((file: SharedFile) => {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(file.uniqueID)) next.delete(file.uniqueID);
      else next.set(file.uniqueID, file);
      return next;
    });
  }, []);
  const setVisible = useCallback((items: SharedFile[], checked: boolean) => {
    setSelected((current) => {
      const next = new Map(current);
      for (const file of items) {
        if (checked) next.set(file.uniqueID, file);
        else next.delete(file.uniqueID);
      }
      return next;
    });
  }, []);
  const toggleRange = useCallback((file: SharedFile, items: SharedFile[], scope: string, shift: boolean) => {
    const start = anchor.current?.scope === scope ? items.findIndex((item) => item.uniqueID === anchor.current?.id) : -1;
    const end = items.findIndex((item) => item.uniqueID === file.uniqueID);
    if (!shift || start < 0 || end < 0) {
      anchor.current = { scope, id: file.uniqueID };
      toggle(file);
      return;
    }
    const step = end >= start ? 1 : -1;
    const range: SharedFile[] = [];
    for (let i = start; ; i += step) {
      range.push(items[i]);
      if (i === end) break;
    }
    setSelected((current) => {
      const next = new Map(current);
      for (const item of range) if (!next.has(item.uniqueID)) next.set(item.uniqueID, item);
      return next;
    });
  }, [toggle]);
  const clear = useCallback(() => { anchor.current = null; setSelected(new Map()); }, []);
  const remove = useCallback((ids: string[]) => {
    setSelected((current) => {
      if (!ids.some((id) => current.has(id))) return current;
      const next = new Map(current);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);
  const pageState = useCallback((items: SharedFile[]): boolean | "indeterminate" => {
    const count = items.filter((file) => selected.has(file.uniqueID)).length;
    return count === 0 ? false : count === items.length ? true : "indeterminate";
  }, [selected]);
  return { selected, selectedFiles, toggle, toggleRange, resetAnchor, setVisible, clear, remove, pageState };
}
