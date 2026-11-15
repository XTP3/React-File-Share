package app

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

func downloadFixture(t *testing.T) (*App, map[string]bson.M) {
	t.Helper()
	root, err := os.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Close() })
	if err = root.Mkdir("owner", 0700); err != nil {
		t.Fatal(err)
	}
	a := &App{root: root}
	a.Config.JWTSecretKey = "synthetic-download-test-secret"
	records := map[string]bson.M{}
	for _, item := range []struct{ id, name, body string }{{"one", "first.txt", "First file"}, {"two", "Résumé 世界.txt", "Second file"}, {"empty", "empty.txt", ""}, {"duplicate", "first.txt", "First file"}} {
		file, err := root.OpenFile("owner/"+item.name, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = file.WriteString(item.body); err != nil {
			t.Fatal(err)
		}
		file.Close()
		records[item.id] = bson.M{"uniqueID": item.id, "fileName": item.name, "uploaderID": "owner"}
	}
	return a, records
}

func TestDownloadZIPOrderDeduplicationAndBytes(t *testing.T) {
	a, records := downloadFixture(t)
	items, err := a.prepareDownload(context.Background(), "owner", []string{"two", "one", "duplicate", "empty"}, records)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 3 {
		t.Fatal("filenames were not deduplicated", len(items))
	}
	var out bytes.Buffer
	if err = a.writeDownloadArchive(context.Background(), &out, "owner", items); err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(out.Bytes()), int64(out.Len()))
	if err != nil {
		t.Fatal(err)
	}
	for i, want := range []struct{ name, body string }{{"Résumé 世界.txt", "Second file"}, {"first.txt", "First file"}, {"empty.txt", ""}} {
		f := archive.File[i]
		if f.Name != want.name || f.Method != zip.Store {
			t.Fatalf("entry %d: %q method %d", i, f.Name, f.Method)
		}
		r, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(r)
		r.Close()
		if err != nil || string(body) != want.body {
			t.Fatalf("entry bytes %q: %v", body, err)
		}
		original, err := a.root.ReadFile("owner/" + want.name)
		if err != nil || !bytes.Equal(original, body) {
			t.Fatal("source bytes changed")
		}
	}
}

