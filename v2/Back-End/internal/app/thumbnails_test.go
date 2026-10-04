package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

type configOnlyImage struct{ *bytes.Reader }

func (configOnlyImage) Seek(int64, int) (int64, error) {
	return 0, errors.New("oversized image must be rejected before seeking back for full decoding")
}

type countedImage struct {
	*bytes.Reader
	seeks int
}

func (r *countedImage) Seek(offset int64, whence int) (int64, error) {
	r.seeks++
	return r.Reader.Seek(offset, whence)
}

func TestMalformedCollectionsNeverRequestGlobalStats(t *testing.T) {
	a := &App{} // No DB: any attempt at global statistics would panic.
	for _, id := range []any{nil, "", " ", 42, "all", "uncollected", "../escape", "a/b", "a\\b", " padded", "bad\n"} {
		if _, e := a.collectionJSON(context.Background(), "owner", bson.M{"id": id}); e == nil {
			t.Fatalf("accepted malformed collection id %#v", id)
		}
	}
	a.stats = map[string]cachedStats{"owner\x00recoverable": {stats: StorageStats{TotalFiles: 2}, expires: time.Now().Add(time.Minute)}}
	for _, title := range []any{nil, "", "   ", 4} {
		c := bson.M{"id": "recoverable", "title": title}
		out, e := a.collectionJSON(context.Background(), "owner", c)
		if e != nil || out["title"] != "Untitled collection" || out["fileCount"] != int64(2) || c["title"] != title {
			t.Fatalf("recoverable title or source changed: %#v %#v %v", c, out, e)
		}
	}
}
func TestThumbnailFormatsAndStaticFirstFrame(t *testing.T) {
	src := image.NewNRGBA(image.Rect(0, 0, 960, 480))
	for y := 0; y < 480; y++ {
		for x := 0; x < 960; x++ {
			src.SetNRGBA(x, y, color.NRGBA{R: 255, A: 255})
		}
	}
	palette := color.Palette{color.RGBA{R: 255, A: 255}, color.RGBA{B: 255, A: 255}}
	first, second := image.NewPaletted(src.Bounds(), palette), image.NewPaletted(src.Bounds(), palette)
	for i := range second.Pix {
		second.Pix[i] = 1
	}
	for _, format := range []string{"png", "jpeg", "gif"} {
		t.Run(format, func(t *testing.T) {
			var source bytes.Buffer
			switch format {
			case "png":
				png.Encode(&source, src)
			case "jpeg":
				jpeg.Encode(&source, src, nil)
			case "gif":
				gif.EncodeAll(&source, &gif.GIF{Image: []*image.Paletted{first, second}, Delay: []int{2, 2}})
			}
			original := append([]byte(nil), source.Bytes()...)
			body, e := makeThumbnail(context.Background(), bytes.NewReader(original))
			if e != nil {
				t.Fatal(e)
			}
			out, e := png.Decode(bytes.NewReader(body))
			if e != nil || out.Bounds().Dx() != 384 || out.Bounds().Dy() != 192 {
				t.Fatalf("bad dimensions: %v %v", out, e)
			}
			r, _, b, _ := out.At(100, 100).RGBA()
			if r < 60000 || b > 2000 {
				t.Fatal("thumbnail did not use red first frame")
			}
			if !bytes.Equal(original, source.Bytes()) {
				t.Fatal("source changed")
			}
		})
	}
	// A tiny valid lossless WebP, independent of the module's testdata.
	webp, _ := base64.StdEncoding.DecodeString("UklGRhwAAABXRUJQVlA4TA8AAAAvAAAAAAcQ/Y/+ByKi/wEA")
	body, e := makeThumbnail(context.Background(), bytes.NewReader(webp))
	if e != nil || len(body) == 0 {
		t.Fatalf("WebP not decoded: %v", e)
	}
	if _, e = png.Decode(bytes.NewReader(body)); e != nil {
		t.Fatal(e)
	}
	// Static extended WebP remains supported when canvas and frame agree.
	extended := append([]byte(nil), webp[:12]...)
	extended = append(extended, []byte("VP8X\x0a\x00\x00\x00")...)
	extended = append(extended, make([]byte, 10)...)
	extended = append(extended, webp[12:]...)
	binary.LittleEndian.PutUint32(extended[4:8], uint32(len(extended)-8))
	if body, e = makeThumbnail(context.Background(), bytes.NewReader(extended)); e != nil || len(body) == 0 {
		t.Fatalf("valid extended WebP rejected: %v", e)
	}
}

