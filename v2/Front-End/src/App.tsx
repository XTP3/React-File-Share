import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Files,
  Folder,
  Plus,
  Menu,
  CloudUpload,
  ChevronDown,
  Settings,
  LogOut,
  Trash2,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Auth } from "@/features/Auth";
import { Explorer } from "@/features/Explorer";
import { FilePreview } from "@/features/FilePreview";
import { Logo } from "@/components/Logo";
import { readPreferences, savePreferences } from "@/lib/preferences";
import { Storage } from "@/features/Storage";
import { UploadQueue } from "@/features/UploadQueue";
import { Connection } from "@/features/Connection";
import { ThemeControl } from "@/features/ThemeControl";
import { api, APIError, bytes, setCSRF } from "@/lib/api";
import type {
  Collection,
  Session,
  PublicConfig,
  StorageStats,
  SharedFile,
} from "@/lib/types";
function routeCollection() {
  try {
    return decodeURIComponent(
      location.pathname.match(/^\/collections\/([^/]+)/)?.[1] || "all",
    );
  } catch {
    return "all";
  }
}
type Action =
  | { kind: "create" }
  | { kind: "rename" | "deleteCollection"; collection: Collection }
  | { kind: "deleteFiles" | "assign" | "remove"; files: SharedFile[] }
  | { kind: "password" };
