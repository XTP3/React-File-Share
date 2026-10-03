package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
	"unicode"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

func safeName(s string) bool {
	if s == "" || s == "." || s == ".." || len(s) > 255 || strings.ContainsAny(s, "/\\:") {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) {
			return false
		}
	}
	return filepath.Base(s) == s
}

// Existing Unix uploads may contain colons or backslashes, which are legal
// filenames there. New uploads use the more portable safeName validation.
func safeStoredName(s string) bool {
	if s == "" || s == "." || s == ".." || len(s) > 255 || strings.Contains(s, "/") {
		return false
	}
	if runtime.GOOS == "windows" && strings.ContainsAny(s, "\\:") {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) {
			return false
		}
	}
	return filepath.Base(s) == s
}
func (a *App) safePath(owner, name string, create bool) (string, error) {
	if !safeName(owner) || !safeStoredName(name) {
		return "", errors.New("unsafe filename or owner")
	}
	i, e := a.root.Lstat(owner)
	if errors.Is(e, os.ErrNotExist) && create {
		e = a.root.Mkdir(owner, 0700)
		if e == nil {
			i, e = a.root.Lstat(owner)
			if e == nil {
				e = syncDir(a.root, ".")
			}
		}
	}
	if e != nil {
		return "", e
	}
	if !i.IsDir() || i.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("unsafe owner directory")
	}
	path := filepath.Join(owner, name)
	i, e = a.root.Lstat(path)
	if e == nil {
		if i.Mode()&os.ModeSymlink != 0 || !i.Mode().IsRegular() {
			return "", errors.New("unsafe file")
		}
	} else if !errors.Is(e, os.ErrNotExist) {
		return "", e
	}
	return path, nil
}

type operation struct {
	ID         string   `bson:"_id"`
	Kind       string   `bson:"kind"`
	State      string   `bson:"state"`
	StageDir   string   `bson:"stageDir,omitempty"`
	Files      []bson.M `bson:"files,omitempty"`
	Stages     []string `bson:"stages,omitempty"`
	Collection string   `bson:"collection,omitempty"`
	Original   bson.M   `bson:"original,omitempty"`
	Path       string   `bson:"path,omitempty"`
	Trash      string   `bson:"trash,omitempty"`
	Shared     bool     `bson:"shared,omitempty"`
}

func (a *App) saveOp(ctx context.Context, op operation) error {
	_, e := a.DB.Collection("storage_operations").InsertOne(ctx, op)
	return e
}
func (a *App) markOp(ctx context.Context, id, state string) error {
	_, e := a.DB.Collection("storage_operations").UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": bson.M{"state": state}})
	return e
}
func (a *App) removeOp(ctx context.Context, id string) error {
	_, e := a.DB.Collection("storage_operations").DeleteOne(ctx, bson.M{"_id": id})
	return e
}
func detached() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 30*time.Second)
}