func TestDownloadPreflightRejectsMissingForeignAndUnsafeFiles(t *testing.T) {
	a, records := downloadFixture(t)
	records["foreign"] = bson.M{"uniqueID": "foreign", "uploaderID": "other", "fileName": "first.txt"}
	records["unsafe"] = bson.M{"uniqueID": "unsafe", "uploaderID": "owner", "fileName": "../secret"}
	records["backslash"] = bson.M{"uniqueID": "backslash", "uploaderID": "owner", "fileName": `..\secret`}
	for _, id := range []string{"missing", "foreign", "unsafe", "backslash"} {
		if files, err := a.prepareDownload(context.Background(), "owner", []string{"one", id}, records); err == nil || files != nil {
			t.Fatalf("accepted %s", id)
		}
	}
	a.root.Remove("owner/first.txt")
	if _, err := a.prepareDownload(context.Background(), "owner", []string{"one"}, records); err == nil {
		t.Fatal("accepted missing original")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := a.prepareDownload(ctx, "owner", []string{"two"}, records); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func TestDownloadTicketsOwnershipExpiryCapacityAndClaim(t *testing.T) {
	a, _ := downloadFixture(t)
	now := time.Now().Truncate(time.Millisecond)
	id, expires, ok := a.retainDownload("owner", nil, now)
	if !ok || expires.Sub(now) != downloadLifetime {
		t.Fatal("ticket lifetime")
	}
	if _, status := a.claimDownload("other", id, now); status != http.StatusNotFound {
		t.Fatal("owner check", status)
	}
	if _, status := a.claimDownload("owner", "unknown", now); status != http.StatusNotFound {
		t.Fatal("unknown", status)
	}
	if _, status := a.claimDownload("owner", id, now); status != 0 {
		t.Fatal(status)
	}
	if _, status := a.claimDownload("owner", id, now); status != http.StatusConflict {
		t.Fatal("parallel stream accepted", status)
	}
	a.releaseDownload(id)
	for i := 1; i < downloadOwnerLimit; i++ {
		if _, _, ok := a.retainDownload("owner", nil, now); !ok {
			t.Fatal("early owner limit")
		}
	}
	if _, _, ok := a.retainDownload("owner", nil, now); ok {
		t.Fatal("owner limit not enforced")
	}
	for i := downloadOwnerLimit; i < downloadTotalLimit; i++ {
		if _, _, ok := a.retainDownload("owner-"+strconv.Itoa(i), nil, now); !ok {
			t.Fatal("early global limit")
		}
	}
	if _, _, ok := a.retainDownload("new-owner", nil, now); ok {
		t.Fatal("global limit not enforced")
	}
	if _, status := a.claimDownload("owner", id, expires); status != http.StatusGone {
		t.Fatal("expired", status)
	}
	if _, status := a.claimDownload("other", id, expires); status != http.StatusNotFound {
		t.Fatal("foreign expired", status)
	}
	if _, _, ok := a.retainDownload("owner", nil, expires); !ok {
		t.Fatal("expired capacity not reclaimed")
	}
	if _, status := a.claimDownload("owner", id, expires); status != http.StatusGone {
		t.Fatal("pruned expiry lost", status)
	}
	if _, status := a.claimDownload("owner", id+"modified", expires); status != http.StatusNotFound {
		t.Fatal("forged expiry", status)
	}
}

func TestDownloadTicketMetadataBudgetReclaimed(t *testing.T) {
	a, _ := downloadFixture(t)
	now := time.Now()
	files := make([]downloadFile, 40000)
	for i := range files {
		files[i] = downloadFile{id: "file", name: "sample.txt"}
	}
	id, expires, ok := a.retainDownload("owner", files, now)
	if !ok {
		t.Fatal("single bounded manifest rejected")
	}
	if _, _, ok := a.retainDownload("other", files, now); ok {
		t.Fatal("metadata budget exceeded")
	}
	a.finishDownload(id)
	if a.downloads.metadataBytes != 0 {
		t.Fatal("completed metadata not released")
	}
	if _, _, ok := a.retainDownload("other", files, now); !ok {
		t.Fatal("completion did not reclaim budget")
	}
	if _, _, ok := a.retainDownload("other", files, expires); !ok {
		t.Fatal("expiry did not reclaim budget")
	}
	if a.downloads.metadataBytes != downloadMetadataSize(files) {
		t.Fatal("expired metadata accounting differs")
	}
}

type cancelDownloadWriter struct {
	bytes.Buffer
	cancel context.CancelFunc
}

func (w *cancelDownloadWriter) Write(p []byte) (int, error) { w.cancel(); return w.Buffer.Write(p) }

type failingDownloadWriter struct {
	bytes.Buffer
	remaining int
}

func (w *failingDownloadWriter) Write(p []byte) (int, error) {
	if len(p) > w.remaining {
		n, _ := w.Buffer.Write(p[:w.remaining])
		w.remaining = 0
		return n, io.ErrClosedPipe
	}
	w.remaining -= len(p)
	return w.Buffer.Write(p)
}

func TestDownloadStreamAbortsWithoutValidPartialArchive(t *testing.T) {
	a, records := downloadFixture(t)
	f, err := a.root.OpenFile("owner/first.txt", os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		t.Fatal(err)
	}
	f.WriteString(strings.Repeat("x", 256<<10))
	f.Close()
	items, err := a.prepareDownload(context.Background(), "owner", []string{"one", "two"}, records)
	if err != nil {
		t.Fatal(err)
	}
	t.Run("disconnect", func(t *testing.T) {
		writer := &failingDownloadWriter{remaining: 70000}
		if err := a.writeDownloadArchive(context.Background(), writer, "owner", items); !errors.Is(err, io.ErrClosedPipe) {
			t.Fatal(err)
		}
		if _, err := zip.NewReader(bytes.NewReader(writer.Bytes()), int64(writer.Len())); err == nil {
			t.Fatal("partial archive finalized")
		}
	})
	t.Run("cancel", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		writer := &cancelDownloadWriter{cancel: cancel}
		if err := a.writeDownloadArchive(ctx, writer, "owner", items); !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
		if _, err := zip.NewReader(bytes.NewReader(writer.Bytes()), int64(writer.Len())); err == nil {
			t.Fatal("cancelled archive finalized")
		}
	})
	t.Run("source-replaced", func(t *testing.T) {
		a.root.Remove("owner/Résumé 世界.txt")
		file, _ := a.root.Create("owner/Résumé 世界.txt")
		file.WriteString("replacement")
		file.Close()
		var writer bytes.Buffer
		if err := a.writeDownloadArchive(context.Background(), &writer, "owner", items); err == nil {
			t.Fatal("replacement accepted")
		}
		if _, err := zip.NewReader(bytes.NewReader(writer.Bytes()), int64(writer.Len())); err == nil {
			t.Fatal("incomplete selection finalized")
		}
	})
}
