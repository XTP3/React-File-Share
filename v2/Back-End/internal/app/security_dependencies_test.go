package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/XTP3/React-File-Share/v2/internal/config"
)

func TestStaticRangeLimitPreservesNormalDownloads(t *testing.T) {
	// GO-2026-6609: many tiny ranges used to generate an expensive multipart
	// response. The patched toolchain ignores that header and serves the file.
	t.Setenv("GODEBUG", "httpservecontentmaxranges=200")
	www := t.TempDir()
	content := strings.Repeat("0123456789", 1024)
	if err := os.WriteFile(filepath.Join(www, "asset.txt"), []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	a := &App{Config: config.Config{WWWDir: www}}
	for _, test := range []struct {
		name, ranges string
		status       int
	}{
		{"single", "bytes=2-5", http.StatusPartialContent},
		{"multiple", "bytes=0-0,2-2", http.StatusPartialContent},
		{"excessive", "bytes=" + strings.Repeat("0-0,", 1000) + "0-0", http.StatusOK},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/asset.txt", nil)
			req.Header.Set("Range", test.ranges)
			response := httptest.NewRecorder()
			a.static(response, req)
			if response.Code != test.status {
				t.Fatalf("status=%d, want %d", response.Code, test.status)
			}
			if test.name == "single" && response.Body.String() != "2345" {
				t.Fatal("single-range download changed")
			}
			if test.name == "multiple" && !strings.HasPrefix(response.Header().Get("Content-Type"), "multipart/byteranges;") {
				t.Fatal("ordinary multi-range download changed")
			}
			if test.name == "excessive" && response.Body.String() != content {
				t.Fatal("excessive ranges did not fall back to the complete file")
			}
		})
	}
}
