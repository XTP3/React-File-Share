package app

import (
	"context"
	"errors"
	"mime"
	"net/http"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

var categories = []string{"photo", "gif", "video", "audio", "document", "archive", "other"}

func category(name, typ string) string {
	name = strings.ToLower(name)
	typ = strings.ToLower(strings.Split(typ, ";")[0])
	ext := strings.ToLower(filepath.Ext(name))
	if typ == "image/gif" || ext == ".gif" {
		return "gif"
	}
	if strings.HasPrefix(typ, "image/") || strings.Contains("|.jpg|.jpeg|.png|.webp|.avif|.heic|.bmp|.tif|.tiff|.svg|", "|"+ext+"|") {
		return "photo"
	}
	if strings.HasPrefix(typ, "video/") || strings.Contains("|.mp4|.webm|.mov|.m4v|.avi|.mkv|.mpeg|.mpg|", "|"+ext+"|") {
		return "video"
	}
	if strings.HasPrefix(typ, "audio/") || strings.Contains("|.mp3|.wav|.ogg|.flac|.m4a|.aac|.opus|", "|"+ext+"|") {
		return "audio"
	}
	if strings.Contains(typ, "zip") || strings.Contains(typ, "compressed") || strings.Contains(typ, "archive") || strings.Contains("|.zip|.rar|.7z|.tar|.gz|.bz2|.xz|.tgz|", "|"+ext+"|") {
		return "archive"
	}
	if strings.HasPrefix(typ, "text/") || typ == "application/pdf" || strings.Contains(typ, "document") || strings.Contains(typ, "sheet") || strings.Contains(typ, "presentation") || strings.Contains(typ, "msword") || strings.Contains("|.pdf|.doc|.docx|.xls|.xlsx|.ppt|.pptx|.txt|.md|.csv|.rtf|.odt|.ods|.odp|.json|.xml|.html|.htm|", "|"+ext+"|") {
		return "document"
	}
	return "other"
}
func categoryExpr() bson.M {
	// The Go classifier and Mongo classifier share ordering. Extension fallback
	// supports legacy records with empty or generic MIME information.
	specs := []struct{ cat, ext, mime string }{
		{"gif", `\.gif$`, `^image/gif(?:;|$)`},
		{"photo", `\.(jpg|jpeg|png|webp|avif|heic|bmp|tif|tiff|svg)$`, `^image/`},
		{"video", `\.(mp4|webm|mov|m4v|avi|mkv|mpeg|mpg)$`, `^video/`},
		{"audio", `\.(mp3|wav|ogg|flac|m4a|aac|opus)$`, `^audio/`},
		{"archive", `\.(zip|rar|7z|tar|gz|bz2|xz|tgz)$`, `zip|compressed|archive`},
		{"document", `\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|md|csv|rtf|odt|ods|odp|json|xml|html|htm)$`, `^text/|^application/pdf(?:;|$)|document|sheet|presentation|msword`},
	}
	branches := bson.A{}
	for _, s := range specs {
		branches = append(branches, bson.M{"case": bson.M{"$or": bson.A{bson.M{"$regexMatch": bson.M{"input": bson.M{"$ifNull": bson.A{"$fileName", ""}}, "regex": s.ext, "options": "i"}}, bson.M{"$regexMatch": bson.M{"input": bson.M{"$ifNull": bson.A{"$fileType", ""}}, "regex": s.mime, "options": "i"}}}}, "then": s.cat})
	}
	return bson.M{"$switch": bson.M{"branches": branches, "default": "other"}}
}
func (a *App) list(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	id := who(r)
	q := r.URL.Query()
	parsePage := func(key string, def, max int) (int, bool) {
		s := q.Get(key)
		if s == "" {
			return def, true
		}
		n, e := strconv.Atoi(s)
		if e != nil || n < 1 {
			return 0, false
		}
		if n > max {
			n = max
		}
		return n, true
	}
	page, valid := parsePage("page", 1, 100000000)
	if !valid {
		fail(w, 400, "invalid page")
		return
	}
	size, valid := parsePage("pageSize", 25, 100)
	if !valid {
		fail(w, 400, "invalid page size")
		return
	}
	match := bson.M{"uploaderID": id.Owner}
	search := q.Get("q")
	if len(search) > 256 {
		fail(w, 400, "search is too long")
		return
	}
	if search != "" {
		match["fileName"] = bson.M{"$regex": regexp.QuoteMeta(search), "$options": "i"}
	}
	for _, dim := range []struct{ lower, upper, field string }{{"minSize", "maxSize", "fileSize"}, {"from", "to", "timeOfUpload"}} {
		bounds := bson.M{}
		var lower, upper int64 = -1, -1
		for _, b := range []struct{ key, op string }{{dim.lower, "$gte"}, {dim.upper, "$lte"}} {
			s := q.Get(b.key)
			if s == "" {
				continue
			}
			n, e := strconv.ParseInt(s, 10, 64)
			if e != nil || n < 0 {
				fail(w, 400, "invalid "+b.key)
				return
			}
			bounds[b.op] = n
			if b.op == "$gte" {
				lower = n
			} else {
				upper = n
			}
		}
		if lower >= 0 && upper >= 0 && lower > upper {
			fail(w, 400, "invalid range")
			return
		}
		if len(bounds) > 0 {
			match[dim.field] = bounds
		}
	}
	pipe := bson.A{bson.M{"$match": match}, bson.M{"$addFields": bson.M{"category": categoryExpr()}}}
	if cats := q.Get("category"); cats != "" {
		selected := []string{}
		for _, c := range strings.Split(cats, ",") {
			found := false
			for _, allowed := range categories {
				if c == allowed {
					found = true
					break
				}
			}
			if !found {
				fail(w, 400, "unknown category")
				return
			}
			selected = append(selected, c)
		}
		pipe = append(pipe, bson.M{"$match": bson.M{"category": bson.M{"$in": selected}}})
	}
	if cid := q.Get("collectionId"); cid != "" {
		if cid != "uncollected" {
			if _, e := a.ownedCollection(ctx, id.Owner, cid); e != nil {
				fail(w, 404, "collection not found")
				return
			}
		}
		foreignMatch := bson.M{"$expr": bson.M{"$and": bson.A{bson.M{"$eq": bson.A{"$ownerID", id.Owner}}, bson.M{"$eq": bson.A{"$fileId", "$$fid"}}}}}
		if cid != "uncollected" {
			foreignMatch["collectionId"] = cid
		}
		pipe = append(pipe, bson.M{"$lookup": bson.M{"from": "collection_memberships", "let": bson.M{"fid": "$uniqueID"}, "pipeline": bson.A{bson.M{"$match": foreignMatch}, bson.M{"$limit": 1}}, "as": "_membership"}})
		if cid == "uncollected" {
			pipe = append(pipe, bson.M{"$match": bson.M{"_membership": bson.M{"$size": 0}}})
		} else {
			pipe = append(pipe, bson.M{"$match": bson.M{"_membership.0": bson.M{"$exists": true}}})
		}
		pipe = append(pipe, bson.M{"$unset": "_membership"})
	}
	sortKey := q.Get("sort")
	if sortKey == "" {
		sortKey = "date"
	}
	fields := map[string]string{"date": "timeOfUpload", "name": "fileName", "size": "fileSize", "type": "fileType"}
	field, found := fields[sortKey]
	if !found {
		fail(w, 400, "invalid sort")
		return
	}
	direction := q.Get("direction")
	if direction == "" {
		direction = "desc"
		if sortKey == "name" || sortKey == "type" {
			direction = "asc"
		}
	}
	dir := 1
	if direction == "desc" {
		dir = -1
	} else if direction != "asc" {
		fail(w, 400, "invalid sort direction")
		return
	}
	if sortKey == "name" {
		pipe = append(pipe, bson.M{"$addFields": bson.M{"_sortName": bson.M{"$toLower": "$fileName"}}})
		field = "_sortName"
	}
	pipe = append(pipe, bson.M{"$facet": bson.M{"items": bson.A{bson.M{"$sort": bson.D{{Key: field, Value: dir}, {Key: "_id", Value: 1}}}, bson.M{"$skip": int64(page-1) * int64(size)}, bson.M{"$limit": size}, bson.M{"$unset": "_sortName"}}, "total": bson.A{bson.M{"$count": "value"}}}})
	cur, e := a.DB.Collection("files").Aggregate(ctx, pipe, options.Aggregate())
	if e != nil {
		fail(w, 503, "file query failed")
		return
	}
	defer cur.Close(ctx)
	var result []struct {
		Items []bson.M `bson:"items"`
		Total []struct {
			Value int64 `bson:"value"`
		} `bson:"total"`
	}
	if e = cur.All(ctx, &result); e != nil {
		fail(w, 503, "file query failed")
		return
	}
	items := []bson.M{}
	total := int64(0)
	if len(result) > 0 {
		items = result[0].Items
		if len(result[0].Total) > 0 {
			total = result[0].Total[0].Value
		}
	}
	reply(w, 200, map[string]any{"items": items, "total": total, "page": page, "pageSize": size, "totalPages": (total + int64(size) - 1) / int64(size)})
}
func (a *App) legacyList(w http.ResponseWriter, r *http.Request) {
	var body struct{ SortOrder string }
	if !decode(w, r, &body) {
		return
	}
	sort := bson.D{}
	switch body.SortOrder {
	case "alphabetical":
		sort = bson.D{{Key: "fileName", Value: 1}}
	case "chronological":
		sort = bson.D{{Key: "timeOfUpload", Value: -1}}
	case "size":
		sort = bson.D{{Key: "fileSize", Value: -1}}
	}
	opts := options.Find().SetCollation(&options.Collation{Locale: "en", Strength: 3})
	if len(sort) > 0 {
		opts.SetSort(sort)
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	cur, e := a.DB.Collection("files").Find(ctx, bson.M{"uploaderID": who(r).Owner}, opts)
	if e != nil {
		fail(w, 503, "file query failed")
		return
	}
	defer cur.Close(ctx)
	files := []bson.M{}
	if e = cur.All(ctx, &files); e != nil {
		fail(w, 503, "file query failed")
		return
	}
	if len(files) == 0 {
		fail(w, 404, "no files found")
		return
	}
	reply(w, 200, files)
}
func (a *App) legacySearch(w http.ResponseWriter, r *http.Request) {
	query := r.PathValue("query")
	if len(query) > 256 {
		fail(w, 400, "search is too long")
		return
	}
	pattern, e := regexp.Compile("(?i)" + query)
	if e != nil {
		fail(w, 400, "invalid search expression")
		return
	}
	// Execute legacy regular expressions in Go's bounded RE2 engine, rather than
	// exposing Mongo's backtracking PCRE engine to arbitrary patterns.
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	cur, e := a.DB.Collection("files").Find(ctx, bson.M{"uploaderID": who(r).Owner})
	if e != nil {
		fail(w, 503, "file query failed")
		return
	}
	defer cur.Close(ctx)
	files := []bson.M{}
	for cur.Next(ctx) {
		var f bson.M
		if e = cur.Decode(&f); e != nil {
			fail(w, 503, "file query failed")
			return
		}
		if pattern.MatchString(str(f, "fileName")) {
			files = append(files, f)
			if len(files) == 5 {
				break
			}
		}
	}
	if e = cur.Err(); e != nil {
		fail(w, 503, "search timed out")
		return
	}
	if len(files) == 0 {
		fail(w, 404, "no files found")
		return
	}
	reply(w, 200, files)
}
func (a *App) download(w http.ResponseWriter, r *http.Request) {
	var file bson.M
	e := a.DB.Collection("files").FindOne(r.Context(), bson.M{"uniqueID": r.PathValue("id")}).Decode(&file)
	if e != nil {
		if errors.Is(e, mongo.ErrNoDocuments) {
			fail(w, 404, "file not found")
		} else {
			fail(w, 503, "database unavailable")
		}
		return
	}
	owner, name := str(file, "uploaderID"), str(file, "fileName")
	path, e := a.safePath(owner, name, false)
	if e != nil {
		fail(w, 404, "file unavailable")
		return
	}
	f, e := a.root.Open(path)
	if e != nil {
		fail(w, 404, "file unavailable")
		return
	}
	defer f.Close()
	info, e := f.Stat()
	if e != nil || !info.Mode().IsRegular() {
		fail(w, 404, "file unavailable")
		return
	}
	typ := str(file, "fileType")
	if _, _, e = mime.ParseMediaType(typ); e != nil || typ == "" {
		typ = mime.TypeByExtension(filepath.Ext(name))
	}
	if typ == "" {
		typ = "application/octet-stream"
	}
	w.Header().Set("Content-Type", typ)
	disposition := "inline"
	if strings.HasPrefix(r.URL.Path, "/f/d/") {
		disposition = "attachment"
	}
	w.Header().Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": name}))
	// Uploaded HTML, SVG and documents can contain scripts. A sandbox applies
	// even on this application's origin and deliberately omits allow-same-origin.
	csp := "sandbox; default-src 'none'; img-src data: blob:; media-src blob:; style-src 'unsafe-inline'"
	mediaType, _, _ := mime.ParseMediaType(typ)
	if strings.HasPrefix(mediaType, "audio/") || strings.HasPrefix(mediaType, "video/") {
		// Native browser media documents read the original same-origin URL.
		// Preserve its origin so native playback is not blocked by CORS from a
		// sandbox's opaque origin. Scripts remain disabled. HTML/SVG retain the
		// stricter policy above without any same-origin resource exception.
		csp = "sandbox allow-same-origin; default-src 'none'; img-src data: blob:; media-src 'self' blob:; style-src 'unsafe-inline'"
	}
	w.Header().Set("Content-Security-Policy", csp)
	w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
	w.Header().Set("Cache-Control", "private, no-cache")
	http.ServeContent(w, r, name, info.ModTime(), f)
}
