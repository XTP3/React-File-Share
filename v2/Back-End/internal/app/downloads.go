package app

import (
	"archive/zip"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const (
	downloadLifetime   = 5 * time.Minute
	downloadOwnerLimit = 4
	downloadTotalLimit = 128
	// Bound retained stat metadata independently of request/selection count.
	downloadMetadataLimit = 32 << 20
)

var errDownloadCapacity = errors.New("download metadata capacity reached")

type downloadFile struct {
	id, name string
	info     os.FileInfo
}

type downloadTicket struct {
	owner         string
	expires       time.Time
	files         []downloadFile
	active        bool
	metadataBytes int
}

type downloadStore struct {
	mu            sync.Mutex
	tickets       map[string]*downloadTicket
	metadataBytes int
}

func downloadMetadataSize(files []downloadFile) int {
	bytes := 0
	for _, item := range files {
		bytes += 512 + len(item.id) + len(item.name)
	}
	return bytes
}

func (a *App) downloadID(owner string, expires time.Time) string {
	prefix := randomID(24) + "." + strconv.FormatInt(expires.UnixMilli(), 36)
	return prefix + "." + a.downloadSignature(owner, prefix)
}

func (a *App) downloadSignature(owner, prefix string) string {
	h := hmac.New(sha256.New, []byte(a.Config.JWTSecretKey))
	h.Write([]byte("download:" + owner + ":" + prefix))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

// Expiration remains identifiable after pruning without keeping unbounded
// tombstones. Unknown IDs and another owner's signed IDs remain 404.
func (a *App) expiredDownload(owner, id string, now time.Time) bool {
	parts := strings.Split(id, ".")
	if len(parts) != 3 {
		return false
	}
	prefix := parts[0] + "." + parts[1]
	if !hmac.Equal([]byte(parts[2]), []byte(a.downloadSignature(owner, prefix))) {
		return false
	}
	ms, err := strconv.ParseInt(parts[1], 36, 64)
	return err == nil && !now.Before(time.UnixMilli(ms))
}

func (a *App) retainDownload(owner string, files []downloadFile, now time.Time) (string, time.Time, bool) {
	s := &a.downloads
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.tickets == nil {
		s.tickets = make(map[string]*downloadTicket)
	}
	owned := 0
	for id, ticket := range s.tickets {
		// Keep active transfers counted until they exit, even after expiry.
		if !ticket.active && !now.Before(ticket.expires) {
			s.metadataBytes -= ticket.metadataBytes
			delete(s.tickets, id)
			continue
		}
		if ticket.owner == owner {
			owned++
		}
	}
	metadataBytes := downloadMetadataSize(files)
	if owned >= downloadOwnerLimit || len(s.tickets) >= downloadTotalLimit || metadataBytes > downloadMetadataLimit-s.metadataBytes {
		return "", time.Time{}, false
	}
	expires := now.Add(downloadLifetime).Truncate(time.Millisecond)
	id := a.downloadID(owner, expires)
	s.tickets[id] = &downloadTicket{owner: owner, expires: expires, files: files, metadataBytes: metadataBytes}
	s.metadataBytes += metadataBytes
	return id, expires, true
}

func (a *App) claimDownload(owner, id string, now time.Time) (*downloadTicket, int) {
	s := &a.downloads
	s.mu.Lock()
	defer s.mu.Unlock()
	ticket, ok := s.tickets[id]
	if !ok || ticket.owner != owner {
		if a.expiredDownload(owner, id, now) {
			return nil, http.StatusGone
		}
		return nil, http.StatusNotFound
	}
	if !now.Before(ticket.expires) {
		return nil, http.StatusGone
	}
	if ticket.active {
		return nil, http.StatusConflict
	}
	ticket.active = true
	return ticket, 0
}

func (a *App) releaseDownload(id string) {
	a.downloads.mu.Lock()
	defer a.downloads.mu.Unlock()
	if ticket := a.downloads.tickets[id]; ticket != nil {
		ticket.active = false
	}
}

func (a *App) finishDownload(id string) {
	a.downloads.mu.Lock()
	defer a.downloads.mu.Unlock()
	if ticket := a.downloads.tickets[id]; ticket != nil {
		a.downloads.metadataBytes -= ticket.metadataBytes
		delete(a.downloads.tickets, id)
	}
}

func (a *App) createDownload(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FileIDs []string `json:"fileIds"`
	}
	if !decode(w, r, &body) {
		return
	}
	if len(body.FileIDs) == 0 {
		fail(w, 400, "select at least one file for a ZIP archive")
		return
	}
	ids := make([]string, 0, len(body.FileIDs))
	seen := make(map[string]bool, len(body.FileIDs))
	for _, id := range body.FileIDs {
		if !safeName(id) {
			fail(w, 400, "invalid file ID")
			return
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	owner := who(r).Owner
	cur, err := a.DB.Collection("files").Find(r.Context(), bson.M{"uploaderID": owner, "uniqueID": bson.M{"$in": ids}}, options.Find().SetProjection(bson.M{"uniqueID": 1, "uploaderID": 1, "fileName": 1, "_id": 0}))
	if err != nil {
		fail(w, 503, "file query unavailable")
		return
	}
	var records []bson.M
	if err = cur.All(r.Context(), &records); err != nil {
		fail(w, 503, "file query unavailable")
		return
	}
	byID := make(map[string]bson.M, len(records))
	for _, record := range records {
		byID[str(record, "uniqueID")] = record
	}
	files, err := a.prepareDownload(r.Context(), owner, ids, byID)
	if err != nil {
		if r.Context().Err() != nil {
			return
		}
		if errors.Is(err, errDownloadCapacity) {
			fail(w, 429, "ZIP selection exceeds server capacity; download a smaller selection")
			return
		}
		fail(w, 404, "one or more selected files are unavailable or cannot be safely archived")
		return
	}
	id, expires, ok := a.retainDownload(owner, files, time.Now())
	if !ok {
		w.Header().Set("Retry-After", "60")
		fail(w, 429, "too many pending ZIP downloads; wait for a ticket to expire")
		return
	}
	reply(w, 201, map[string]any{"id": id, "downloadUrl": "/api/v2/downloads/" + id + "/archive", "expiresAt": expires.UnixMilli()})
}

func (a *App) prepareDownload(ctx context.Context, owner string, ids []string, records map[string]bson.M) ([]downloadFile, error) {
	files := make([]downloadFile, 0, min(len(ids), 64))
	seen := make(map[string]bool, len(ids))
	metadataBytes := 0
	for _, id := range ids {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		record, ok := records[id]
		if !ok || str(record, "uploaderID") != owner {
			return nil, os.ErrNotExist
		}
		name := str(record, "fileName")
		// ZIP paths are extracted on many OSes; legacy Unix backslashes/colons
		// cannot safely retain their names there. Individual downloads still work.
		if !safeName(name) {
			return nil, os.ErrInvalid
		}
		if seen[name] {
			continue
		}
		metadataBytes += 512 + len(id) + len(name)
		if metadataBytes > downloadMetadataLimit {
			return nil, errDownloadCapacity
		}
		file := downloadFile{id: id, name: name}
		f, info, err := a.openDownloadFile(owner, file)
		if err != nil {
			return nil, err
		}
		f.Close()
		file.info = info
		files = append(files, file)
		seen[name] = true
	}
	return files, nil
}

// Resolve one regular source at a time, checking both the descriptor and path
// so replacements and symlinks cannot silently alter a prepared selection.
func (a *App) openDownloadFile(owner string, item downloadFile) (*os.File, os.FileInfo, error) {
	path, err := a.safePath(owner, item.name, false)
	if err != nil {
		return nil, nil, err
	}
	f, err := a.root.Open(path)
	if err != nil {
		return nil, nil, err
	}
	info, err := f.Stat()
	if err == nil {
		var current os.FileInfo
		current, err = a.root.Lstat(path)
		if err == nil && (!current.Mode().IsRegular() || !info.Mode().IsRegular() || !sameThumbnailSource(info, current) || (item.info != nil && !sameThumbnailSource(item.info, info))) {
			err = os.ErrNotExist
		}
	}
	if err != nil {
		f.Close()
		return nil, nil, err
	}
	return f, info, nil
}

func (a *App) downloadArchive(w http.ResponseWriter, r *http.Request) {
	id, owner := r.PathValue("id"), who(r).Owner
	ticket, status := a.claimDownload(owner, id, time.Now())
	if status != 0 {
		message := "download not found"
		if status == http.StatusGone {
			message = "download expired; request a new ZIP"
		}
		if status == http.StatusConflict {
			message = "download is already in progress"
		}
		fail(w, status, message)
		return
	}
	defer a.releaseDownload(id)
	// Revalidate all sources before headers are sent. The stream reopens each
	// source and validates it again, keeping the descriptor count bounded.
	for _, item := range ticket.files {
		if r.Context().Err() != nil {
			return
		}
		var record bson.M
		err := a.DB.Collection("files").FindOne(r.Context(), bson.M{"uniqueID": item.id, "uploaderID": owner, "fileName": item.name}).Decode(&record)
		if err != nil {
			if r.Context().Err() != nil {
				return
			}
			if errors.Is(err, mongo.ErrNoDocuments) {
				fail(w, 404, "one or more selected files are unavailable; request a new ZIP")
			} else {
				fail(w, 503, "file query unavailable")
			}
			return
		}
		f, _, err := a.openDownloadFile(owner, item)
		if err != nil {
			fail(w, 404, "one or more selected files are unavailable; request a new ZIP")
			return
		}
		f.Close()
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="X-files.zip"`)
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
	w.Header().Set("X-Accel-Buffering", "no")
	if r.Method == http.MethodHead {
		return
	}
	if err := a.writeDownloadArchive(r.Context(), w, owner, ticket.files); err != nil {
		// Never close the ZIP on failure: a central directory would make a
		// partial selection look like a successfully downloaded archive.
		panic(http.ErrAbortHandler)
	}
	a.finishDownload(id)
}

func (a *App) writeDownloadArchive(ctx context.Context, dst io.Writer, owner string, files []downloadFile) error {
	archive := zip.NewWriter(dst)
	buffer := make([]byte, 64<<10)
	for _, item := range files {
		if err := ctx.Err(); err != nil {
			return err
		}
		f, info, err := a.openDownloadFile(owner, item)
		if err != nil {
			return err
		}
		header := &zip.FileHeader{Name: item.name, Method: zip.Store, UncompressedSize64: uint64(info.Size())}
		header.SetModTime(info.ModTime())
		header.SetMode(0600)
		entry, err := archive.CreateHeader(header)
		if err == nil {
			var copied int64
			copied, err = io.CopyBuffer(entry, contextReader{ctx, io.NewSectionReader(f, 0, info.Size())}, buffer)
			if err == nil && copied != info.Size() {
				err = io.ErrUnexpectedEOF
			}
		}
		if err == nil {
			var after os.FileInfo
			after, err = f.Stat()
			if err == nil && !sameThumbnailSource(info, after) {
				err = errors.New("download source changed")
			}
			if err == nil {
				path, pathErr := a.safePath(owner, item.name, false)
				if pathErr != nil {
					err = pathErr
				} else {
					after, err = a.root.Lstat(path)
					if err == nil && !sameThumbnailSource(info, after) {
						err = errors.New("download source replaced")
					}
				}
			}
		}
		closeErr := f.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return archive.Close()
}
