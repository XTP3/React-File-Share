// Package app implements v2 and the original v1 API over the same BSON records.
package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gofrs/flock"
	"go.mongodb.org/mongo-driver/v2/mongo/writeconcern"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/XTP3/React-File-Share/v2/internal/config"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/x/mongo/driver/connstring"
)

type App struct {
	Version    string
	Config     config.Config
	DB         *mongo.Database
	client     *mongo.Client
	root       *os.Root
	lock       *flock.Flock
	mutation   sync.Mutex
	rateMu     sync.Mutex
	rates      map[string]rateEntry
	statsMu    sync.Mutex
	stats      map[string]cachedStats
	thumbnails thumbnailCache
}

func New(ctx context.Context, c config.Config) (*App, error) {
	cs, e := connstring.ParseAndValidate(c.DatabaseURL)
	if e != nil {
		return nil, e
	}
	if cs.Database == "" {
		return nil, errors.New("DATABASE_URL must name the existing database")
	}
	cl, e := mongo.Connect(options.Client().ApplyURI(c.DatabaseURL).SetTimeout(15 * time.Second).SetWriteConcern(&writeconcern.WriteConcern{W: 1, Journal: boolPointer(true)}))
	if e != nil {
		return nil, e
	}
	if e = cl.Ping(ctx, nil); e != nil {
		cl.Disconnect(context.Background())
		return nil, e
	}
	if e = os.MkdirAll(c.UploadsDir, 0700); e != nil {
		cl.Disconnect(context.Background())
		return nil, e
	}
	if i, e := os.Lstat(c.UploadsDir); e != nil || i.Mode()&os.ModeSymlink != 0 {
		cl.Disconnect(context.Background())
		return nil, errors.New("uploads directory must not be a symlink")
	}
	root, e := os.OpenRoot(c.UploadsDir)
	if e != nil {
		cl.Disconnect(context.Background())
		return nil, e
	}
	a := &App{Version: "2.1.0", Config: c, DB: cl.Database(cs.Database), client: cl, root: root, stats: map[string]cachedStats{}, rates: map[string]rateEntry{}}
	if info, err := a.root.Lstat(".fileshare.lock"); err == nil && (!info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0) {
		a.Close(context.Background())
		return nil, errors.New("unsafe runtime lock")
	}
	a.lock = flock.New(filepath.Join(c.UploadsDir, ".fileshare.lock"))
	locked, e := a.lock.TryLock()
	if e != nil || !locked {
		a.Close(context.Background())
		return nil, errors.New("uploads directory is already in use")
	}
	for _, dir := range []string{".staging", ".trash"} {
		if info, err := a.root.Lstat(dir); err == nil && (!info.IsDir() || info.Mode()&os.ModeSymlink != 0) {
			a.Close(context.Background())
			return nil, errors.New("unsafe internal storage directory")
		}
	}
	if e = a.root.MkdirAll(".staging", 0700); e != nil {
		a.Close(context.Background())
		return nil, e
	}
	if e = a.root.MkdirAll(".trash", 0700); e != nil {
		a.Close(context.Background())
		return nil, e
	}
	if e = syncDir(a.root, "."); e != nil {
		a.Close(context.Background())
		return nil, e
	}
	if e = a.indexes(ctx); e != nil {
		a.Close(context.Background())
		return nil, e
	}
	if e = a.recoverOperations(ctx); e != nil {
		a.Close(context.Background())
		return nil, fmt.Errorf("storage recovery: %w", e)
	}
	if e = os.MkdirAll(c.WWWDir, 0755); e != nil {
		a.Close(context.Background())
		return nil, e
	}
	return a, nil
}
func boolPointer(b bool) *bool { return &b }
func (a *App) Close(ctx context.Context) error {
	if a.lock != nil {
		a.lock.Unlock()
	}
	a.root.Close()
	return a.client.Disconnect(ctx)
}
func (a *App) indexes(ctx context.Context) error {
	sets := map[string][]mongo.IndexModel{
		"users":                  {{Keys: bson.D{{Key: "username", Value: 1}}}, {Keys: bson.D{{Key: "uniqueID", Value: 1}}}},
		"files":                  {{Keys: bson.D{{Key: "uploaderID", Value: 1}, {Key: "fileName", Value: 1}, {Key: "_id", Value: 1}}}, {Keys: bson.D{{Key: "uploaderID", Value: 1}, {Key: "timeOfUpload", Value: -1}, {Key: "_id", Value: 1}}}, {Keys: bson.D{{Key: "uploaderID", Value: 1}, {Key: "fileSize", Value: 1}, {Key: "_id", Value: 1}}}, {Keys: bson.D{{Key: "uniqueID", Value: 1}}}},
		"collections":            {{Keys: bson.D{{Key: "ownerID", Value: 1}, {Key: "id", Value: 1}}, Options: options.Index().SetUnique(true)}},
		"collection_memberships": {{Keys: bson.D{{Key: "ownerID", Value: 1}, {Key: "collectionId", Value: 1}, {Key: "fileId", Value: 1}}, Options: options.Index().SetUnique(true)}, {Keys: bson.D{{Key: "ownerID", Value: 1}, {Key: "fileId", Value: 1}}}},
		"sessions":               {{Keys: bson.D{{Key: "expiresAt", Value: 1}}, Options: options.Index().SetExpireAfterSeconds(0)}, {Keys: bson.D{{Key: "ownerID", Value: 1}}}},
	}
	for name, models := range sets {
		// These are lookup indexes, not new constraints. Deployments may already
		// have unique or custom-named versions; keep their definitions intact.
		// V2-owned unique and TTL indexes below still use strict creation.
		if name == "users" || name == "files" {
			existing, e := a.DB.Collection(name).Indexes().ListSpecifications(ctx)
			if e != nil {
				return fmt.Errorf("list indexes %s: %w", name, e)
			}
			missing := make([]mongo.IndexModel, 0, len(models))
			for _, model := range models {
				keys, e := bson.Marshal(model.Keys)
				if e != nil {
					return fmt.Errorf("index keys %s: %w", name, e)
				}
				found := false
				for _, index := range existing {
					if bytes.Equal(keys, index.KeysDocument) {
						found = true
						break
					}
				}
				if !found {
					missing = append(missing, model)
				}
			}
			models = missing
		}
		if len(models) == 0 {
			continue
		}
		if _, e := a.DB.Collection(name).Indexes().CreateMany(ctx, models); e != nil {
			return fmt.Errorf("index %s: %w", name, e)
		}
	}
	return nil
}
func (a *App) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v2/config", func(w http.ResponseWriter, r *http.Request) {
		reply(w, 200, map[string]any{"version": a.Version, "maxUploadSize": a.Config.MaxUploadSize, "dateLanguage": a.Config.DateLanguage, "timeZone": a.Config.DateTimezoneRegion})
	})
	mux.HandleFunc("POST /api/v2/auth/register", a.register)
	mux.HandleFunc("POST /api/account/create", a.register)
	mux.HandleFunc("POST /api/v2/auth/login", a.login)
	mux.HandleFunc("POST /api/authentication/login", a.login)
	mux.HandleFunc("POST /api/authentication/token", a.private(a.token))
	mux.HandleFunc("GET /api/v2/auth/me", a.private(a.me))
	mux.HandleFunc("POST /api/v2/auth/logout", a.private(a.logout))
	mux.HandleFunc("POST /api/v2/account/password", a.private(a.password))
	mux.HandleFunc("POST /api/account/change", a.private(a.password))
	mux.HandleFunc("GET /api/v2/files", a.private(a.list))
	mux.HandleFunc("GET /api/v2/files/{id}/thumbnail", a.private(a.thumbnail))
	mux.HandleFunc("POST /f", a.private(a.legacyList))
	mux.HandleFunc("GET /f/s/{query}", a.private(a.legacySearch))
	mux.HandleFunc("POST /api/v2/files/upload", a.private(a.upload))
	mux.HandleFunc("POST /api/files/upload", a.private(a.upload))
	mux.HandleFunc("DELETE /api/v2/files/{id}", a.private(a.deleteFile))
	mux.HandleFunc("DELETE /api/files/delete/{id}", a.private(a.deleteFile))
	mux.HandleFunc("GET /f/d/{id}", a.download)
	mux.HandleFunc("GET /f/v/{id}", a.download)
	mux.HandleFunc("GET /api/v2/collections", a.private(a.collections))
	mux.HandleFunc("POST /api/v2/collections", a.private(a.collections))
	mux.HandleFunc("PATCH /api/v2/collections/{id}", a.private(a.collection))
	mux.HandleFunc("DELETE /api/v2/collections/{id}", a.private(a.collection))
	mux.HandleFunc("POST /api/v2/collections/{id}/files", a.private(a.memberships))
	mux.HandleFunc("DELETE /api/v2/collections/{id}/files", a.private(a.memberships))
	mux.HandleFunc("GET /api/v2/storage", a.private(a.storage))
	mux.HandleFunc("POST /api/v2/storage/refresh", a.private(a.storage))
	mux.HandleFunc("GET /", a.static)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { fail(w, 404, "not found") })
	return a.security(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		defer func() {
			if e := recover(); e != nil {
				log.Printf("request failed: %v", e)
				fail(w, 500, "request failed")
			}
		}()
		_, pattern := mux.Handler(r)
		if pattern == "/" || ((pattern == "GET /") && (strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/f/") || r.URL.Path == "/f")) {
			methods := []string{}
			for _, method := range []string{"GET", "HEAD", "POST", "PATCH", "DELETE"} {
				probe := new(http.Request)
				*probe = *r
				probe.Method = method
				_, p := mux.Handler(probe)
				if p != "/" && p != "GET /" && p != "" {
					methods = append(methods, method)
				}
			}
			if len(methods) > 0 {
				w.Header().Set("Allow", strings.Join(methods, ", "))
				fail(w, 405, "method not allowed")
				return
			}
		}
		mux.ServeHTTP(w, r)
	}))
}
func (a *App) static(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/f/") {
		fail(w, 404, "not found")
		return
	}
	root, e := os.OpenRoot(a.Config.WWWDir)
	if e != nil {
		fail(w, 503, "frontend build is unavailable")
		return
	}
	defer root.Close()
	name := strings.TrimPrefix(r.URL.Path, "/")
	if name == "" {
		name = "index.html"
	}
	f, e := root.Open(name)
	if e == nil {
		defer f.Close()
		i, e := f.Stat()
		if e == nil && !i.IsDir() {
			if filepath.Base(name) == "index.html" || filepath.Base(name) == "sw.js" {
				w.Header().Set("Cache-Control", "no-cache")
			}
			http.ServeContent(w, r, name, i.ModTime(), f)
			return
		}
	}
	if filepath.Ext(name) != "" {
		fail(w, 404, "not found")
		return
	}
	f, e = root.Open("index.html")
	if e != nil {
		fail(w, 503, "frontend build is unavailable")
		return
	}
	defer f.Close()
	i, e := f.Stat()
	if e != nil {
		fail(w, 503, "frontend build is unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, "index.html", i.ModTime(), f)
}
func reply(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if v != nil {
		json.NewEncoder(w).Encode(jsonValue(v))
	}
}
func fail(w http.ResponseWriter, status int, message string) {
	reply(w, status, map[string]string{"error": message})
}
func ok(w http.ResponseWriter, status int) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(status)
	fmt.Fprint(w, http.StatusText(status))
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	d := json.NewDecoder(r.Body)
	if e := d.Decode(v); e != nil {
		fail(w, 400, "invalid JSON body")
		return false
	}
	var extra any
	if e := d.Decode(&extra); !errors.Is(e, io.EOF) {
		fail(w, 400, "body must contain one JSON object")
		return false
	}
	return true
}
func jsonValue(v any) any {
	switch x := v.(type) {
	case bson.M:
		m := map[string]any{}
		for k, v := range x {
			m[k] = jsonValue(v)
		}
		return m
	case map[string]any:
		m := map[string]any{}
		for k, v := range x {
			m[k] = jsonValue(v)
		}
		return m
	case bson.D:
		m := map[string]any{}
		for _, e := range x {
			m[e.Key] = jsonValue(e.Value)
		}
		return m
	case bson.A:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = jsonValue(e)
		}
		return out
	case []bson.M:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = jsonValue(e)
		}
		return out
	case bson.DateTime:
		return x.Time().UTC().Format(time.RFC3339Nano)
	default:
		return v
	}
}
func str(m bson.M, k string) string { s, _ := m[k].(string); return s }
func number(v any) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case int32:
		return int64(n)
	case int:
		return int64(n)
	case float64:
		return int64(n)
	}
	return 0
}