func (a *App) rollbackUpload(ctx context.Context, op operation) error {
	// Staging retains the source inode until the operation is resolved. This
	// prevents recovery from deleting an unrelated pre-existing destination.
	for i, f := range op.Files {
		if i >= len(op.Stages) {
			return errors.New("corrupt upload journal")
		}
		path, e := a.safePath(str(f, "uploaderID"), str(f, "fileName"), false)
		if e != nil {
			if errors.Is(e, os.ErrNotExist) {
				continue
			}
			return e
		}
		dest, de := a.root.Lstat(path)
		stage, se := a.root.Lstat(op.Stages[i])
		if de == nil && se == nil && os.SameFile(dest, stage) {
			if e = a.root.Remove(path); e != nil {
				return e
			}
			if e = syncDir(a.root, str(f, "uploaderID")); e != nil {
				return e
			}
		}
	}
	ids := bson.A{}
	fileids := bson.A{}
	for _, f := range op.Files {
		ids = append(ids, f["_id"])
		fileids = append(fileids, f["uniqueID"])
	}
	if len(ids) > 0 {
		if _, e := a.DB.Collection("files").DeleteMany(ctx, bson.M{"_id": bson.M{"$in": ids}}); e != nil {
			return e
		}
		if _, e := a.DB.Collection("collection_memberships").DeleteMany(ctx, bson.M{"fileId": bson.M{"$in": fileids}}); e != nil {
			return e
		}
	}
	if op.StageDir != "" {
		if e := a.root.RemoveAll(op.StageDir); e != nil {
			return e
		}
	}
	return a.removeOp(ctx, op.ID)
}
func (a *App) finishUpload(ctx context.Context, op operation) error {
	if e := a.root.RemoveAll(op.StageDir); e != nil {
		return e
	}
	return a.removeOp(ctx, op.ID)
}
func (a *App) finishDelete(ctx context.Context, op operation) error {
	// An intent with neither trash nor a removed source has not moved the file.
	// Keep the BSON record when moving an existing source fails.
	var current bson.M
	metadataErr := a.DB.Collection("files").FindOne(ctx, bson.M{"_id": op.Original["_id"]}).Decode(&current)
	if metadataErr != nil && !errors.Is(metadataErr, mongo.ErrNoDocuments) {
		return metadataErr
	}
	if !op.Shared && op.State != "committed" && metadataErr == nil {
		_, te := a.root.Lstat(op.Trash)
		if errors.Is(te, os.ErrNotExist) {
			if _, e := a.safePath(str(op.Original, "uploaderID"), str(op.Original, "fileName"), false); e != nil && !errors.Is(e, os.ErrNotExist) {
				return e
			}
			if _, e := a.root.Lstat(op.Path); e == nil {
				if e = a.root.Rename(op.Path, op.Trash); e != nil {
					return e
				}
				if e = syncDir(a.root, str(op.Original, "uploaderID")); e != nil {
					return e
				}
				if e = syncDir(a.root, ".trash"); e != nil {
					return e
				}
			} else if !errors.Is(e, os.ErrNotExist) {
				return e
			}
		} else if te != nil {
			return te
		}
	}
	if _, e := a.DB.Collection("files").DeleteOne(ctx, bson.M{"_id": op.Original["_id"]}); e != nil {
		return e
	}
	// Legacy IDs are intended to be unique; preserve memberships if corrupt
	// duplicate IDs still have another visible reference.
	n, e := a.DB.Collection("files").CountDocuments(ctx, bson.M{"uploaderID": str(op.Original, "uploaderID"), "uniqueID": str(op.Original, "uniqueID")})
	if e != nil {
		return e
	}
	if n == 0 {
		if _, e = a.DB.Collection("collection_memberships").DeleteMany(ctx, bson.M{"ownerID": str(op.Original, "uploaderID"), "fileId": str(op.Original, "uniqueID")}); e != nil {
			return e
		}
	}
	if e = a.markOp(ctx, op.ID, "committed"); e != nil {
		return e
	}
	if !op.Shared {
		if e = a.root.Remove(op.Trash); e != nil && !errors.Is(e, os.ErrNotExist) {
			return e
		}
		if e = syncDir(a.root, ".trash"); e != nil {
			return e
		}
	}
	return a.removeOp(ctx, op.ID)
}
func (a *App) recoverOperations(ctx context.Context) error {
	cur, e := a.DB.Collection("storage_operations").Find(ctx, bson.M{})
	if e != nil {
		return e
	}
	var ops []operation
	if e = cur.All(ctx, &ops); e != nil {
		return e
	}
	for _, op := range ops {
		switch op.Kind {
		case "upload":
			if op.State == "committed" {
				e = a.finishUpload(ctx, op)
			} else {
				e = a.rollbackUpload(ctx, op)
			}
		case "delete":
			e = a.finishDelete(ctx, op)
		default:
			return fmt.Errorf("unknown journal kind %q", op.Kind)
		}
		if e != nil {
			return e
		}
	}
	// A killed process can leave a staging directory before its first durable
	// journal update. With the exclusive runtime lock, no live upload uses it.
	dir, e := a.root.Open(".staging")
	if e != nil {
		return e
	}
	entries, e := dir.ReadDir(-1)
	dir.Close()
	if e != nil {
		return e
	}
	for _, entry := range entries {
		if e = a.root.RemoveAll(filepath.Join(".staging", entry.Name())); e != nil {
			return e
		}
	}
	return nil
}

type contextReader struct {
	ctx context.Context
	r   io.Reader
}

func (c contextReader) Read(b []byte) (int, error) {
	if e := c.ctx.Err(); e != nil {
		return 0, e
	}
	return c.r.Read(b)
}

