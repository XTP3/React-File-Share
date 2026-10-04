package app

import (
	"bytes"
	"context"
	"errors"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"io"
	"net/http"
	"os"
	"sync"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"golang.org/x/image/draw"
	"golang.org/x/image/riff"
	"golang.org/x/image/vp8"
	"golang.org/x/image/vp8l"
	_ "golang.org/x/image/webp"
)

const (
	thumbnailSide         = 384
	thumbnailInputBytes   = 20 << 20
	thumbnailPixels       = 12_000_000
	thumbnailCacheBytes   = 16 << 20
	thumbnailCacheEntries = 128
	thumbnailDecoders     = 2
)

// Bodies are cached only inside this process, after authorization. Each hit
// requires opening and checking the current source, including its file identity.
type thumbnailEntry struct {
	info os.FileInfo
	body []byte
	used uint64
}
type thumbnailCache struct {
	once    sync.Once
	mu      sync.Mutex
	entries map[string]thumbnailEntry
	bytes   int
	tick    uint64
	slots   chan struct{}
}

func (c *thumbnailCache) init() {
	c.once.Do(func() {
		c.entries = make(map[string]thumbnailEntry)
		c.slots = make(chan struct{}, thumbnailDecoders)
	})
}
func sameThumbnailSource(a, b os.FileInfo) bool {
	return os.SameFile(a, b) && a.Size() == b.Size() && a.ModTime().Equal(b.ModTime())
}
func (c *thumbnailCache) get(path string, info os.FileInfo) ([]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[path]
	if !ok {
		return nil, false
	}
	if !sameThumbnailSource(e.info, info) {
		c.bytes -= len(e.body)
		delete(c.entries, path)
		return nil, false
	}
	c.tick++
	e.used = c.tick
	c.entries[path] = e
	return e.body, true
}
func (c *thumbnailCache) put(path string, info os.FileInfo, body []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if e, ok := c.entries[path]; ok {
		c.bytes -= len(e.body)
		delete(c.entries, path)
	}
	if len(body) > thumbnailCacheBytes {
		return
	}
	for len(c.entries) >= thumbnailCacheEntries || c.bytes+len(body) > thumbnailCacheBytes {
		oldest := ""
		var used uint64
		for key, entry := range c.entries {
			if oldest == "" || entry.used < used {
				oldest, used = key, entry.used
			}
		}
		c.bytes -= len(c.entries[oldest].body)
		delete(c.entries, oldest)
	}
	c.tick++
	c.entries[path] = thumbnailEntry{info: info, body: body, used: c.tick}
	c.bytes += len(body)
}

type thumbnailReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r thumbnailReader) Read(b []byte) (int, error) {
	if e := r.ctx.Err(); e != nil {
		return 0, e
	}
	return r.reader.Read(b)
}
func thumbnailDimensions(width, height int) bool {
	return width > 0 && height > 0 && width <= 16384 && height <= 16384 && int64(width)*int64(height) <= thumbnailPixels
}

// Extended WebP's DecodeConfig reports the VP8X canvas, while its decoder
// allocates using the independent VP8/VP8L frame header. Validate both before
// any pixel decoding (including the optional alpha plane).
func boundedWebP(reader io.Reader, config image.Config) bool {
	form, chunks, e := riff.NewReader(reader)
	if e != nil || string(form[:]) != "WEBP" {
		return false
	}
	seenCanvas := false
	for {
		id, length, data, e := chunks.Next()
		if e != nil || length > thumbnailInputBytes {
			return false
		}
		switch string(id[:]) {
		case "VP8X":
			var header [10]byte
			if seenCanvas || length != 10 {
				return false
			}
			seenCanvas = true
			if _, e = io.ReadFull(data, header[:]); e != nil {
				return false
			}
			width := 1 + int(header[4]) + int(header[5])<<8 + int(header[6])<<16
			height := 1 + int(header[7]) + int(header[8])<<8 + int(header[9])<<16
			if header[0]&2 != 0 || !thumbnailDimensions(width, height) || width != config.Width || height != config.Height {
				return false
			}
		case "ALPH":
			if !seenCanvas {
				return false
			}
		case "VP8 ":
			decoder := vp8.NewDecoder()
			decoder.Init(data, int(length))
			header, e := decoder.DecodeFrameHeader()
			return e == nil && thumbnailDimensions(header.Width, header.Height) && header.Width == config.Width && header.Height == config.Height
		case "VP8L":
			frame, e := vp8l.DecodeConfig(data)
			return e == nil && thumbnailDimensions(frame.Width, frame.Height) && frame.Width == config.Width && frame.Height == config.Height
		}
	}
}

