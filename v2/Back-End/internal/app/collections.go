package app

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

func (a *App) ownedCollection(ctx context.Context, owner, id string) (bson.M, error) {
	var c bson.M
	e := a.DB.Collection("collections").FindOne(ctx, bson.M{"ownerID": owner, "id": id}).Decode(&c)
	return c, e
}
func validTitle(s string) bool { return strings.TrimSpace(s) != "" && len(s) <= 200 }
func (a *App) collectionJSON(ctx context.Context, owner string, c bson.M) (map[string]any, error) {
	s, e := a.getStats(ctx, owner, str(c, "id"), false)
	if e != nil {
		return nil, e
	}
	return map[string]any{"id": c["id"], "title": c["title"], "createdAt": c["createdAt"], "updatedAt": c["updatedAt"], "fileCount": s.TotalFiles, "totalBytes": s.TotalBytes}, nil
}
func (a *App) collections(w http.ResponseWriter, r *http.Request) {
	owner := who(r).Owner
	if r.Method == "POST" {
		var body struct{ Title string }
		if !decode(w, r, &body) {
			return
		}
		body.Title = strings.TrimSpace(body.Title)
		if !validTitle(body.Title) {
			fail(w, 400, "a title of at most 200 bytes is required")
			return
		}
		a.mutation.Lock()
		defer a.mutation.Unlock()
		now := time.Now().UnixMilli()
		c := bson.M{"id": randomID(16), "ownerID": owner, "title": body.Title, "createdAt": now, "updatedAt": now}
		if _, e := a.DB.Collection("collections").InsertOne(r.Context(), c); e != nil {
			fail(w, 503, "collection could not be saved")
			return
		}
		reply(w, 201, map[string]any{"id": c["id"], "title": c["title"], "createdAt": now, "updatedAt": now, "fileCount": 0, "totalBytes": 0})
		return
	}
	cur, e := a.DB.Collection("collections").Find(r.Context(), bson.M{"ownerID": owner}, options.Find().SetSort(bson.D{{Key: "createdAt", Value: 1}, {Key: "id", Value: 1}}))
	if e != nil {
		fail(w, 503, "collections unavailable")
		return
	}
	var cs []bson.M
	if e = cur.All(r.Context(), &cs); e != nil {
		fail(w, 503, "collections unavailable")
		return
	}
	items := []any{}
	for _, c := range cs {
		out, e := a.collectionJSON(r.Context(), owner, c)
		if e != nil {
			fail(w, 503, "collection statistics unavailable")
			return
		}
		items = append(items, out)
	}
	reply(w, 200, map[string]any{"items": items})
}
func (a *App) collection(w http.ResponseWriter, r *http.Request) {
	owner := who(r).Owner
	id := r.PathValue("id")
	a.mutation.Lock()
	defer a.mutation.Unlock()
	c, e := a.ownedCollection(r.Context(), owner, id)
	if e != nil {
		if errors.Is(e, mongo.ErrNoDocuments) {
			fail(w, 404, "collection not found")
		} else {
			fail(w, 503, "database unavailable")
		}
		return
	}
	if r.Method == "DELETE" {
		// Remove memberships before the container so an interrupted cleanup can
		// be retried while the ownership record still exists.
		if _, e = a.DB.Collection("collection_memberships").DeleteMany(r.Context(), bson.M{"ownerID": owner, "collectionId": id}); e != nil {
			fail(w, 503, "collection membership cleanup failed")
			return
		}
		if _, e = a.DB.Collection("collections").DeleteOne(r.Context(), bson.M{"ownerID": owner, "id": id}); e != nil {
			fail(w, 503, "collection could not be deleted")
			return
		}
		a.invalidateStats(owner)
		ok(w, 200)
		return
	}
	var body struct{ Title string }
	if !decode(w, r, &body) {
		return
	}
	body.Title = strings.TrimSpace(body.Title)
	if !validTitle(body.Title) {
		fail(w, 400, "a title of at most 200 bytes is required")
		return
	}
	now := time.Now().UnixMilli()
	if _, e = a.DB.Collection("collections").UpdateOne(r.Context(), bson.M{"ownerID": owner, "id": id}, bson.M{"$set": bson.M{"title": body.Title, "updatedAt": now}}); e != nil {
		fail(w, 503, "collection could not be renamed")
		return
	}
	c["title"] = body.Title
	c["updatedAt"] = now
	out, e := a.collectionJSON(r.Context(), owner, c)
	if e != nil {
		fail(w, 503, "collection statistics unavailable")
		return
	}
	reply(w, 200, out)
}
func (a *App) memberships(w http.ResponseWriter, r *http.Request) {
	owner := who(r).Owner
	cid := r.PathValue("id")
	var body struct {
		FileIDs []string `json:"fileIds"`
	}
	if !decode(w, r, &body) {
		return
	}
	if len(body.FileIDs) == 0 || len(body.FileIDs) > 1000 {
		fail(w, 400, "provide between 1 and 1000 file IDs")
		return
	}
	a.mutation.Lock()
	defer a.mutation.Unlock()
	if _, e := a.ownedCollection(r.Context(), owner, cid); e != nil {
		fail(w, 404, "collection not found")
		return
	}
	ids := []string{}
	seen := map[string]bool{}
	for _, id := range body.FileIDs {
		if id == "" || len(id) > 255 {
			fail(w, 400, "invalid file ID")
			return
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	// Verify the complete batch before mutating any membership.
	var distinct []string
	e := a.DB.Collection("files").Distinct(r.Context(), "uniqueID", bson.M{"uploaderID": owner, "uniqueID": bson.M{"$in": ids}}).Decode(&distinct)
	if e != nil {
		fail(w, 503, "database unavailable")
		return
	}
	if len(distinct) != len(ids) {
		fail(w, 404, "one or more files were not found")
		return
	}
	if r.Method == "DELETE" {
		if _, e = a.DB.Collection("collection_memberships").DeleteMany(r.Context(), bson.M{"ownerID": owner, "collectionId": cid, "fileId": bson.M{"$in": ids}}); e != nil {
			fail(w, 503, "membership removal failed")
			return
		}
	} else {
		models := []mongo.WriteModel{}
		for _, id := range ids {
			m := bson.M{"ownerID": owner, "collectionId": cid, "fileId": id}
			models = append(models, mongo.NewUpdateOneModel().SetFilter(m).SetUpdate(bson.M{"$setOnInsert": m}).SetUpsert(true))
		}
		if _, e = a.DB.Collection("collection_memberships").BulkWrite(r.Context(), models); e != nil {
			fail(w, 503, "membership assignment failed")
			return
		}
	}
	if _, e = a.DB.Collection("collections").UpdateOne(r.Context(), bson.M{"ownerID": owner, "id": cid}, bson.M{"$set": bson.M{"updatedAt": time.Now().UnixMilli()}}); e != nil {
		fail(w, 503, "collection update failed")
		return
	}
	a.invalidateStats(owner)
	ok(w, 200)
}