func (a *App) upload(w http.ResponseWriter, r *http.Request) {
	http.NewResponseController(w).EnableFullDuplex()
	id := who(r)
	cid := r.URL.Query().Get("collectionId")
	if cid != "" {
		if _, e := a.ownedCollection(r.Context(), id.Owner, cid); e != nil {
			fail(w, 404, "collection not found")
			return
		}
	}
	// Bound multipart headers and non-file data in addition to aggregate bytes.
	overhead := int64(16 << 20)
	limit := a.Config.MaxUploadSize
	if limit > int64(^uint64(0)>>1)-overhead {
		fail(w, 500, "invalid upload limit")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit+overhead)
	reader, e := r.MultipartReader()
	if e != nil {
		fail(w, 400, "multipart upload required")
		return
	}
	op := operation{ID: randomID(20), Kind: "upload", State: "intent", Collection: cid}
	op.StageDir = filepath.Join(".staging", op.ID)
	if e = a.saveOp(r.Context(), op); e != nil {
		fail(w, 503, "upload journal unavailable")
		return
	}
	completed := false
	defer func() {
		if !completed {
			ctx, cancel := detached()
			defer cancel()
			if e := a.rollbackUpload(ctx, op); e != nil {
				logOperation(op.ID, e)
			}
			a.invalidateStats(id.Owner)
		}
	}()
	if e = a.root.Mkdir(op.StageDir, 0700); e != nil {
		fail(w, 500, "staging directory unavailable")
		return
	}
	seen := map[string]bool{}
	total := int64(0)
	parts := 0
	for {
		part, e := reader.NextPart()
		if errors.Is(e, io.EOF) {
			break
		}
		if e != nil {
			var tooLarge *http.MaxBytesError
			if errors.As(e, &tooLarge) {
				fail(w, 413, "upload exceeds request size limit")
			} else {
				fail(w, 400, "incomplete multipart upload")
			}
			return
		}
		parts++
		if parts > 1000 {

			fail(w, 400, "too many multipart parts")
			return
		}
		_, params, e := mime.ParseMediaType(part.Header.Get("Content-Disposition"))
		if e != nil {

			fail(w, 400, "invalid multipart disposition")
			return
		}
		name, hasFile := params["filename"]
		if !hasFile {
			n, e := io.Copy(io.Discard, io.LimitReader(part, 1<<20+1))

			if e != nil || n > 1<<20 {
				fail(w, 400, "multipart field is too large")
				return
			}
			continue
		}
		if !safeName(name) {

			fail(w, 400, "unsafe filename")
			return
		}
		if seen[name] {

			fail(w, 409, "duplicate filename in upload batch")
			return
		}
		seen[name] = true
		path, e := a.safePath(id.Owner, name, true)
		if e != nil {

			fail(w, 400, "unsafe upload destination")
			return
		}
		if _, e = a.root.Lstat(path); e == nil {

			fail(w, 409, "a file with that name already exists")
			return
		} else if !errors.Is(e, os.ErrNotExist) {

			fail(w, 500, "destination unavailable")
			return
		}
		n, e := a.DB.Collection("files").CountDocuments(r.Context(), bson.M{"uploaderID": id.Owner, "fileName": name})
		if e != nil {

			fail(w, 503, "database unavailable")
			return
		}
		if n > 0 {

			fail(w, 409, "a record with that filename already exists")
			return
		}
		stage := filepath.Join(op.StageDir, fmt.Sprint(len(op.Files)))
		f, e := a.root.OpenFile(stage, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {

			fail(w, 500, "staging file unavailable")
			return
		}
		size, e := io.CopyBuffer(f, io.LimitReader(contextReader{r.Context(), part}, limit-total+1), make([]byte, 64<<10))
		if e == nil {
			e = f.Sync()
		}
		closeErr := f.Close()

		if e == nil {
			e = closeErr
		}
		if size > limit-total {
			fail(w, 413, "aggregate file bytes exceed upload limit")
			return
		}
		if e != nil {
			fail(w, 400, "upload interrupted")
			return
		}
		total += size
		typ := part.Header.Get("Content-Type")
		if typ == "" {
			typ = mime.TypeByExtension(filepath.Ext(name))
		}
		if typ == "" {
			typ = "application/octet-stream"
		}
		if _, _, e = mime.ParseMediaType(typ); e != nil {
			fail(w, 400, "invalid file MIME type")
			return
		}
		now := time.Now()
		loc, _ := time.LoadLocation(a.Config.DateTimezoneRegion)
		file := bson.M{"_id": bson.NewObjectID(), "uniqueID": randomID(8), "fileName": name, "fileSize": float64(size), "fileType": typ, "uploaderID": id.Owner, "timeOfUpload": float64(now.UnixMilli()), "timeOfUploadDate": dateDisplay(now.In(loc), a.Config.DateLanguage), "__v": int32(0)}
		op.Files = append(op.Files, file)
		op.Stages = append(op.Stages, stage)
	}
	if len(op.Files) == 0 {
		fail(w, 400, "select at least one file")
		return
	}
	if e = r.Context().Err(); e != nil {
		fail(w, 400, "upload cancelled")
		return
	}
	a.mutation.Lock()
	defer a.mutation.Unlock()
	if cid != "" {
		if _, e = a.ownedCollection(r.Context(), id.Owner, cid); e != nil {
			fail(w, 404, "collection not found")
			return
		}
	}
	if e = syncDir(a.root, ".staging"); e != nil {
		fail(w, 500, "staging parent sync failed")
		return
	}
	if e = syncDir(a.root, op.StageDir); e != nil {
		fail(w, 500, "staging sync failed")
		return
	}
	if _, e = a.DB.Collection("storage_operations").UpdateOne(r.Context(), bson.M{"_id": op.ID}, bson.M{"$set": bson.M{"files": op.Files, "stages": op.Stages}}); e != nil {
		fail(w, 503, "upload journal unavailable")
		return
	}
	for i, file := range op.Files {
		if e = r.Context().Err(); e != nil {
			fail(w, 400, "upload cancelled")
			return
		}
		path, e := a.safePath(id.Owner, str(file, "fileName"), false)
		if e != nil {
			fail(w, 400, "unsafe destination")
			return
		}
		count, e := a.DB.Collection("files").CountDocuments(r.Context(), bson.M{"uploaderID": id.Owner, "fileName": str(file, "fileName")})
		if e != nil {
			fail(w, 503, "database unavailable")
			return
		}
		if count > 0 {
			fail(w, 409, "a file record with that name already exists")
			return
		}
		// Hard-link publication is atomic and never replaces an existing path.
		if e = a.root.Link(op.Stages[i], path); e != nil {
			if errors.Is(e, os.ErrExist) {
				fail(w, 409, "a file with that name already exists")
			} else {
				fail(w, 500, "file publication failed")
			}
			return
		}
	}
	if e = syncDir(a.root, id.Owner); e != nil {
		fail(w, 500, "destination sync failed")
		return
	}
	if _, e = a.DB.Collection("files").InsertMany(r.Context(), op.Files); e != nil {
		fail(w, 503, "file metadata could not be saved")
		return
	}
	if cid != "" {
		for _, f := range op.Files {
			if _, e = a.DB.Collection("collection_memberships").InsertOne(r.Context(), bson.M{"ownerID": id.Owner, "collectionId": cid, "fileId": f["uniqueID"]}); e != nil {
				fail(w, 503, "collection assignment failed")
				return
			}
		}
	}
	if e = a.markOp(r.Context(), op.ID, "committed"); e != nil {
		fail(w, 503, "upload commit failed")
		return
	}
	completed = true
	a.invalidateStats(id.Owner)
	ctx, cancel := detached()
	defer cancel()
	if e = a.finishUpload(ctx, op); e != nil {
		logOperation(op.ID, e)
	}
	if strings.HasPrefix(r.URL.Path, "/api/v2/") {
		out := []bson.M{}
		for _, f := range op.Files {
			f["category"] = category(str(f, "fileName"), str(f, "fileType"))
			out = append(out, f)
		}
		reply(w, 200, map[string]any{"files": out})
	} else {
		ok(w, 200)
	}
}
func logOperation(id string, e error) {
	fmt.Fprintf(os.Stderr, "storage operation %s remains recoverable: %v\n", id, e)
}

func (a *App) deleteFile(w http.ResponseWriter, r *http.Request) {
	id := who(r)
	a.mutation.Lock()
	defer a.mutation.Unlock()
	var file bson.M
	e := a.DB.Collection("files").FindOne(r.Context(), bson.M{"uploaderID": id.Owner, "uniqueID": r.PathValue("id")}).Decode(&file)
	if e != nil {
		if errors.Is(e, mongo.ErrNoDocuments) {
			fail(w, 404, "file not found")
		} else {
			fail(w, 503, "database unavailable")
		}
		return
	}
	path, e := a.safePath(id.Owner, str(file, "fileName"), false)
	if e != nil && !errors.Is(e, os.ErrNotExist) {
		fail(w, 500, "unsafe file path")
		return
	}
	if path == "" {
		path = filepath.Join(id.Owner, str(file, "fileName"))
	}
	refs, e := a.DB.Collection("files").CountDocuments(r.Context(), bson.M{"uploaderID": id.Owner, "fileName": str(file, "fileName"), "_id": bson.M{"$ne": file["_id"]}})
	if e != nil {
		fail(w, 503, "database unavailable")
		return
	}
	op := operation{ID: randomID(20), Kind: "delete", State: "intent", Original: file, Path: path, Shared: refs > 0}
	op.Trash = filepath.Join(".trash", op.ID)
	if e = a.saveOp(r.Context(), op); e != nil {
		fail(w, 503, "deletion journal unavailable")
		return
	}
	defer a.invalidateStats(id.Owner)
	// Finish after client cancellation as well: a journaled deletion is an
	// explicit recoverable intent, and can be completed on restart.
	ctx, cancel := detached()
	defer cancel()
	if e = a.finishDelete(ctx, op); e != nil {
		logOperation(op.ID, e)
		fail(w, 503, "deletion pending recovery")
		return
	}
	a.invalidateStats(id.Owner)
	ok(w, 200)
}
