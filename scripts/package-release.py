#!/usr/bin/env python3
"""Package one prebuilt release target or write SHA256SUMS for all bundles."""
import argparse
import gzip
import hashlib
import io
import os
from pathlib import Path
import re
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TARGETS = {('linux', 'amd64'), ('linux', 'arm64'), ('windows', 'amd64'), ('darwin', 'amd64'), ('darwin', 'arm64')}


def package(version, system, arch, binary, www, output):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', version):
        raise ValueError('version must contain only letters, digits, dot, underscore or hyphen')
    if (system, arch) not in TARGETS:
        raise ValueError('unsupported release target')
    if not binary.is_file() or not (www / 'index.html').is_file():
        raise ValueError('build the executable and frontend index.html first')
    epoch = int(os.environ.get('SOURCE_DATE_EPOCH', '0'))
    entries = [('fileshare.exe' if system == 'windows' else 'fileshare', binary, 0o755)]
    entries += [(f'www/{p.relative_to(www).as_posix()}', p, 0o644) for p in sorted(www.rglob('*')) if p.is_file()]
    entries += [(name, ROOT / path, 0o644) for name, path in [
        ('Config.example.json', 'v2/Back-End/Config.example.json'),
        ('LICENSE', 'LICENSE'), ('INSTALL.md', 'docs/INSTALL.md'), ('UPGRADE.md', 'docs/UPGRADE.md')]]
    for _, path, _ in entries:
        if path.is_symlink() or not path.is_file():
            raise ValueError(f'release input must be a regular file: {path}')
    output.mkdir(parents=True, exist_ok=True)
    stem = f'fileshare-{version}-{system}-{arch}'
    archive = output / (stem + ('.zip' if system == 'windows' else '.tar.gz'))
    if system == 'windows':
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
            for name, path, mode in entries:
                info = zipfile.ZipInfo(f'{stem}/{name}', date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = (0o100000 | mode) << 16
                bundle.writestr(info, path.read_bytes())
    else:
        with archive.open('wb') as raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=epoch) as zipped, tarfile.open(fileobj=zipped, mode='w') as bundle:
            for name, path, mode in entries:
                content = path.read_bytes()
                info = tarfile.TarInfo(f'{stem}/{name}')
                info.size, info.mode, info.mtime = len(content), mode, epoch
                bundle.addfile(info, io.BytesIO(content))
    return archive


def checksums(output):
    archives = sorted(p for p in output.iterdir() if p.name.endswith(('.tar.gz', '.zip')))
    if not archives:
        raise ValueError('no release bundles found')
    manifest = output / 'SHA256SUMS'
    manifest.write_text(''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n' for p in archives))
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version')
    parser.add_argument('--os', dest='system')
    parser.add_argument('--arch')
    parser.add_argument('--binary', type=Path)
    parser.add_argument('--www', type=Path, default=ROOT / 'v2/Back-End/www')
    parser.add_argument('--output', type=Path, default=ROOT / 'release')
    parser.add_argument('--checksums', action='store_true')
    args = parser.parse_args()
    if args.checksums:
        result = checksums(args.output)
    else:
        if not all((args.version, args.system, args.arch, args.binary)):
            parser.error('--version, --os, --arch and --binary are required')
        result = package(args.version, args.system, args.arch, args.binary, args.www, args.output)
    print(result)


if __name__ == '__main__':
    main()
