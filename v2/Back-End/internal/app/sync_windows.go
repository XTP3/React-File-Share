//go:build windows

package app

import "os"

// Windows does not expose Unix directory fsync through os.File.Sync. File
// content is flushed before publication and Mongo intents are journaled; the
// exclusive lock and inode comparison still make process recovery safe.
func syncDir(root *os.Root, path string) error {
	f, e := root.Open(path)
	if e != nil {
		return e
	}
	return f.Close()
}
