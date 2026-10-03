//go:build !windows

package app

import "os"

func syncDir(root *os.Root, path string) error {
	f, e := root.Open(path)
	if e != nil {
		return e
	}
	defer f.Close()
	return f.Sync()
}