func TestWebPActualFrameBoundBeforeDecode(t *testing.T) {
	// Generated with Pillow: RGB 4000x4000, lossless WebP, then inserted a
	// VP8X 1x1 canvas and corrected RIFF length. Only 698 bytes, but unguarded
	// image.Decode would allocate a full 16-million-pixel frame.
	malformed, e := os.ReadFile("testdata/webp-small-canvas-large-frame.webp")
	if e != nil {
		t.Fatal(e)
	}
	config, format, e := image.DecodeConfig(bytes.NewReader(malformed))
	if e != nil || format != "webp" || config.Width != 1 || config.Height != 1 {
		t.Fatalf("invalid mismatch fixture: %v %#v", e, config)
	}
	if boundedWebP(bytes.NewReader(malformed), config) {
		t.Fatal("oversized WebP actual frame accepted")
	}
	reader := &countedImage{Reader: bytes.NewReader(malformed)}
	body, e := makeThumbnail(context.Background(), reader)
	if e != nil || len(body) != 0 || reader.seeks != 1 {
		t.Fatalf("mismatch reached full decode: bytes=%d seeks=%d error=%v", len(body), reader.seeks, e)
	}
	// Lossy VP8 headers must be checked independently, too.
	var vp8 []byte
	vp8 = append(vp8, []byte("RIFF\x00\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00")...)
	vp8 = append(vp8, make([]byte, 10)...)
	vp8 = append(vp8, []byte("VP8 \x0a\x00\x00\x00\x10\x00\x00\x9d\x01\x2a")...)
	vp8 = binary.LittleEndian.AppendUint16(vp8, 12000)
	vp8 = binary.LittleEndian.AppendUint16(vp8, 12000)
	binary.LittleEndian.PutUint32(vp8[4:8], uint32(len(vp8)-8))
	if boundedWebP(bytes.NewReader(vp8), image.Config{Width: 1, Height: 1}) {
		t.Fatal("oversized lossy VP8 frame accepted")
	}
}
func TestThumbnailLimitsCancellationAndCacheIdentity(t *testing.T) {
	for _, dims := range [][2]int{{0, 10}, {10, 0}, {12000, 12000}, {16385, 1}} {
		if thumbnailDimensions(dims[0], dims[1]) {
			t.Fatalf("accepted %v", dims)
		}
	}
	if !thumbnailDimensions(4000, 3000) {
		t.Fatal("rejected bounded photo")
	}
	// The header is valid, but its claimed pixel allocation must be rejected
	// before decoding the deliberately absent pixel payload.
	var header bytes.Buffer
	png.Encode(&header, image.NewNRGBA(image.Rect(0, 0, 1, 1)))
	oversizeHeader := append([]byte(nil), header.Bytes()...)
	binary.BigEndian.PutUint32(oversizeHeader[16:20], 12000)
	binary.BigEndian.PutUint32(oversizeHeader[20:24], 12000)
	binary.BigEndian.PutUint32(oversizeHeader[29:33], crc32.ChecksumIEEE(oversizeHeader[12:29]))
	if cfg, _, e := image.DecodeConfig(bytes.NewReader(oversizeHeader)); e != nil || cfg.Width != 12000 {
		t.Fatalf("invalid test fixture: %#v %v", cfg, e)
	}
	if body, e := makeThumbnail(context.Background(), configOnlyImage{bytes.NewReader(oversizeHeader)}); e != nil || len(body) != 0 {
		t.Fatal("oversized header decoded", e)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e := makeThumbnail(ctx, bytes.NewReader([]byte("unsupported"))); e != context.Canceled {
		t.Fatal(e)
	}
	root, e := os.OpenRoot(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer root.Close()
	a := &App{root: root}
	root.Mkdir("owner", 0700)
	path := filepath.Join("owner", "image.png")
	write := func(red uint8) []byte {
		t.Helper()
		var b bytes.Buffer
		src := image.NewNRGBA(image.Rect(0, 0, 2, 2))
		src.SetNRGBA(0, 0, color.NRGBA{R: red, A: 255})
		if e := png.Encode(&b, src); e != nil {
			t.Fatal(e)
		}
		f, e := root.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
		if e != nil {
			t.Fatal(e)
		}
		f.Write(b.Bytes())
		f.Close()
		return b.Bytes()
	}
	original := write(255)
	firstBody, e := a.loadThumbnail(context.Background(), "owner", "image.png")
	if e != nil || len(firstBody) == 0 {
		t.Fatal(e)
	}
	f, _ := root.Open(path)
	preserved := new(bytes.Buffer)
	preserved.ReadFrom(f)
	f.Close()
	if !bytes.Equal(original, preserved.Bytes()) {
		t.Fatal("thumbnail mutated file")
	}
	info, _ := root.Lstat(path)
	root.Remove(path) // replacement identity must invalidate even equal size/mtime
	write(0)
	os.Chtimes(filepath.Join(root.Name(), path), info.ModTime(), info.ModTime())
	secondBody, e := a.loadThumbnail(context.Background(), "owner", "image.png")
	if e != nil || bytes.Equal(firstBody, secondBody) {
		t.Fatal("replacement reused thumbnail")
	}
	root.Remove(path)
	if body, e := a.loadThumbnail(context.Background(), "owner", "image.png"); e != nil || len(body) != 0 {
		t.Fatal("deleted source served cached image")
	}
	f, _ = root.OpenFile(path, os.O_WRONLY|os.O_CREATE, 0600)
	f.Truncate(thumbnailInputBytes + 1)
	f.Close()
	if body, e := a.loadThumbnail(context.Background(), "owner", "image.png"); e != nil || len(body) != 0 {
		t.Fatal("oversize source decoded")
	}
	a.thumbnails.slots <- struct{}{}
	a.thumbnails.slots <- struct{}{}
	write(255)
	if _, e := a.loadThumbnail(ctx, "owner", "image.png"); e != context.Canceled {
		t.Fatal("cancelled queue accepted", e)
	}
	<-a.thumbnails.slots
	<-a.thumbnails.slots
	current, _ := root.Lstat(path)
	for i := 0; i < thumbnailCacheEntries+10; i++ {
		a.thumbnails.put(strconv.Itoa(i), current, []byte{1})
	}
	if len(a.thumbnails.entries) != thumbnailCacheEntries || a.thumbnails.bytes > thumbnailCacheBytes {
		t.Fatal("cache entry limit exceeded")
	}
	for i := 0; i < 5; i++ {
		a.thumbnails.put("large"+strconv.Itoa(i), current, make([]byte, thumbnailCacheBytes/3))
	}
	if a.thumbnails.bytes > thumbnailCacheBytes {
		t.Fatal("cache byte limit exceeded")
	}
}

func TestThumbnailSmallImagesAndGIFCanvas(t *testing.T) {
	palette := color.Palette{color.NRGBA{}, color.NRGBA{G: 255, A: 255}}
	frame := image.NewPaletted(image.Rect(20, 10, 30, 20), palette)
	for i := range frame.Pix {
		frame.Pix[i] = 1
	}
	var source bytes.Buffer
	if e := gif.EncodeAll(&source, &gif.GIF{Image: []*image.Paletted{frame}, Delay: []int{0}, Config: image.Config{ColorModel: palette, Width: 40, Height: 30}}); e != nil {
		t.Fatal(e)
	}
	body, e := makeThumbnail(context.Background(), bytes.NewReader(source.Bytes()))
	if e != nil {
		t.Fatal(e)
	}
	out, e := png.Decode(bytes.NewReader(body))
	if e != nil {
		t.Fatal(e)
	}
	if out.Bounds() != image.Rect(0, 0, 40, 30) {
		t.Fatal("small image upscaled or GIF canvas lost")
	}
	_, g, _, a := out.At(25, 15).RGBA()
	if g != 65535 || a != 65535 {
		t.Fatal("first frame offset lost")
	}
	_, _, _, a = out.At(0, 0).RGBA()
	if a != 0 {
		t.Fatal("transparent GIF canvas lost")
	}
}
