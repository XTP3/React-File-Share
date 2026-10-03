import { useEffect, useRef, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  Search,
  SlidersHorizontal,
  ArrowDownUp,
  List,
  LayoutGrid,
  X,
  ChevronLeft,
  ChevronRight,
  File as FileIcon,
  Image,
  Film,
  Music,
  FileText,
  Archive,
  MoreHorizontal,
  Download,
  Eye,
  Link,
  Trash2,
  FolderPlus,
  FolderMinus,
  RefreshCw,
  Check,
  CalendarDays,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { api, bytes, fileQuery, formatDate, shareURL } from "@/lib/api";
import { readPreferences, savePreferences } from "@/lib/preferences";
import {
  categories,
  categoryLabels,
  defaultPreferences,
  type ExplorerPreferences,
  type SharedFile,
  type Page,
  type PublicConfig,
} from "@/lib/types";
const icons = {
  photo: Image,
  gif: Image,
  video: Film,
  audio: Music,
  document: FileText,
  archive: Archive,
  other: FileIcon,
};
export function FileThumbnail({ file }: { file: SharedFile }) {
  const Icon = icons[file.category] || FileIcon;
  const [failed, setFailed] = useState(false);
  return (
    <span className={`file-thumbnail category-${file.category}`}>
      {(file.category === "photo" || file.category === "gif") && !failed ? (
        <img
          src={shareURL(file.uniqueID, "v")}
          loading="lazy"
          alt=""
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon />
      )}
    </span>
  );
}
function DatePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="field">
      <Label>{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="date-picker" aria-label={label}>
            <CalendarDays />
            {value
              ? formatDate(new Date(value + "T00:00:00").getTime())
              : "Choose date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value ? new Date(value + "T00:00:00") : undefined}
            onSelect={(date) => {
              if (!date) {
                onChange("");
                return;
              }
              onChange(
                `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
              );
            }}
          />
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => onChange("")}
          >
            Clear date
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
export function Explorer({
  user,
  collection,
  title,
  config,
  onUpload,
  onDelete,
  onAssign,
  onRemove,
  onPreview,
  onRefresh,
}: {
  user: string;
  collection: string;
  title: string;
  config?: PublicConfig;
  onUpload: () => void;
  onDelete: (files: SharedFile[]) => void;
  onAssign: (files: SharedFile[]) => void;
  onRemove: (files: SharedFile[]) => void;
  onPreview: (file: SharedFile) => void;
  onRefresh: () => void;
}) {
  const [prefs, setPrefs] = useState(() => readPreferences(user, collection));
  const [search, setSearch] = useState(prefs.q);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(new Set<string>());
  const [filters, setFilters] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    savePreferences(user, collection, prefs);
  }, [user, collection, prefs]);
  useEffect(() => () => clearTimeout(debounce.current), []);
  const query = fileQuery(prefs, page, collection);
  const files = useQuery({
    queryKey: ["files", user, collection, query],
    queryFn: ({ signal }) => api<Page>("/files?" + query, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 15000,
  });
  useEffect(() => {
    setSelected(new Set());
  }, [query]);
  useEffect(() => {
    if (
      files.data &&
      !files.isPlaceholderData &&
      page > Math.max(files.data.totalPages, 1)
    )
      setPage(Math.max(files.data.totalPages, 1));
  }, [files.data, files.isPlaceholderData, page]);
  function patch(value: Partial<ExplorerPreferences>) {
    setPrefs((p) => ({ ...p, ...value }));
    setPage(1);
  }
  function updateSearch(value: string) {
    setSearch(value);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => patch({ q: value }), 300);
  }
  function searchNow() {
    clearTimeout(debounce.current);
    patch({ q: search });
  }
  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const items = files.data?.items || [];
  const selectedFiles = items.filter((x) => selected.has(x.uniqueID));
  const activeFilters =
    prefs.categories.length +
    Number(!!prefs.minSize) +
    Number(!!prefs.maxSize) +
    Number(!!prefs.from) +
    Number(!!prefs.to);
  async function copy(file: SharedFile, kind: "d" | "v") {
    try {
      await navigator.clipboard.writeText(shareURL(file.uniqueID, kind));
      toast.success(`${kind === "v" ? "View" : "Download"} link copied`);
    } catch {
      toast.error(
        "Could not copy the link. Open the file to copy its address.",
      );
    }
  }
  function menu(file: SharedFile) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Actions for ${file.fileName}`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onPreview(file)}>
            <Eye />
            Preview
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={shareURL(file.uniqueID, "d")} download>
              <Download />
              Download
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => copy(file, "v")}>
            <Link />
            Copy view link
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => copy(file, "d")}>
            <Link />
            Copy download link
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onAssign([file])}>
            <FolderPlus />
            Add to collection
          </DropdownMenuItem>
          {collection !== "all" && collection !== "uncollected" && (
            <DropdownMenuItem onSelect={() => onRemove([file])}>
              <FolderMinus />
              Remove from collection
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => onDelete([file])}
          >
            <Trash2 />
            Delete file
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  return (
    <section className="explorer" aria-label="File explorer">
      <div className="explorer-heading">
        <div>
          <h2>{title}</h2>
          <p className="muted">
            {files.data
              ? `${files.data.total.toLocaleString()} ${files.data.total === 1 ? "file" : "files"}${prefs.q || activeFilters ? " match your search" : ""}`
              : "Everything you need, in one place."}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh files"
          onClick={() => {
            files.refetch();
            onRefresh();
          }}
          disabled={files.isFetching}
        >
          <RefreshCw className={files.isFetching ? "animate-spin" : ""} />
        </Button>
      </div>
      <div className="explorer-toolbar">
        <form
          className="search-field"
          onSubmit={(e) => {
            e.preventDefault();
            searchNow();
          }}
        >
          <Search />
          <Input
            aria-label="Search files"
            placeholder="Search your files…"
            value={search}
            onChange={(e) => updateSearch(e.target.value)}
            maxLength={200}
          />
          {search && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Clear search"
              onClick={() => {
                updateSearch("");
                clearTimeout(debounce.current);
                patch({ q: "" });
              }}
            >
              <X />
            </Button>
          )}
        </form>
        <Button variant="outline" onClick={() => setFilters(true)}>
          <SlidersHorizontal />
          <span>Filters</span>
          {activeFilters > 0 && (
            <Badge variant="secondary">{activeFilters}</Badge>
          )}
        </Button>
        <Select
          value={prefs.sort + ":" + prefs.direction}
          onValueChange={(v) => {
            const [sort, direction] = v.split(":");
            patch({
              sort: sort as ExplorerPreferences["sort"],
              direction: direction as "asc" | "desc",
            });
          }}
        >
          <SelectTrigger aria-label="Sort files" className="sort-control">
            <ArrowDownUp />
            <SelectValue />
          </SelectTrigger>
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
        <div className="view-switch">
          <Button
            variant={prefs.view === "list" ? "secondary" : "ghost"}
            size="icon"
            aria-label="List view"
            aria-pressed={prefs.view === "list"}
            onClick={() => patch({ view: "list" })}
          >
            <List />
          </Button>
          <Button
            variant={prefs.view === "grid" ? "secondary" : "ghost"}
            size="icon"
            aria-label="Grid view"
            aria-pressed={prefs.view === "grid"}
            onClick={() => patch({ view: "grid" })}
          >
            <LayoutGrid />
          </Button>
        </div>
      </div>
      {activeFilters > 0 && (
        <div className="active-filters">
          {prefs.categories.map((c) => (
            <Badge variant="secondary" key={c}>
              {categoryLabels[c]}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Clear ${categoryLabels[c]} filter`}
                onClick={() =>
                  patch({ categories: prefs.categories.filter((x) => x !== c) })
                }
              >
                <X />
              </Button>
            </Badge>
          ))}
          {prefs.minSize && (
            <Badge variant="secondary">Over {prefs.minSize} MB</Badge>
          )}
          {prefs.maxSize && (
            <Badge variant="secondary">Under {prefs.maxSize} MB</Badge>
          )}
          {prefs.from && <Badge variant="secondary">From {prefs.from}</Badge>}
          {prefs.to && <Badge variant="secondary">Until {prefs.to}</Badge>}
          <Button
            variant="link"
            size="sm"
            onClick={() =>
              patch({ ...defaultPreferences, q: prefs.q, view: prefs.view })
            }
          >
            Clear filters
          </Button>
        </div>
      )}
      {selected.size > 0 && (
        <div className="selection-bar">
          <span>
            <Check />
            {selected.size} selected
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAssign(selectedFiles)}
          >
            <FolderPlus />
            Add to collection
          </Button>
          {collection !== "all" && collection !== "uncollected" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRemove(selectedFiles)}
            >
              <FolderMinus />
              Remove
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(selectedFiles)}
          >
            <Trash2 />
            Delete
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Clear file selection"
            onClick={() => setSelected(new Set())}
          >
            <X />
          </Button>
        </div>
      )}
      {files.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            <span role="alert">{files.error.message}</span>
            <Button variant="outline" size="sm" onClick={() => files.refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {files.isPending ? (
        <div className="file-loading" aria-label="Loading files">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : items.length === 0 && !files.isError ? (
        <Empty className="file-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileIcon />
            </EmptyMedia>
            <EmptyTitle>
              {prefs.q || activeFilters
                ? "No files found"
                : "Room for something good"}
            </EmptyTitle>
            <EmptyDescription>
              {prefs.q || activeFilters
                ? "Try a different search or clear your filters."
                : "Upload your first files and make this space yours."}
            </EmptyDescription>
          </EmptyHeader>
          <Button
            onClick={() =>
              prefs.q || activeFilters
                ? (setSearch(""),
                  patch({ ...defaultPreferences, view: prefs.view }))
                : onUpload()
            }
          >
            {prefs.q || activeFilters
              ? "Reset search and filters"
              : "Upload files"}
          </Button>
        </Empty>
      ) : (
        <>
          <div
            className={
              prefs.view === "grid" ? "file-grid" : "desktop-file-table"
            }
            aria-busy={files.isFetching}
          >
            {prefs.view === "grid" ? (
              items.map((file) => (
                <Card className="file-grid-card" key={file.uniqueID}>
                  <CardContent>
                    <div className="grid-file-top">
                      <Checkbox
                        aria-label={`Select ${file.fileName}`}
                        checked={selected.has(file.uniqueID)}
                        onCheckedChange={() => toggle(file.uniqueID)}
                      />
                      {menu(file)}
                    </div>
                    <Button
                      className="grid-preview"
                      variant="ghost"
                      onClick={() => onPreview(file)}
                      aria-label={`Preview ${file.fileName}`}
                    >
                      <FileThumbnail file={file} />
                    </Button>
                    <p className="file-name" title={file.fileName}>
                      {file.fileName}
                    </p>
                    <span className="muted">
                      {bytes(file.fileSize)} ·{" "}
                      {formatDate(file.timeOfUpload, config)}
                    </span>
                  </CardContent>
                </Card>
              ))
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="checkbox-cell">
                      <Checkbox
                        aria-label="Select all files on this page"
                        checked={
                          items.length > 0 && selected.size === items.length
                        }
                        onCheckedChange={(checked) =>
                          setSelected(
                            checked
                              ? new Set(items.map((x) => x.uniqueID))
                              : new Set(),
                          )
                        }
                      />
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead className="actions-cell">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((file) => (
                    <TableRow
                      key={file.uniqueID}
                      data-state={
                        selected.has(file.uniqueID) ? "selected" : undefined
                      }
                    >
                      <TableCell>
                        <Checkbox
                          aria-label={`Select ${file.fileName}`}
                          checked={selected.has(file.uniqueID)}
                          onCheckedChange={() => toggle(file.uniqueID)}
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          className="file-name-button"
                          onClick={() => onPreview(file)}
                        >
                          <FileThumbnail file={file} />
                          <span title={file.fileName}>{file.fileName}</span>
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {categoryLabels[file.category] || "Other"}
                        </Badge>
                      </TableCell>
                      <TableCell className="muted whitespace-nowrap">
                        {bytes(file.fileSize)}
                      </TableCell>
                      <TableCell className="muted whitespace-nowrap">
                        {formatDate(file.timeOfUpload, config)}
                      </TableCell>
                      <TableCell>{menu(file)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          {prefs.view === "list" && (
            <div className="mobile-file-list">
              {items.map((file) => (
                <Card key={file.uniqueID}>
                  <CardContent>
                    <Checkbox
                      aria-label={`Select ${file.fileName}`}
                      checked={selected.has(file.uniqueID)}
                      onCheckedChange={() => toggle(file.uniqueID)}
                    />
                    <Button
                      variant="ghost"
                      className="file-name-button"
                      onClick={() => onPreview(file)}
                    >
                      <FileThumbnail file={file} />
                      <span>
                        <span className="file-name">{file.fileName}</span>
                        <span className="muted mobile-file-meta">
                          {bytes(file.fileSize)} ·{" "}
                          {formatDate(file.timeOfUpload, config)}
                        </span>
                      </span>
                    </Button>
                    {menu(file)}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
      <div className="pagination">
        <div className="page-size">
          <span className="muted">Show</span>
          <Select
            value={String(prefs.pageSize)}
            onValueChange={(v) => patch({ pageSize: Number(v) })}
          >
            <SelectTrigger aria-label="Files per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[25, 50, 100].map((n) => (
                <SelectItem value={String(n)} key={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="muted">
          Page {page} of {Math.max(files.data?.totalPages || 1, 1)}
        </span>
        <div>
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous page"
            disabled={page <= 1 || files.isPlaceholderData}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next page"
            disabled={
              page >= Math.max(files.data?.totalPages || 1, 1) ||
              files.isPlaceholderData
            }
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
      <Sheet open={filters} onOpenChange={setFilters}>
        <SheetContent className="filter-sheet">
          <SheetHeader>
            <SheetTitle>Filter files</SheetTitle>
            <SheetDescription>
              Combine filters to find exactly what you need.
            </SheetDescription>
          </SheetHeader>
          <div className="filter-body">
            <Label>File types</Label>
            <div className="category-filters">
              {categories.map((c) => (
                <Label key={c} className="category-option">
                  <Checkbox
                    checked={prefs.categories.includes(c)}
                    onCheckedChange={(checked) =>
                      patch({
                        categories: checked
                          ? [...prefs.categories, c]
                          : prefs.categories.filter((x) => x !== c),
                      })
                    }
                  />
                  {categoryLabels[c]}
                </Label>
              ))}
            </div>
            <div className="filter-range">
              <div className="field">
                <Label htmlFor="min-size">Minimum size (MB)</Label>
                <Input
                  id="min-size"
                  inputMode="decimal"
                  value={prefs.minSize}
                  placeholder="0"
                  onChange={(e) => {
                    if (/^\d*(\.\d*)?$/.test(e.target.value))
                      patch({ minSize: e.target.value });
                  }}
                />
              </div>
              <div className="field">
                <Label htmlFor="max-size">Maximum size (MB)</Label>
                <Input
                  id="max-size"
                  inputMode="decimal"
                  value={prefs.maxSize}
                  placeholder="No limit"
                  onChange={(e) => {
                    if (/^\d*(\.\d*)?$/.test(e.target.value))
                      patch({ maxSize: e.target.value });
                  }}
                />
              </div>
            </div>
            <DatePicker
              label="Uploaded from"
              value={prefs.from}
              onChange={(from) => patch({ from })}
            />
            <DatePicker
              label="Uploaded until"
              value={prefs.to}
              onChange={(to) => patch({ to })}
            />
            {Number(prefs.minSize) > Number(prefs.maxSize) && prefs.maxSize && (
              <Alert variant="destructive">
                <AlertDescription>
                  Maximum size must be greater than minimum size.
                </AlertDescription>
              </Alert>
            )}
            <div className="filter-footer">
              <Button
                variant="outline"
                onClick={() =>
                  patch({ ...defaultPreferences, q: prefs.q, view: prefs.view })
                }
              >
                Reset filters
              </Button>
              <Button onClick={() => setFilters(false)}>Show results</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