// DecodeConfig limits allocation before full decoding. gif.Decode (through
// image.Decode) reads the first frame only; the response is always static PNG.
func makeThumbnail(ctx context.Context, source io.ReadSeeker) ([]byte, error) {
	read := func() io.Reader { return thumbnailReader{ctx, io.LimitReader(source, thumbnailInputBytes)} }
	config, format, e := image.DecodeConfig(read())
	if e != nil || !thumbnailDimensions(config.Width, config.Height) {
		return nil, ctx.Err()
	}
	if format != "jpeg" && format != "png" && format != "gif" && format != "webp" {
		return nil, nil
	}
	if _, e = source.Seek(0, io.SeekStart); e != nil {
		return nil, e
	}
	if format == "webp" {
		if !boundedWebP(read(), config) {
			return nil, ctx.Err()
		}
		if _, e = source.Seek(0, io.SeekStart); e != nil {
			return nil, e
		}
	}
	src, _, e := image.Decode(read())
	if e != nil {
		return nil, ctx.Err()
	}
	if e = ctx.Err(); e != nil {
		return nil, e
	}
	// A GIF's first frame can occupy only part of its logical canvas.
	if src.Bounds() != image.Rect(0, 0, config.Width, config.Height) {
		canvas := image.NewNRGBA(image.Rect(0, 0, config.Width, config.Height))
		draw.Draw(canvas, src.Bounds(), src, src.Bounds().Min, draw.Src)
		src = canvas
	}
	w, h := config.Width, config.Height
	if w > thumbnailSide || h > thumbnailSide {
		if w >= h {
			h = max(1, h*thumbnailSide/w)
			w = thumbnailSide
		} else {
			w = max(1, w*thumbnailSide/h)
			h = thumbnailSide
		}
	}
	dst := image.NewNRGBA(image.Rect(0, 0, w, h))
	draw.ApproxBiLinear.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Src, nil)
	if e = ctx.Err(); e != nil {
		return nil, e
	}
	var out bytes.Buffer
	e = (&png.Encoder{CompressionLevel: png.BestSpeed}).Encode(&out, dst)
	if e != nil {
		return nil, e
	}
	return out.Bytes(), ctx.Err()
}
func (a *App) loadThumbnail(ctx context.Context, owner, name string) ([]byte, error) {
	path, e := a.safePath(owner, name, false)
	if e != nil {
		return nil, nil
	}
	f, e := a.root.Open(path)
	if e != nil {
		return nil, nil
	}
	defer f.Close()
	info, e := f.Stat()
	if e != nil || !info.Mode().IsRegular() {
		return nil, nil
	}
	c := &a.thumbnails
	c.init()
	if body, ok := c.get(path, info); ok {
		return body, ctx.Err()
	}
	if info.Size() > thumbnailInputBytes {
		c.put(path, info, nil)
		return nil, nil
	}
	select {
	case c.slots <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	defer func() { <-c.slots }()
	// Requests queued behind a decoder can reuse its completed result.
	if body, ok := c.get(path, info); ok {
		return body, ctx.Err()
	}
	body, e := makeThumbnail(ctx, f)
	if e != nil {
		return nil, e
	}
	// Do not publish a stale decode if a replacement or deletion raced it.
	current, e := a.root.Lstat(path)
	if e != nil || !sameThumbnailSource(info, current) {
		return nil, nil
	}
	c.put(path, info, body)
	return body, nil
}
func (a *App) thumbnail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
	var file bson.M
	e := a.DB.Collection("files").FindOne(r.Context(), bson.M{"uniqueID": r.PathValue("id"), "uploaderID": who(r).Owner}).Decode(&file)
	if e != nil {
		if errors.Is(e, mongo.ErrNoDocuments) {
			fail(w, 404, "file not found")
		} else {
			fail(w, 503, "database unavailable")
		}
		return
	}
	body, e := a.loadThumbnail(r.Context(), who(r).Owner, str(file, "fileName"))
	if r.Context().Err() != nil {
		return
	}
	if e != nil || len(body) == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Write(body)
}