export default function App() {
  const client = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState("");
  const [collection, setCollection] = useState(() => routeCollection());
  const [mobileNav, setMobileNav] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(
    location.pathname.toLowerCase() === "/upload",
  );
  const [uploading, setUploading] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<SharedFile | null>(null);
  const config = useQuery({
    queryKey: ["config"],
    queryFn: ({ signal }) => api<PublicConfig>("/config", { signal }),
    staleTime: Infinity,
  });
  const collections = useQuery({
    queryKey: ["collections", session?.user.uniqueID],
    queryFn: ({ signal }) =>
      api<{ items: Collection[] }>("/collections", { signal }),
    enabled: !!session,
  });
  const stats = useQuery({
    queryKey: ["storage", session?.user.uniqueID],
    queryFn: ({ signal }) => api<StorageStats>("/storage", { signal }),
    enabled: !!session,
    staleTime: 30000,
  });
  const collectionStats = useQuery({
    queryKey: ["collectionStorage", session?.user.uniqueID, collection],
    queryFn: ({ signal }) =>
      api<StorageStats>(
        "/storage?collectionId=" + encodeURIComponent(collection),
        { signal },
      ),
    enabled: !!session && collection !== "all" && collection !== "uncollected",
    staleTime: 30000,
  });
  const [reconciling, setReconciling] = useState(false);
  const invalidate = useCallback(() => {
    client.invalidateQueries({ queryKey: ["files"] });
    client.invalidateQueries({ queryKey: ["collections"] });
    client.invalidateQueries({ queryKey: ["storage"] });
    client.invalidateQueries({ queryKey: ["collectionStorage"] });
  }, [client]);
  useEffect(() => {
    api<Session>("/auth/me")
      .then((s) => {
        setCSRF(s.csrfToken);
        setSession(s);
      })
      .catch((e) => {
        if (!(e instanceof APIError && e.status === 401))
          setAuthError(e.message);
      })
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    const expired = () => {
      client.cancelQueries();
      client.clear();
      setCSRF("");
      setSession(null);
      setAction(null);
      setPreview(null);
      setUploadOpen(false);
      setUploading(false);
      setAuthError("Your session expired. Log in to continue.");
      history.replaceState({}, "", "/Login");
    };
    window.addEventListener("fileshare:session-expired", expired);
    return () =>
      window.removeEventListener("fileshare:session-expired", expired);
  }, [client]);
  useEffect(() => {
    const navigate = () => {
      setCollection(routeCollection());
      setUploadOpen(location.pathname.toLowerCase() === "/upload");
    };
    window.addEventListener("popstate", navigate);
    return () => window.removeEventListener("popstate", navigate);
  }, []);

  useEffect(() => {
    if (session && collection === "uncollected") {
      savePreferences(session.user.uniqueID, "all", {
        ...readPreferences(session.user.uniqueID, "all"),
        uncollected: true,
      });
      history.replaceState({}, "", "/files");
      setCollection("all");
    }
  }, [session, collection]);

  function login(s: Session) {
    setCSRF(s.csrfToken);
    setSession(s);
    setAuthError("");
    history.replaceState({}, "", "/files");
  }
  function navigate(id: string) {
    setCollection(id);
    history.pushState(
      {},
      "",
      id === "all" ? "/files" : "/collections/" + encodeURIComponent(id),
    );
    setMobileNav(false);
  }
  function begin(next: Action) {
    setAction(next);
    setError("");
    setTitle("collection" in next ? next.collection.title : "");
    setTarget("");
  }
  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" }).catch((e) => {
        if (!(e instanceof APIError && e.status === 401)) throw e;
      });
      await client.cancelQueries();
      client.clear();
      setCSRF("");
      setSession(null);
      setCollection("all");
      setUploadOpen(false);
      setUploading(false);
      history.replaceState({}, "", "/Login");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function mutate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!action) return;
    setError("");
    setBusy(true);
    try {
      if (action.kind === "create" || action.kind === "rename") {
        if (!title.trim()) throw Error("Enter a collection name.");
        await api(
          action.kind === "create"
            ? "/collections"
            : "/collections/" + encodeURIComponent(action.collection.id),
          {
            method: action.kind === "create" ? "POST" : "PATCH",
            body: JSON.stringify({ title: title.trim() }),
          },
        );
        toast.success(
          action.kind === "create"
            ? "Collection created"
            : "Collection renamed",
        );
      } else if (action.kind === "deleteCollection") {
        await api("/collections/" + encodeURIComponent(action.collection.id), { method: "DELETE" });
        if (collection === action.collection.id) flushSync(() => navigate("all"));
        await client.cancelQueries({queryKey:["files",session?.user.uniqueID,action.collection.id]});
        client.removeQueries({queryKey:["files",session?.user.uniqueID,action.collection.id]});
        await client.cancelQueries({queryKey:["collectionStorage",session?.user.uniqueID,action.collection.id]});
        client.removeQueries({queryKey:["collectionStorage",session?.user.uniqueID,action.collection.id]});
        toast.success(
          "Collection deleted. Your files are still in your library.",
        );
      } else if (action.kind === "assign") {
        if (!target) throw Error("Choose a collection.");
        await api("/collections/" + encodeURIComponent(target) + "/files", {
          method: "POST",
          body: JSON.stringify({
            fileIds: action.files.map((f) => f.uniqueID),
          }),
        });
        toast.success("Files added to collection");
      } else if (action.kind === "remove") {
        await api("/collections/" + encodeURIComponent(collection) + "/files", {
          method: "DELETE",
          body: JSON.stringify({
            fileIds: action.files.map((f) => f.uniqueID),
          }),
        });
        toast.success(
          "Files removed from collection. Your library still has them.",
        );
      } else if (action.kind === "deleteFiles") {
        const outcomes = await Promise.allSettled(
          action.files.map((f) =>
            api("/files/" + encodeURIComponent(f.uniqueID), {
              method: "DELETE",
            }),
          ),
        );
        invalidate();
        const failed = outcomes.filter((x) => x.status === "rejected");
        if (failed.length)
          throw Error(
            `${failed.length} files could not be deleted. Refresh and try again.`,
          );
        toast.success(
          `${action.files.length} ${action.files.length === 1 ? "file" : "files"} deleted`,
        );
      } else if (action.kind === "password") {
        const data = new FormData(e.currentTarget);
        if (!data.get("currentPassword") || !data.get("newPassword"))
          throw Error("Complete all password fields.");
        if (data.get("newPassword") !== data.get("repeatPassword"))
          throw Error("The new passwords do not match.");
        await api("/account/password", {
          method: "POST",
          body: JSON.stringify({
            currentPassword: data.get("currentPassword"),
            newPassword: data.get("newPassword"),
          }),
        });
        client.clear();
        setCSRF("");
        setSession(null);
        toast.success("Password changed. Log in again.");
      }
      invalidate();
      setAction(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reconcile() {
    setReconciling(true);
    try {
      client.setQueryData(
        ["storage", session?.user.uniqueID],
        await api<StorageStats>("/storage/refresh", { method: "POST" }),
      );
      client.invalidateQueries({ queryKey: ["collectionStorage"] });
      toast.success("Storage totals refreshed");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setReconciling(false);
    }
  }
  const list = (collections.data?.items || [])
    .filter((c) => typeof c?.id === "string" && c.id.trim() && !["all", "uncollected"].includes(c.id))
    .map((c) => ({ ...c, title: typeof c.title === "string" && c.title.trim() ? c.title : "Untitled collection" }));
  const current = list.find((c) => c.id === collection);
  useEffect(() => {
    if (session && collections.isSuccess && collection !== "all" && collection !== "uncollected" && !current) {
      history.replaceState({}, "", "/files");
      setCollection("all");
      toast.info("This collection is unavailable. Showing your files.");
    }
  }, [session, collections.isSuccess, collection, current]);
  const nav = (
    <>
      <div className="brand"><Logo size={48} /></div>
      <span className="nav-caption">YOUR WORKSPACE</span>
      <Button
        variant="ghost"
        className={`nav-item ${collection === "all" ? "active" : ""}`}
        onClick={() => navigate("all")}
      >
        <Files />
        All Files
        <Badge variant="secondary">{stats.data?.totalFiles || 0}</Badge>
      </Button>
      <div className="nav-collections-heading">
        <span className="nav-caption">COLLECTIONS</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Create collection"
          onClick={() => begin({ kind: "create" })}
        >
          <Plus />
        </Button>
      </div>
      <div className="nav-collections">
        {list.map((c) => (
          <div
            key={c.id}
            className={`nav-collection-row ${collection === c.id ? "active" : ""}`}
          >
            <Button
              variant="ghost"
              className="nav-item"
              onClick={() => navigate(c.id)}
            >
              <Folder />
              <span>{c.title}</span>
              <span className="muted">{c.fileCount}</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Manage ${c.title}`}
                >
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  onSelect={() => begin({ kind: "rename", collection: c })}
                >
                  <Pencil />
                  Rename collection
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() =>
                    begin({ kind: "deleteCollection", collection: c })
                  }
                >
                  <Trash2 />
                  Delete collection
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>
    </>
  );
  if (checking)
    return (
      <main className="session-loading">
        <Card>
          <CardContent>
            <Logo size={56} />
            <p>Opening your workspace…</p>
            <Progress />
          </CardContent>
        </Card>
      </main>
    );
  if (!session)
    return (
      <>
        <div className="auth-theme">
          <ThemeControl />
        </div>
        <Connection uploading={false} />
        {authError && (
          <Alert>
            <AlertDescription role="alert">
              {authError}
              <Button variant="outline" onClick={() => location.reload()}>
                Reconnect
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <Auth onLogin={login} />
      </>
    );
  return (
    <div className="app-shell">
      <aside className="desktop-sidebar">{nav}</aside>
      <div className="workspace">
        <header className="app-header">
          <div className="header-left">
            <Button
              variant="ghost"
              size="icon"
              className="mobile-nav-button"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu />
            </Button>
            <span className="header-breadcrumb">
              <strong>
                {collection === "all"
                  ? "Files"
                  : collection === "uncollected"
                    ? "Uncollected"
                    : current?.title || "Collection"}
              </strong>
            </span>
          </div>
          <div className="header-actions">
            <ThemeControl />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="account-button"
                  aria-label="Account menu"
                >
                  <span className="avatar">
                    {session.user.username.slice(0, 1).toUpperCase()}
                  </span>
                  <span>{session.user.username}</span>
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => begin({ kind: "password" })}>
                  <Settings />
                  Change password
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={uploading} onSelect={logout}>
                  <LogOut />
                  {uploading ? "Finish uploads to sign out" : "Sign out"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="main-content">
          <Connection uploading={uploading} />
          <div className="page-heading">
            <div>
              <h1>{collection === "all" || collection === "uncollected" ? "Files" : current?.title || "Collection"}</h1>
            </div>
            <Button onClick={() => setUploadOpen(true)}>
              <CloudUpload />
              Upload
            </Button>
          </div>
          <Storage
            stats={stats.data}
            collectionCount={list.length}
            onRefresh={reconcile}
            refreshing={reconciling}
            config={config.data}
          />
          {stats.isError && (
            <Alert>
              <AlertDescription>
                Storage information is unavailable.{" "}
                <Button variant="link" onClick={() => stats.refetch()}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {collections.isError && (
            <Alert>
              <AlertDescription>
                Collections could not be loaded.{" "}
                <Button variant="link" onClick={() => collections.refetch()}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {current && (
            <div className="collection-summary">
              <Folder />
              <span>{current.title}</span>
              <span className="muted">
                {collectionStats.data?.totalFiles ?? current.fileCount} files ·{" "}
                {bytes(collectionStats.data?.totalBytes ?? current.totalBytes)}
              </span>
              <Badge variant="secondary">Private collection</Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => begin({ kind: "rename", collection: current })}
              >
                <Pencil />
                Rename
              </Button>
            </div>
          )}
          <Explorer
            key={session.user.uniqueID + ":" + collection}
            user={session.user.uniqueID}
            collection={collection}
            title={
              collection === "all"
                ? "All Files"
                : collection === "uncollected"
                  ? "Uncollected files"
                  : current?.title || "Collection files"
            }
            config={config.data}
            onUpload={() => setUploadOpen(true)}
            onDelete={(files) => begin({ kind: "deleteFiles", files })}
            onAssign={(files) => begin({ kind: "assign", files })}
            onRemove={(files) => begin({ kind: "remove", files })}
            onPreview={setPreview}
            onRefresh={invalidate}
          />
          <footer className="workspace-footer">
            <Logo size={24} />
            <span>Your files, simply shared.</span>
          </footer>
        </main>
      </div>
      <Sheet open={mobileNav} onOpenChange={setMobileNav}>
        <SheetContent side="left" className="mobile-sidebar">
          <SheetHeader className="sr-only">
            <SheetTitle>Your workspace</SheetTitle>
            <SheetDescription>Browse files and collections.</SheetDescription>
          </SheetHeader>
          {nav}
        </SheetContent>
      </Sheet>
      <UploadQueue
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        maxSize={config.data?.maxUploadSize || 100 * 1024 * 1024}
        collection={collection}
        onSuccess={invalidate}
        onActiveChange={setUploading}
      />
      <Dialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open && !busy) setAction(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action?.kind === "create"
                ? "Create collection"
                : action?.kind === "rename"
                  ? "Rename collection"
                  : action?.kind === "deleteCollection"
                    ? "Delete collection?"
                    : action?.kind === "assign"
                      ? "Add to collection"
                      : action?.kind === "remove"
                        ? "Remove from collection?"
                        : action?.kind === "password"
                          ? "Change password"
                          : "Delete files?"}
            </DialogTitle>
            <DialogDescription>
              {action?.kind === "deleteCollection"
                ? "Only the collection and its memberships will be removed. Your files stay in your library."
                : action?.kind === "deleteFiles"
                  ? "These files will be deleted from storage and all collections. Public links will stop working."
                  : action?.kind === "remove"
                    ? "Your files stay in the main library and their other collections."
                    : action?.kind === "assign"
                      ? "Files can belong to multiple collections and are stored only once."
                      : action?.kind === "password"
                        ? "Choose a new password. You will need to sign in again."
                        : "Give your collection a clear, memorable name."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={mutate} noValidate>
            {error && (
              <Alert variant="destructive">
                <AlertDescription role="alert">{error}</AlertDescription>
              </Alert>
            )}
            {(action?.kind === "create" || action?.kind === "rename") && (
              <div className="field">
                <Label htmlFor="collection-title">Collection name</Label>
                <Input
                  id="collection-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  autoFocus
                  placeholder="e.g. Project inspiration"
                />
              </div>
            )}
            {action?.kind === "assign" && (
              <div className="field">
                <Label>Collection</Label>
                <Select value={target} onValueChange={setTarget}>
                  <SelectTrigger aria-label="Select collection">
                    <SelectValue placeholder="Choose a collection" />
                  </SelectTrigger>
                  <SelectContent>
                    {list.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!list.length && (
                  <p className="muted">
                    Create a collection from the sidebar first.
                  </p>
                )}
              </div>
            )}
            {action?.kind === "password" && (
              <>
                <div className="field">
                  <Label htmlFor="current-password">Current password</Label>
                  <Input
                    id="current-password"
                    name="currentPassword"
                    type="password"
                    autoComplete="current-password"
                  />
                </div>
                <div className="field">
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    id="new-password"
                    name="newPassword"
                    type="password"
                    autoComplete="new-password"
                  />
                </div>
                <div className="field">
                  <Label htmlFor="repeat-new-password">
                    Confirm new password
                  </Label>
                  <Input
                    id="repeat-new-password"
                    name="repeatPassword"
                    type="password"
                    autoComplete="new-password"
                  />
                </div>
              </>
            )}
            {action && "files" in action && (
              <p className="muted">
                {action.files.length}{" "}
                {action.files.length === 1 ? "file" : "files"} selected
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setAction(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant={
                  action?.kind === "deleteCollection" ||
                  action?.kind === "deleteFiles"
                    ? "destructive"
                    : "default"
                }
                disabled={busy || (action?.kind === "assign" && !list.length)}
              >
                {busy
                  ? "Working…"
                  : action?.kind === "create"
                    ? "Create collection"
                    : action?.kind === "rename"
                      ? "Save changes"
                      : action?.kind === "assign"
                        ? "Add files"
                        : action?.kind === "remove"
                          ? "Remove membership"
                          : action?.kind === "password"
                            ? "Change password"
                            : "Delete"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <FilePreview file={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
