package app

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

type CategoryStats struct {
	Category string `json:"category"`
	Count    int64  `json:"count"`
	Bytes    int64  `json:"bytes"`
}
type StorageStats struct {
	TotalBytes     int64           `json:"totalBytes"`
	TotalFiles     int64           `json:"totalFiles"`
	Categories     []CategoryStats `json:"categories"`
	UpdatedAt      int64           `json:"updatedAt"`
	MissingFiles   int64           `json:"missingFiles"`
	UntrackedBytes int64           `json:"untrackedBytes"`
}
type cachedStats struct {
	stats   StorageStats
	expires time.Time
}

func (a *App) invalidateStats(owner string) {
	a.statsMu.Lock()
	defer a.statsMu.Unlock()
	for key := range a.stats {
		if strings.HasPrefix(key, owner+"\x00") {
			delete(a.stats, key)
		}
	}
}
func (a *App) getStats(ctx context.Context, owner, cid string, force bool) (StorageStats, error) {
	key := owner + "\x00" + cid
	a.statsMu.Lock()
	defer a.statsMu.Unlock()
	if s, ok := a.stats[key]; ok && !force && time.Now().Before(s.expires) {
		return s.stats, nil
	}
	s, e := a.scanStats(ctx, owner, cid)
	if e != nil {
		return s, e
	}
	a.stats[key] = cachedStats{s, time.Now().Add(time.Minute)}
	return s, nil
}
func (a *App) scanStats(ctx context.Context, owner, cid string) (StorageStats, error) {
	out := StorageStats{Categories: []CategoryStats{}, UpdatedAt: time.Now().UnixMilli()}
	for _, c := range categories {
		out.Categories = append(out.Categories, CategoryStats{Category: c})
	}
	if !safeName(owner) {
		return out, errors.New("invalid owner")
	}
	filter := bson.M{"uploaderID": owner}
	if cid != "" {
		cur, e := a.DB.Collection("collection_memberships").Find(ctx, bson.M{"ownerID": owner, "collectionId": cid})
		if e != nil {
			return out, e
		}
		var members []bson.M
		if e = cur.All(ctx, &members); e != nil {
			return out, e
		}
		ids := []string{}
		for _, m := range members {
			ids = append(ids, str(m, "fileId"))
		}
		filter["uniqueID"] = bson.M{"$in": ids}
	}
	cur, e := a.DB.Collection("files").Find(ctx, filter)
	if e != nil {
		return out, e
	}
	var files []bson.M
	if e = cur.All(ctx, &files); e != nil {
		return out, e
	}
	references := map[string]bson.M{}
	for _, f := range files {
		name := str(f, "fileName")
		if !safeStoredName(name) {
			out.MissingFiles++
			continue
		}
		if _, ok := references[name]; !ok {
			references[name] = f
		}
	}
	add := func(name, typ string, size int64) {
		cat := category(name, typ)
		out.TotalFiles++
		out.TotalBytes += size
		for i := range out.Categories {
			if out.Categories[i].Category == cat {
				out.Categories[i].Count++
				out.Categories[i].Bytes += size
				break
			}
		}
	}
	if cid != "" {
		for name, f := range references {
			path, e := a.safePath(owner, name, false)
			if e != nil {
				out.MissingFiles++
				continue
			}
			i, e := a.root.Lstat(path)
			if e != nil || !i.Mode().IsRegular() {
				out.MissingFiles++
				continue
			}
			add(name, str(f, "fileType"), i.Size())
		}
		return out, nil
	}
	i, e := a.root.Lstat(owner)
	if errors.Is(e, os.ErrNotExist) {
		out.MissingFiles = int64(len(references))
		return out, nil
	}
	if e != nil {
		return out, e
	}
	if !i.IsDir() || i.Mode()&os.ModeSymlink != 0 {
		return out, errors.New("unsafe owner directory")
	}
	dir, e := a.root.Open(owner)
	if e != nil {
		return out, e
	}
	entries, e := dir.ReadDir(-1)
	dir.Close()
	if e != nil {
		return out, e
	}
	found := map[string]bool{}
	for _, entry := range entries {
		if e = ctx.Err(); e != nil {
			return out, e
		}
		if !safeStoredName(entry.Name()) || entry.Type()&os.ModeSymlink != 0 {
			continue
		}
		i, e := a.root.Lstat(filepath.Join(owner, entry.Name()))
		if e != nil {
			if errors.Is(e, os.ErrNotExist) {
				continue
			}
			return out, e
		}
		if !i.Mode().IsRegular() {
			continue
		}
		found[entry.Name()] = true
		f, tracked := references[entry.Name()]
		typ := ""
		if tracked {
			typ = str(f, "fileType")
		} else {
			out.UntrackedBytes += i.Size()
		}
		add(entry.Name(), typ, i.Size())
	}
	for name := range references {
		if !found[name] {
			out.MissingFiles++
		}
	}
	return out, nil
}
func (a *App) storage(w http.ResponseWriter, r *http.Request) {
	owner := who(r).Owner
	cid := r.URL.Query().Get("collectionId")
	if cid != "" {
		if _, e := a.ownedCollection(r.Context(), owner, cid); e != nil {
			fail(w, 404, "collection not found")
			return
		}
	}
	s, e := a.getStats(r.Context(), owner, cid, r.Method == "POST")
	if e != nil {
		fail(w, 503, "storage reconciliation unavailable")
		return
	}
	reply(w, 200, s)
}
