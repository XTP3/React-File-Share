#!/usr/bin/env python3
"""Validate bundle contents, deterministic packaging and path rejection."""
import importlib.util
from pathlib import Path
import tarfile
import tempfile
import unittest
import zipfile

SPEC = importlib.util.spec_from_file_location('release', Path(__file__).with_name('package-release.py'))
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class PackagingTest(unittest.TestCase):
    def test_targets_and_reproducibility(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            www = root / 'www'
            www.mkdir()
            (www / 'index.html').write_text('<html></html>')
            binary = root / 'app'
            binary.write_bytes(b'executable')
            # A nearby production config and uploads must never be included.
            (root / 'Config.json').write_text('private')
            (root / 'uploads').mkdir()
            (root / 'uploads/secret').write_text('private')
            for system, arch in sorted(release.TARGETS):
                archive = release.package('v2.0.0', system, arch, binary, www, root / 'out')
                original = archive.read_bytes()
                self.assertEqual(original, release.package('v2.0.0', system, arch, binary, www, root / 'out').read_bytes())
                if system == 'windows':
                    with zipfile.ZipFile(archive) as bundle:
                        names = bundle.namelist()
                else:
                    with tarfile.open(archive) as bundle:
                        names = bundle.getnames()
                        exe = next(x for x in bundle.getmembers() if x.name.endswith('/fileshare'))
                        self.assertEqual(exe.mode, 0o755)
                names = {n.split('/', 1)[1] for n in names}
                self.assertEqual(names, {'fileshare.exe' if system == 'windows' else 'fileshare', 'www/index.html', 'Config.example.json', 'LICENSE', 'INSTALL.md', 'UPGRADE.md'})
            lines = release.checksums(root / 'out').read_text().splitlines()
            self.assertEqual(len(lines), 5)
            self.assertTrue(all(len(line.split()[0]) == 64 for line in lines))
            with self.assertRaises(ValueError):
                release.package('../unsafe', 'linux', 'amd64', binary, www, root / 'out')
            (www / 'link').symlink_to(root / 'Config.json')
            with self.assertRaises(ValueError):
                release.package('v2.0.0', 'linux', 'amd64', binary, www, root / 'out')


if __name__ == '__main__':
    unittest.main()
