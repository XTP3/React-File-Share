import { useCallback, useMemo, useState } from "react";
import type { SharedFile } from "./types";

// Keep the records, not just IDs from the visible page: bulk actions must also
// receive files selected on other pages. The owning explorer scopes this state.
export function useFileSelection() {
  const [selected, setSelected] = useState(new Map<string, SharedFile>());
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
  const clear = useCallback(() => setSelected(new Map()), []);
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
  return { selected, selectedFiles, toggle, setVisible, clear, remove, pageState };
}
