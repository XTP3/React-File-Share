package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/XTP3/React-File-Share/v2/internal/config"
	"go.mongodb.org/mongo-driver/v2/bson"
	"golang.org/x/crypto/bcrypt"
)

func TestSafeNames(t *testing.T) {
	for _, name := range []string{"../secret", "a/b", "a\\b", "a:b", "", ".", "..", "a\x00b", "a\nb", strings.Repeat("a", 256)} {
		if safeName(name) {
			t.Errorf("accepted unsafe name %q", name)
		}
	}
	for _, name := range []string{"ordinary.txt", ".hidden", "Résumé 世界.zip", "🐱 photo.png"} {
		if !safeName(name) {
			t.Errorf("rejected safe name %q", name)
		}
	}
}
func TestRootRejectsSymlinksAndEscapes(t *testing.T) {
	dir := t.TempDir()
	root, e := os.OpenRoot(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer root.Close()
	a := &App{root: root}
	if e = root.Mkdir("owner", 0700); e != nil {
		t.Fatal(e)
	}
	if _, e = a.safePath("owner", "../escape", false); e == nil {
		t.Fatal("accepted traversal")
	}
	outside := t.TempDir()
	if e = os.WriteFile(filepath.Join(outside, "private"), []byte("secret"), 0600); e != nil {
		t.Fatal(e)
	}
	if e = os.Symlink(filepath.Join(outside, "private"), filepath.Join(dir, "owner", "symlink")); e != nil {
		t.Skipf("symlinks unavailable: %v", e)
	}
	if _, e = a.safePath("owner", "symlink", false); e == nil {
		t.Fatal("accepted file symlink")
	}
	if e = os.Symlink(outside, filepath.Join(dir, "linked-owner")); e != nil {
		t.Fatal(e)
	}
	if _, e = a.safePath("linked-owner", "private", false); e == nil {
		t.Fatal("accepted owner symlink")
	}
}
func TestAtomicPublicationNeverReplaces(t *testing.T) {
	root, e := os.OpenRoot(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer root.Close()
	for name, content := range map[string]string{"first": "first", "second": "second", "existing": "original"} {
		f, e := root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = f.WriteString(content); e != nil {
			t.Fatal(e)
		}
		f.Close()
	}
	if e = root.Link("first", "existing"); e == nil {
		t.Fatal("overwrote existing destination")
	}
	f, e := root.Open("existing")
	if e != nil {
		t.Fatal(e)
	}
	b := make([]byte, 8)
	f.Read(b)
	f.Close()
	if string(b) != "original" {
		t.Fatalf("existing content changed: %q", b)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, name := range []string{"first", "second"} {
		wg.Go(func() { results <- root.Link(name, "destination") })
	}
	wg.Wait()
	close(results)
	successes := 0
	for e := range results {
		if e == nil {
			successes++
		}
	}
	if successes != 1 {
		t.Fatalf("concurrent publications succeeded %d times", successes)
	}
}
func TestCategories(t *testing.T) {
	cases := []struct{ name, typ, want string }{{"a.GIF", "image/gif", "gif"}, {"b.png", "application/octet-stream", "photo"}, {"a", "image/jpeg", "photo"}, {"b.MKV", "", "video"}, {"audio", "audio/ogg", "audio"}, {"a.ZIP", "", "archive"}, {"a", "application/x-7z-compressed", "archive"}, {"a.PDF", "application/octet-stream", "document"}, {"b.txt", "", "document"}, {"unknown.bin", "application/octet-stream", "other"}}
	for _, c := range cases {
		if got := category(c.name, c.typ); got != c.want {
			t.Errorf("%s/%s = %s, want %s", c.name, c.typ, got, c.want)
		}
	}
}
func TestBcryptLegacy72ByteBoundary(t *testing.T) {
	for _, s := range []string{strings.Repeat("a", 72) + "suffix", strings.Repeat("a", 71) + "🦊tail", "é漢字🦊"} {
		hash, e := bcrypt.GenerateFromPassword(passwordBytes(s), 4)
		if e != nil {
			t.Fatal(e)
		}
		if e = bcrypt.CompareHashAndPassword(hash, passwordBytes(s)); e != nil {
			t.Fatal(e)
		}
		if len([]byte(s)) > 72 {
			if e = bcrypt.CompareHashAndPassword(hash, passwordBytes(s+"changed trailing data")); e != nil {
				t.Fatal("legacy truncated password changed")
			}
		}
	}
}
func TestUnknownBSONFieldsAndTypesSerialize(t *testing.T) {
	id := bson.NewObjectID()
	m := bson.M{"_id": id, "timeOfUpload": float64(1710000000000), "unknown": bson.M{"retained": true}, "date": bson.DateTime(0)}
	b, e := json.Marshal(jsonValue(m))
	if e != nil {
		t.Fatal(e)
	}
	var got map[string]any
	if e = json.Unmarshal(b, &got); e != nil {
		t.Fatal(e)
	}
	if got["_id"] != id.Hex() || got["timeOfUpload"] != float64(1710000000000) || got["date"] != "1970-01-01T00:00:00Z" {
		t.Fatalf("BSON serialization changed: %s", b)
	}
	if got["unknown"].(map[string]any)["retained"] != true {
		t.Fatal("unknown field lost")
	}
}
func TestDecodeRejectsTrailingGarbage(t *testing.T) {
	for _, body := range []string{`{"title":"one"}{"title":"two"}`, `{"title":"one"} nope`} {
		r := httptest.NewRequest("POST", "/", strings.NewReader(body))
		w := httptest.NewRecorder()
		var got map[string]any
		if decode(w, r, &got) {
			t.Fatal("accepted trailing input")
		}
		if w.Code != 400 {
			t.Fatal(w.Code)
		}
	}
	r := httptest.NewRequest("POST", "/", strings.NewReader(`{"title":"one"} `))
	w := httptest.NewRecorder()
	var got map[string]any
	if !decode(w, r, &got) {
		t.Fatal(w.Body.String())
	}
}
func TestOriginAndBoundedAuthenticationRate(t *testing.T) {
	a := &App{Config: config.Config{AllowedOrigins: []string{"https://allowed.example"}}, rates: map[string]rateEntry{}}
	for origin, want := range map[string]bool{"http://example.com": true, "https://allowed.example": true, "https://evil.example": false, "null": false} {
		r := httptest.NewRequest("POST", "http://example.com/api/v2/auth/login", nil)
		r.Header.Set("Origin", origin)
		if a.originAllowed(r) != want {
			t.Errorf("origin %s", origin)
		}
	}
	for i := 0; i < 30; i++ {
		if !a.allowRate("login:test", 30) {
			t.Fatal("rate limit rejected within burst")
		}
	}
	if a.allowRate("login:test", 30) {
		t.Fatal("authentication rate limit not enforced")
	}
	called := false
	handler := a.security(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true }))
	r := httptest.NewRequest("POST", "http://example.com/api/v2/auth/login", strings.NewReader(`{}`))
	r.Header.Set("Content-Type", "text/plain")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != 415 || called {
		t.Fatal("simple-content-type login accepted")
	}
}

func TestStoredUnixNamesPreserveLegacyShares(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("colon and backslash are not ordinary Windows file names")
	}
	root, e := os.OpenRoot(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer root.Close()
	a := &App{root: root}
	if e = root.Mkdir("owner", 0700); e != nil {
		t.Fatal(e)
	}
	for _, name := range []string{"report:2024.txt", `literal\backslash.txt`} {
		f, e := root.OpenFile(filepath.Join("owner", name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			t.Fatal(e)
		}
		f.Close()
		if _, e = a.safePath("owner", name, false); e != nil {
			t.Fatal(e)
		}
		if safeName(name) {
			t.Fatal("new upload names must remain portable")
		}
	}
}
func TestDateLanguageAndTimeZone(t *testing.T) {
	instant := time.Date(2026, 10, 3, 20, 0, 0, 0, time.UTC)
	zone, e := time.LoadLocation("America/New_York")
	if e != nil {
		t.Fatal(e)
	}
	if got := dateDisplay(instant.In(zone), "en-US"); got != "10/3/2026, 4:00:00 PM" {
		t.Fatal(got)
	}
	if got := dateDisplay(instant.In(zone), "de-DE"); got != "3.10.2026, 16:00:00" {
		t.Fatal(got)
	}
}

func TestUnknownMethodsReturnJSON(t *testing.T) {
	a := &App{rates: map[string]rateEntry{}, Config: config.Config{WWWDir: t.TempDir()}}
	for _, tc := range []struct {
		method, path string
		status       int
	}{{"GET", "/api/v2/auth/login", 405}, {"PUT", "/api/v2/config", 405}, {"GET", "/api/v2/unknown", 404}, {"POST", "/missing", 404}} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(tc.method, tc.path, nil)
		a.Handler().ServeHTTP(w, r)
		if w.Code != tc.status || !strings.HasPrefix(w.Header().Get("Content-Type"), "application/json") {
			t.Fatalf("%s %s = %d %s", tc.method, tc.path, w.Code, w.Body.String())
		}
	}
}
