import { useEffect, useId, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, LoaderCircle, Search } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { api, bytes, changeMembership, fileQuery, formatDate } from "@/lib/api";
import {
  categories,
  categoryLabels,
  defaultPreferences,
  type Collection,
  type ExplorerPreferences,
  type Page,
  type PublicConfig,
  type SharedFile,
} from "@/lib/types";
import { useFileSelection } from "@/lib/use-file-selection";
import { FileThumbnail } from "./Explorer";
import "./library-picker.css";

export function LibraryPicker({
  user,
  collection,
  config,
  onClose,
  onAdded,
}: {
  user: string;
  collection: Collection;
  config?: PublicConfig;
  onClose: () => void;
  onAdded: () => void;
}) {
  const id = useId();
  const [prefs, setPrefs] = useState<ExplorerPreferences>(() => ({
    ...defaultPreferences,
    categories: [],
    pageSize: 25,
  }));
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const submitting = useRef(false);
  const lifetime = useRef(new AbortController());
  const selection = useFileSelection();
  const query = fileQuery(prefs, page, "all");
  const files = useQuery({
    queryKey: ["files", user, "all", query],
    queryFn: ({ signal }) => api<Page>("/files?" + query, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 15000,
  });
  const items = files.data?.items || [];
  const count = selection.selected.size;
  const pages = Math.max(files.data?.totalPages || 1, 1);
  const rowsDisabled = adding || files.isPlaceholderData || files.isError;

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    const cancel = () => controller.abort();
    window.addEventListener("fileshare:session-expired", cancel);
    return () => {
      cancel();
      clearTimeout(debounce.current);
      window.removeEventListener("fileshare:session-expired", cancel);
    };
  }, []);
  useEffect(() => {
    if (files.data && !files.isPlaceholderData && page > pages) setPage(pages);
  }, [files.data, files.isPlaceholderData, page, pages]);

  function patch(value: Partial<ExplorerPreferences>) {
    setPrefs((current) => ({ ...current, ...value }));
    setPage(1);
  }
  function updateSearch(value: string) {
    setSearch(value);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => patch({ q: value }), 300);
  }
  function toggle(file: SharedFile) {
    selection.toggle(file);
  }
  function selectPage(checked: boolean) {
    selection.setVisible(items, checked);
  }
  async function addSelected() {
    if (!count || submitting.current) return;
    submitting.current = true;
    setAdding(true);
    setError("");
    const signal = lifetime.current.signal;
    try {
      await changeMembership(
        collection.id,
        "POST",
        selection.selectedFiles.map((file) => file.uniqueID),
        (ids) => { selection.remove(ids); onAdded(); },
        signal,
      );
    } catch (cause) {
      if (signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "Could not add files. Please try again.");
      submitting.current = false;
      setAdding(false);
      return;
    }
    if (signal.aborted) return;
    toast.success(`Selection added to “${collection.title}”`);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submitting.current) onClose(); }}>
      <DialogContent
        className="library-picker"
        showCloseButton={!adding}
        onEscapeKeyDown={(event) => { if (submitting.current) event.preventDefault(); }}
        onInteractOutside={(event) => { if (submitting.current) event.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>Add from library</DialogTitle>
          <DialogDescription>
            Choose files for “{collection.title}”. Files already in this collection stay there without duplicates.
          </DialogDescription>
        </DialogHeader>
        <div className="library-picker-controls">
          <form
            className="library-picker-search"
            onSubmit={(event) => {
              event.preventDefault();
              clearTimeout(debounce.current);
              patch({ q: search });
            }}
          >
            <Label htmlFor={`${id}-search`} className="sr-only">Search library</Label>
            <Input
              id={`${id}-search`}
              value={search}
              placeholder="Search your library…"
              onChange={(event) => updateSearch(event.target.value)}
              disabled={adding}
            />
            <Button type="submit" variant="outline" size="icon" aria-label="Search library now" disabled={adding}>
              <Search />
            </Button>
          </form>
          <Select
            value={prefs.sort + ":" + prefs.direction}
            disabled={adding}
            onValueChange={(value) => {
              const [sort, direction] = value.split(":");
              patch({ sort: sort as ExplorerPreferences["sort"], direction: direction as ExplorerPreferences["direction"] });
            }}
          >
            <SelectTrigger aria-label="Sort library"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="date:desc">Newest first</SelectItem>
              <SelectItem value="date:asc">Oldest first</SelectItem>
              <SelectItem value="name:asc">Name A–Z</SelectItem>
              <SelectItem value="name:desc">Name Z–A</SelectItem>
              <SelectItem value="size:desc">Largest first</SelectItem>
              <SelectItem value="size:asc">Smallest first</SelectItem>
              <SelectItem value="type:asc">Type A–Z</SelectItem>
              <SelectItem value="type:desc">Type Z–A</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={prefs.categories[0] || "all"}
            disabled={adding}
            onValueChange={(value) => patch({ categories: value === "all" ? [] : [value as SharedFile["category"]] })}
          >
            <SelectTrigger aria-label="Filter library by category"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category} value={category}>{categoryLabels[category]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="library-picker-selection">
          <div className="library-picker-page-selection">
            <Checkbox
              id={`${id}-all`}
              checked={selection.pageState(items)}
              onCheckedChange={(checked) => selectPage(checked === true)}
              disabled={rowsDisabled || !items.length}
            />
            <Label htmlFor={`${id}-all`}>Select this page</Label>
          </div>
          <span role="status">{count} selected</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={!count || adding}
            onClick={() => selection.clear()}
          >Clear selection</Button>
        </div>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <div className="library-picker-results" aria-busy={files.isFetching}>
          {files.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{files.error.message}</AlertDescription>
              <Button variant="outline" size="sm" onClick={() => files.refetch()} disabled={files.isFetching || adding}>Retry</Button>
            </Alert>
          ) : files.isPending ? (
            <div className="library-picker-loading" role="status" aria-label="Loading library">
              {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-14 w-full" />)}
            </div>
          ) : !items.length ? (
            <Empty className="library-picker-empty">
              <EmptyHeader>
                <EmptyTitle>No files found</EmptyTitle>
                <EmptyDescription>{prefs.q || prefs.categories.length ? "Try another search or category." : "Upload files to your library to add them here."}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="library-picker-list" aria-label="Library files">
              {items.map((file, index) => (
                <li key={file.uniqueID} className={selection.selected.has(file.uniqueID) ? "is-selected" : ""}>
                  <Checkbox
                    id={`${id}-file-${index}`}
                    aria-label={`Select ${file.fileName}`}
                    checked={selection.selected.has(file.uniqueID)}
                    onCheckedChange={() => toggle(file)}
                    disabled={rowsDisabled}
                  />
                  <Label htmlFor={`${id}-file-${index}`} className="library-picker-file">
                    <FileThumbnail file={file} />
                    <span className="library-picker-file-text">
                      <span className="library-picker-filename" title={file.fileName}>{file.fileName}</span>
                      <span className="library-picker-file-meta">
                        {bytes(file.fileSize)} · {categoryLabels[file.category]} · {formatDate(file.timeOfUpload, config)}
                      </span>
                    </span>
                  </Label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="library-picker-pagination">
          <span role="status">
            {files.isFetching ? "Loading files…" : `${files.data?.total || 0} files · Page ${page} of ${pages}`}
          </span>
          <div>
            <Button variant="outline" size="icon" aria-label="Previous library page" disabled={adding || files.isFetching || page <= 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft /></Button>
            <Button variant="outline" size="icon" aria-label="Next library page" disabled={adding || files.isFetching || files.isError || page >= pages} onClick={() => setPage((current) => current + 1)}><ChevronRight /></Button>
          </div>
        </div>
        <DialogFooter className="library-picker-footer">
          <p>Selections stay checked as you search and change pages.</p>
          <Button variant="outline" onClick={onClose} disabled={adding}>Cancel</Button>
          <Button onClick={addSelected} disabled={!count || adding}>
            {adding && <LoaderCircle className="animate-spin" />}
            {adding ? "Adding…" : `Add selected${count ? ` (${count})` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
