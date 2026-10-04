#!/usr/bin/env python3
"""Independent HTTP regression tests against a real, isolated MongoDB database."""
import argparse
import base64
import concurrent.futures
import hashlib
import hmac
import http.cookiejar
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import struct
import zlib

REPO = Path(__file__).resolve().parents[1]
SECRET = 'synthetic-integration-jwt-secret-no-user-data'
LIMIT = 4096


class SkipGroup(Exception):
    pass


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def jwt(owner, *, expired=False):
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).rstrip(b'=')
    now = int(time.time())
    data = encode({'alg': 'HS256', 'typ': 'JWT'}) + b'.' + encode({
        'uniqueID': owner, 'iat': now - 60, 'exp': now - 1 if expired else now + 3600,
    })
    return (data + b'.' + base64.urlsafe_b64encode(hmac.new(SECRET.encode(), data, hashlib.sha256).digest()).rstrip(b'=')).decode()


class HTTP:
    def __init__(self, base, token=None):
        self.base = base.rstrip('/')
        self.token = token
        self.csrf = None
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))

    def request(self, method, path, data=None, *, headers=None, status=200, csrf=True):
        headers = dict(headers or {})
        if self.token:
            headers['Authorization'] = 'Bearer ' + self.token
        if self.csrf and csrf and method not in ('GET', 'HEAD'):
            headers['X-CSRF-Token'] = self.csrf
        if data is not None and not isinstance(data, bytes):
            data = json.dumps(data).encode()
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            response = self.opener.open(req, timeout=15)
        except urllib.error.HTTPError as exc:
            response = exc
        body = response.read()
        if status is not None:
            allowed = (status,) if isinstance(status, int) else tuple(status)
            check(response.status in allowed, f'{method} {path}: expected {allowed}, got {response.status}: {body[:400]!r}')
        parsed = body
        if response.headers.get_content_type() == 'application/json' and not path.startswith(('/f/d/', '/f/v/')):
            try:
                parsed = json.loads(body)
            except (ValueError, UnicodeDecodeError):
                pass
        return response.status, parsed, response.headers

    def get(self, path, **kw):
        return self.request('GET', path, **kw)[1]

    def post(self, path, data=None, **kw):
        return self.request('POST', path, data, **kw)[1]

    def upload(self, files, *, path='/api/v2/files/upload', status=200):
        boundary = 'integration-' + uuid.uuid4().hex
        chunks = []
        for name, content, mime in files:
            chunks.append((f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="{name}"\r\nContent-Type: {mime}\r\n\r\n').encode())
            chunks.extend([content, b'\r\n'])
        chunks.append(f'--{boundary}--\r\n'.encode())
        return self.post(path, b''.join(chunks), headers={'Content-Type': 'multipart/form-data; boundary=' + boundary}, status=status)


class Suite:
    def __init__(self, base, root, db, restart=None, lock_probe=None):
        self.base, self.root, self.db = base, root, db
        self.restart = restart
        self.lock_probe = lock_probe
        self.accounts = json.loads((REPO / 'tests/fixtures/legacy-accounts.json').read_text())
        self.owner = HTTP(base, jwt('fixture-owner'))
        self.other = HTTP(base, jwt('fixture-other'))
        self.browser = HTTP(base)
        self.passed = 0
        self.failed = []
        self.skipped = 0

    def run(self, name, function):
        try:
            function()
            self.passed += 1
            print(f'PASS {name}', flush=True)
        except SkipGroup as exc:
            self.skipped += 1
            print(f'SKIP {name}: {exc}', flush=True)
        except Exception as exc:
            self.failed.append((name, str(exc)))
            print(f'FAIL {name}: {exc}', flush=True)

    def listing(self, client=None, **params):
        return (client or self.owner).get('/api/v2/files?' + urllib.parse.urlencode(params))

    def browser_login(self, client=None):
        client = client or self.browser
        account = self.accounts[0]
        result = client.post('/api/v2/auth/login', {'username': account['username'], 'password': account['password']})
        check(result['user']['uniqueID'] == account['uniqueID'], 'session owner differs')
        check(result.get('csrfToken'), 'login must supply CSRF token')
        client.csrf = result['csrfToken']
        return client

    def config(self):
        data = HTTP(self.base).get('/api/v2/config')
        check(data['maxUploadSize'] == LIMIT, 'runtime upload limit mismatch')
        check(set(data).issuperset({'version', 'dateLanguage', 'timeZone'}), 'missing public config')
        check(not any('secret' in key.lower() or 'database' in key.lower() for key in data), 'public config exposes private keys')

    def legacy_auth(self):
        for account in self.accounts:
            result = HTTP(self.base).post('/api/authentication/login', {'username': account['username'], 'password': account['password']})
            check(isinstance(result.get('token'), str), 'legacy login token missing')
            HTTP(self.base, result['token']).post('/api/authentication/token')
        self.owner.post('/api/authentication/token')
        HTTP(self.base, jwt('fixture-owner', expired=True)).post('/api/authentication/token', status=401)
        HTTP(self.base, jwt('fixture-owner') + 'tampered').post('/api/authentication/token', status=401)
        HTTP(self.base).post('/api/authentication/login', {'username': self.accounts[0]['username'], 'password': 'wrong'}, status=401)

    def sessions(self):
        HTTP(self.base).get('/api/v2/auth/me', status=401)
        cross_origin = HTTP(self.base)
        cross_origin.post('/api/v2/auth/login', json.dumps({'username': self.accounts[0]['username'], 'password': self.accounts[0]['password']}).encode(),
                          headers={'Content-Type': 'text/plain', 'Origin': 'https://attacker.invalid'}, status=(400, 403, 415))
        check(not list(cross_origin.cookies), 'rejected cross-origin login created session cookie')
        browser = self.browser_login()
        check(browser.get('/api/v2/auth/me')['csrfToken'] == browser.csrf, 'me token must match session')
        cookies = list(browser.cookies)
        check(cookies and any(cookie.has_nonstandard_attr('HttpOnly') for cookie in cookies), 'session cookie must be HttpOnly')
        browser.post('/api/v2/collections', {'title': 'Missing CSRF'}, csrf=False, status=403)
        browser.post('/api/v2/collections', {'title': 'Bad CSRF'}, headers={'X-CSRF-Token': 'bad'}, csrf=False, status=403)
        self.other.request('DELETE', '/api/v2/files/legacy-text-id', status=(403, 404))
        self.other.request('DELETE', '/api/files/delete/legacy-text-id', status=404)
        check(self.owner.get('/f/d/legacy-text-id') == b'0123456789 legacy fixture\n', 'ownership rejection changed bytes')

    def legacy_files(self):
        for sort in ('alphabetical', 'chronological', 'size', 'unknown'):
            result = self.owner.post('/f', {'sortOrder': sort})
            check(isinstance(result, list) and len(result) == 34, 'legacy list shape/count differs')
            record = next(f for f in result if f['uniqueID'] == 'legacy-text-id')
            check(record['unknownLegacy']['nested'][0] == 'preserve', 'unknown legacy metadata lost in response')
            check('category' not in record, 'legacy listing adds v2 fields')
            check(len(record['_id']) == 24 and record['__v'] == 0, 'legacy BSON JSON shape differs')
        found = self.owner.get('/f/s/' + urllib.parse.quote('PAGE', safe=''))
        check(len(found) == 5 and all('Page' in f['fileName'] for f in found), 'legacy case-insensitive bounded search differs')
        self.owner.get('/f/s/no-such-fixture', status=404)
        self.owner.get('/f/s/' + urllib.parse.quote('[', safe=''), status=400)
        content = b'legacy uploaded bytes'
        self.owner.upload([('legacy-upload.txt', content, 'text/plain')], path='/api/files/upload')
        file = next(f for f in self.owner.post('/f', {}) if f['fileName'] == 'legacy-upload.txt')
        check(HTTP(self.base).get('/f/d/' + file['uniqueID']) == content, 'legacy upload download differs')
        self.owner.request('DELETE', '/api/files/delete/' + file['uniqueID'])
        self.owner.get('/f/d/' + file['uniqueID'], status=404)

    def downloads(self):
        public = HTTP(self.base)
        full = b'0123456789 legacy fixture\n'
        status, data, headers = public.request('GET', '/f/d/legacy-text-id')
        check(data == full and 'attachment' in headers['Content-Disposition'], 'download disposition/content differs')
        _, data, headers = public.request('GET', '/f/v/legacy-text-id')
        check(data == full and 'attachment' not in headers.get('Content-Disposition', ''), 'inline view disposition differs')
        for range_header, expected in [('bytes=2-5', full[2:6]), ('bytes=-4', full[-4:]), ('bytes=8-', full[8:])]:
            _, data, headers = public.request('GET', '/f/d/legacy-text-id', headers={'Range': range_header}, status=206)
            check(data == expected and headers['Content-Range'].startswith('bytes '), 'byte range response differs')
        public.get('/f/d/legacy-text-id', headers={'Range': 'bytes=9999-'}, status=416)
        check(public.get('/f/d/legacy-unicode-id') == b'unicode content', 'non-ASCII legacy share fails')
        public.get('/f/v/legacy-missing-id', status=404)
        public.get('/f/d/unknown', status=404)

    def duplicate_reference_delete(self):
        file = self.owner.upload([('reference-delete.txt', b'shared-path-bytes', 'text/plain')])['files'][0]
        duplicate = fixture('clone-file', self.db, self.root, file['uniqueID'])['uniqueID']
        self.owner.request('DELETE', '/api/v2/files/' + file['uniqueID'])
        check(self.owner.get('/f/d/' + duplicate) == b'shared-path-bytes', 'deleting one legacy reference broke another public link')
        self.owner.request('DELETE', '/api/v2/files/' + duplicate)
        check(not (self.root / 'fixture-owner/reference-delete.txt').exists(), 'final reference deletion left physical file')

    def inline_security(self):
        for name, content, mime in [('hostile.html', b'<script>document.cookie</script>', 'text/html'),
                                    ('hostile.svg', b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'image/svg+xml')]:
            file = self.owner.upload([(name, content, mime)])['files'][0]
            _, _, headers = HTTP(self.base).request('GET', '/f/v/' + file['uniqueID'])
            csp = headers.get('Content-Security-Policy', '')
            check('sandbox' in csp and 'allow-scripts' not in csp and 'allow-same-origin' not in csp,
                  'same-origin active content requires restrictive sandbox CSP')
            self.owner.request('DELETE', '/api/v2/files/' + file['uniqueID'])
        for name, mime in [('native.webm', 'video/webm'), ('native.wav', 'audio/wav')]:
            media = self.owner.upload([(name, b'isolated-mime-policy-fixture', mime)])['files'][0]
            _, _, headers = HTTP(self.base).request('GET', '/f/v/' + media['uniqueID'])
            csp = headers.get('Content-Security-Policy', '')
            check("media-src 'self' blob:" in csp and 'sandbox allow-same-origin;' in csp and 'allow-scripts' not in csp and "default-src 'none'" in csp,
                  'native media originals must retain sandbox and permit their same-origin source')
            self.owner.request('DELETE', '/api/v2/files/' + media['uniqueID'])

    def disk_failures(self):
        directory = self.root / 'fixture-owner'
        file = self.owner.upload([('delete-failure.txt', b'recoverable', 'text/plain')])['files'][0]
        permissions = directory.stat().st_mode & 0o777
        try:
            directory.chmod(0o500)
            self.owner.upload([('write-failure.txt', b'cannot-write', 'text/plain')], status=(500, 503))
            self.owner.request('DELETE', '/api/v2/files/' + file['uniqueID'], status=(500, 503))
            check((directory / 'delete-failure.txt').read_bytes() == b'recoverable', 'failed deletion removed bytes')
            check(self.listing(q='delete-failure.txt')['total'] == 1, 'failed deletion removed metadata')
            check(self.listing(q='write-failure.txt')['total'] == 0, 'failed disk write left metadata')
        finally:
            directory.chmod(permissions)
        if self.restart:
            self.restart()
            self.owner.get('/f/d/' + file['uniqueID'], status=404)
            check(self.listing(q='delete-failure.txt')['total'] == 0, 'restart did not recover journaled deletion')
        else:
            self.owner.request('DELETE', '/api/v2/files/' + file['uniqueID'])

    def database_failure(self):
        before = {str(p.relative_to(self.root)) for p in self.root.rglob('*') if p.is_file()}
        total = self.listing()['total']
        fixture('reject-file-writes', self.db, self.root)
        try:
            self.owner.upload([('mongo-failure.txt', b'publication-must-roll-back', 'text/plain')], status=(500, 503))
        finally:
            fixture('restore-file-writes', self.db, self.root)
        after = {str(p.relative_to(self.root)) for p in self.root.rglob('*') if p.is_file()}
        check(after == before and self.listing()['total'] == total, 'Mongo insert failure left published bytes, staging, or metadata')

    def pagination(self):
        first = self.listing()
        check(first['page'] == 1 and first['pageSize'] == 25 and first['total'] == 34 and len(first['items']) == 25, 'default pagination differs')
        all_ids = []
        for page in range(1, 6):
            result = self.listing(page=page, pageSize=7, sort='date', direction='asc')
            check(result['totalPages'] == 5, 'pagination totalPages differs')
            ids = [f['uniqueID'] for f in result['items']]
            check(ids == [f['uniqueID'] for f in self.listing(page=page, pageSize=7, sort='date', direction='asc')['items']], 'tie ordering unstable')
            all_ids.extend(ids)
        check(len(all_ids) == len(set(all_ids)) == 34, 'pagination duplicates or omits files')
        check(self.listing(page=100)['items'] == [], 'out-of-range page must be empty')
        for sort, key in [('date', 'timeOfUpload'), ('size', 'fileSize'), ('type', 'fileType')]:
            for direction in ('asc', 'desc'):
                values = [f[key] for f in self.listing(pageSize=100, sort=sort, direction=direction)['items']]
                check(values == sorted(values, reverse=direction == 'desc'), f'{sort}/{direction} order differs')
        ascending = [f['uniqueID'] for f in self.listing(pageSize=100, sort='name', direction='asc')['items']]
        descending = [f['uniqueID'] for f in self.listing(pageSize=100, sort='name', direction='desc')['items']]
        check(len(ascending) == 34 and ascending != descending, 'name sort ignored')

    def filters(self):
        check(self.listing(q='PAGE')['total'] == 27, 'case-insensitive filename search differs')
        check(self.listing(q='[')['total'] == 0, 'v2 search must treat regex metacharacters literally')
        check(self.listing(category='photo,gif')['total'] == 2, 'category OR differs')
        check(self.listing(category='photo')['items'][0]['uniqueID'] == 'legacy-photo-id', 'legacy extension fallback category differs')
        result = self.listing(q='Page', category='document', minSize=5, maxSize=10, **{'from': 1700000010004, 'to': 1700000010009})
        check(result['total'] == 6, 'composed filters must combine with AND')
        for sort in ('name', 'date', 'size', 'type'):
            for direction in ('asc', 'desc'):
                combined = self.listing(q='Page', category='document,photo', minSize=5, maxSize=10,
                                        sort=sort, direction=direction, **{'from': 1700000010004, 'to': 1700000010009})
                check(combined['total'] == 6 and len(combined['items']) == 6, f'composed filters differ with {sort}/{direction}')
        check(self.listing(q='no-results')['items'] == [], 'empty search should be successful')
        code, bounded, _ = self.owner.request('GET', '/api/v2/files?pageSize=101', status=(200, 400))
        if code == 200:
            check(bounded['pageSize'] <= 100, 'maximum page size not bounded')
        for params in ({'page': 0}, {'page': 'nan'}, {'pageSize': 0}, {'sort': 'bad'},
                       {'direction': 'sideways'}, {'category': 'bad'}, {'minSize': -1}, {'minSize': 'nan'},
                       {'minSize': 5, 'maxSize': 2}, {'from': 'nan'}, {'from': 10, 'to': 1}):
            self.owner.get('/api/v2/files?' + urllib.parse.urlencode(params), status=400)

    def rejected_uploads(self):
        original = self.owner.get('/f/d/legacy-text-id')
        baseline = {p.name: p.read_bytes() for p in (self.root / 'fixture-owner').iterdir() if p.is_file()}
        count = self.listing()['total']
        self.owner.upload([('Legacy report.txt', b'overwrite', 'text/plain')], status=409)
        self.owner.upload([('new-first.txt', b'new', 'text/plain'), ('Legacy report.txt', b'overwrite', 'text/plain')], status=409)
        self.owner.upload([('batch-repeat.txt', b'first', 'text/plain'), ('batch-repeat.txt', b'second', 'text/plain')], status=409)
        self.owner.upload([('over-a.txt', b'a' * 2200, 'text/plain'), ('over-b.txt', b'b' * 2200, 'text/plain')], status=413)
        self.owner.upload([('too-big.txt', b'a' * (LIMIT + 1), 'text/plain')], status=413)
        self.owner.upload([], status=400)
        for name in ('../escape.txt', '..\\escape.txt', 'bad:name.txt', '.', 'a' * 256):
            self.owner.upload([(name, b'unsafe-name', 'text/plain')], status=400)
        check(self.owner.get('/f/d/legacy-text-id') == original, 'conflict overwrote original')
        check(self.listing()['total'] == count, 'rejected batch created metadata')
        after = {p.name: p.read_bytes() for p in (self.root / 'fixture-owner').iterdir() if p.is_file()}
        check(after == baseline, 'rejected batch left files or overwrote bytes')

    def successful_uploads(self):
        inputs = [('uploaded résumé.txt', b'unicode-upload', 'text/plain'), ('empty.txt', b'', 'text/plain'),
                  ('voice.mp3', b'audio-fixture', 'audio/mpeg'), ('clip.mp4', b'video-fixture', 'video/mp4')]
        result = self.owner.upload(inputs)
        check(len(result['files']) == len(inputs), 'multi upload result missing files')
        check([f['category'] for f in result['files']] == ['document', 'document', 'audio', 'video'], 'upload category assignment differs')
        for file, (_, content, _) in zip(result['files'], inputs):
            check(self.owner.get('/f/d/' + file['uniqueID']) == content, 'uploaded bytes differ')
            self.owner.request('DELETE', '/api/v2/files/' + file['uniqueID'])
            self.owner.get('/f/d/' + file['uniqueID'], status=404)
        boundary = self.owner.upload([('limit-exact.txt', b'x' * LIMIT, 'text/plain')])['files'][0]
        check(len(self.owner.get('/f/d/' + boundary['uniqueID'])) == LIMIT, 'exact aggregate limit should succeed')
        self.owner.request('DELETE', '/api/v2/files/' + boundary['uniqueID'])

    def concurrent_duplicates(self):
        def upload(index):
            client = HTTP(self.base, jwt('fixture-owner'))
            return index, client.upload([('concurrent.txt', f'winner-{index}'.encode(), 'text/plain')], status=(200, 409))
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(upload, [0, 1]))
        files = self.listing(q='concurrent.txt')['items']
        check(len(files) == 1, 'concurrent duplicate created more than one record')
        winner = next((i for i, result in results if isinstance(result, dict) and 'files' in result), None)
        check(winner is not None and self.owner.get('/f/d/' + files[0]['uniqueID']) == f'winner-{winner}'.encode(), 'concurrent winner bytes differ')
        self.owner.request('DELETE', '/api/v2/files/' + files[0]['uniqueID'])

    def cancellation(self):
        parsed = urllib.parse.urlsplit(self.base)
        check(parsed.scheme == 'http', 'cancellation runner requires local HTTP')
        before = {str(p.relative_to(self.root)) for p in self.root.rglob('*') if p.is_file()}
        with socket.create_connection((parsed.hostname, parsed.port or 80), timeout=5) as stream:
            header = (f'POST /api/v2/files/upload HTTP/1.1\r\nHost: {parsed.netloc}\r\nAuthorization: Bearer {self.owner.token}\r\n'
                      'Content-Type: multipart/form-data; boundary=cancel-fixture\r\nContent-Length: 3000\r\n\r\n'
                      '--cancel-fixture\r\nContent-Disposition: form-data; name="files"; filename="cancelled.txt"\r\n'
                      'Content-Type: text/plain\r\n\r\npartial-bytes')
            stream.sendall(header.encode())
            time.sleep(0.1)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            after = {str(p.relative_to(self.root)) for p in self.root.rglob('*') if p.is_file()}
            if after == before:
                break
            time.sleep(0.05)
        check(after == before and self.listing(q='cancelled.txt')['total'] == 0, 'cancelled upload left staging/files/metadata')

    def interrupted_process(self):
        if not self.restart:
            raise SkipGroup('cannot kill/restart an externally managed server')
        parsed = urllib.parse.urlsplit(self.base)
        before = {str(p.relative_to(self.root)) for p in self.root.rglob('*') if p.is_file()}
        with socket.create_connection((parsed.hostname, parsed.port or 80), timeout=5) as stream:
            header = (f'POST /api/v2/files/upload HTTP/1.1\r\nHost: {parsed.netloc}\r\nAuthorization: Bearer {self.owner.token}\r\n'
                      'Content-Type: multipart/form-data; boundary=kill-fixture\r\nContent-Length: 3000\r\n\r\n'
                      '--kill-fixture\r\nContent-Disposition: form-data; name="files"; filename="interrupted.txt"\r\n'
                      'Content-Type: text/plain\r\n\r\npartial-process-bytes')
            stream.sendall(header.encode())
            # Ensure a real staging write occurred before sending SIGKILL.
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                staged = [p for p in (self.root / '.staging').rglob('*') if p.is_file()]
                if staged:
                    break
                time.sleep(0.02)
            check(staged, 'interrupted upload never reached staging')
            self.restart()
        after = {str(p.relative_to(self.root)) for p in self.root.rglob('*') if p.is_file()}
        check(after == before and self.listing(q='interrupted.txt')['total'] == 0, 'restart left interrupted upload bytes/metadata')

    def stale_journal_preserves_replacement(self):
        if not self.restart:
            raise SkipGroup('cannot restart an externally managed server')
        uploads = self.owner.upload([('replacement-committed.txt', b'committed-replacement', 'text/plain'),
                                     ('replacement-intent.txt', b'intent-replacement', 'text/plain')])['files']
        for file, state in zip(uploads, ['committed', 'intent']):
            fixture('stale-delete-journal', self.db, self.root, file['uniqueID'], state)
        self.restart()
        for file, content in zip(uploads, [b'committed-replacement', b'intent-replacement']):
            check(self.owner.get('/f/d/' + file['uniqueID']) == content, 'stale deletion journal removed new replacement bytes')
            check(self.listing(q=file['fileName'])['total'] == 1, 'stale deletion journal removed replacement metadata')
            self.owner.request('DELETE', '/api/v2/files/' + file['uniqueID'])

    def runtime_lock(self):
        if not self.lock_probe:
            raise SkipGroup('cannot launch a second copy of an externally managed server')
        parsed = urllib.parse.urlsplit(self.base)
        with socket.create_connection((parsed.hostname, parsed.port or 80), timeout=5) as stream:
            header = (f'POST /api/v2/files/upload HTTP/1.1\r\nHost: {parsed.netloc}\r\nAuthorization: Bearer {self.owner.token}\r\n'
                      'Content-Type: multipart/form-data; boundary=lock-fixture\r\nContent-Length: 3000\r\n\r\n'
                      '--lock-fixture\r\nContent-Disposition: form-data; name="files"; filename="lock-active.txt"\r\n'
                      'Content-Type: text/plain\r\n\r\nstill-streaming')
            stream.sendall(header.encode())
            deadline = time.monotonic() + 5
            staged = []
            while time.monotonic() < deadline:
                staged = [p for p in (self.root / '.staging').rglob('*') if p.is_file()]
                if staged:
                    break
                time.sleep(0.02)
            check(staged, 'lock test did not reach active staging')
            self.lock_probe()
            check(all(p.exists() for p in staged), 'second process deleted active upload staging')
            self.owner.post('/api/authentication/token')
        deadline = time.monotonic() + 5
        while any(p.exists() for p in staged) and time.monotonic() < deadline:
            time.sleep(0.02)
        check(not any(p.exists() for p in staged), 'active server did not clean cancelled lock fixture')

    def collections(self):
        owner = self.browser_login()
        owner.post('/api/v2/collections', {'title': '  '}, status=400)
        first = owner.post('/api/v2/collections', {'title': 'First collection'}, status=201)
        second = owner.post('/api/v2/collections', {'title': 'Second collection'}, status=201)
        a, b = first['id'], second['id']
        route = '/api/v2/collections/' + a
        file_ids = ['legacy-text-id', 'legacy-photo-id']
        self.other.post(route + '/files', {'fileIds': file_ids}, status=(403, 404))
        owner.post(route + '/files', {'fileIds': ['legacy-text-id', 'legacy-other-id']}, status=(403, 404))
        check(self.listing(collectionId=a)['total'] == 0, 'cross-owner assignment modified collection')
        for unused in range(2):
            owner.post(route + '/files', {'fileIds': file_ids})
        owner.post('/api/v2/collections/' + b + '/files', {'fileIds': ['legacy-text-id']})
        check(self.listing(collectionId=a)['total'] == 2 and self.listing(collectionId=b)['total'] == 1, 'bulk/idempotent multiple membership differs')
        check(self.listing(collectionId=a, category='photo')['total'] == 1, 'collection filters differ')
        check(self.listing(collectionId='uncollected')['total'] == 32, 'uncollected filtering differs')
        renamed = owner.request('PATCH', route, {'title': 'Renamed collection'})[1]
        check(renamed['id'] == a and renamed['title'] == 'Renamed collection', 'rename changed collection ID')
        self.other.request('PATCH', route, {'title': 'Hijack'}, status=(403, 404))
        self.other.request('DELETE', route, status=(403, 404))
        self.other.get('/api/v2/files?collectionId=' + a, status=(403, 404))
        self.other.get('/api/v2/storage?collectionId=' + a, status=(403, 404))
        stats = owner.get('/api/v2/storage?collectionId=' + a)
        check(stats['totalFiles'] == 2 and stats['totalBytes'] == len(b'0123456789 legacy fixture\n') + len(b'photo-fixture'), 'collection uses stale metadata instead of disk bytes')
        owner.request('DELETE', route + '/files', {'fileIds': ['legacy-text-id']})
        check(self.listing(collectionId=a)['total'] == 1 and self.listing(collectionId=b)['total'] == 1, 'membership removal affects other collection')
        owner.request('DELETE', route)
        owner.request('DELETE', '/api/v2/collections/' + b)
        check(self.listing()['total'] == 34 and self.owner.get('/f/d/legacy-text-id') == b'0123456789 legacy fixture\n', 'collection delete removed stored files')

    def malformed_collections(self):
        items = self.owner.get('/api/v2/collections')['items']
        check(len(items) == 1, f'malformed legacy records became real collections: {items}')
        recovered = items[0]
        check(recovered['id'] == 'fixture-recoverable-title' and recovered['title'] == 'Untitled collection', 'blank valid-ID title is not recoverable')
        check(recovered['fileCount'] == 1 and recovered['totalBytes'] == len(b'0123456789 legacy fixture\n'), 'collection reported global storage statistics')
        route = '/api/v2/collections/' + recovered['id']
        renamed = self.owner.request('PATCH', route, {'title': 'Recovered collection'})[1]
        check(renamed['id'] == recovered['id'] and renamed['title'] == 'Recovered collection', 'fallback collection cannot be renamed')
        for bad_id in ['all', 'uncollected', '%20%20%20']:
            self.owner.request('PATCH', '/api/v2/collections/' + bad_id, {'title': 'Accidental'}, status=404)
            self.owner.request('DELETE', '/api/v2/collections/' + bad_id, status=404)
        fixture('restore-collection-title', self.db, self.root)

    def thumbnails(self):
        # Generate an actual PNG without depending on PIL or external binaries.
        def chunk(kind, data):
            return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
        width, height = 960, 480
        png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
        png += chunk(b'IDAT', zlib.compress((b'\0' + b'\xff\0\0' * width) * height)) + chunk(b'IEND', b'')
        file = self.owner.upload([('thumbnail-photo.png', png, 'image/png')])['files'][0]
        route = '/api/v2/files/' + file['uniqueID'] + '/thumbnail'
        HTTP(self.base).get(route, status=401)
        self.other.get(route, status=404)
        browser = self.browser_login(HTTP(self.base))
        status, body, headers = browser.request('GET', route)
        check(headers.get_content_type() == 'image/png' and 'no-store' in headers['Cache-Control'], 'thumbnail MIME/privacy headers differ')
        check(body[:8] == b'\x89PNG\r\n\x1a\n' and struct.unpack('>II', body[16:24]) == (384, 192), 'thumbnail is not a bounded static image')
        check(self.owner.get('/f/d/' + file['uniqueID']) == png, 'thumbnail mutated original upload')
        check(self.owner.get(route) == body, 'cache returned different image')
        self.owner.request('DELETE', '/api/v2/files/' + file['uniqueID'])
        self.owner.get(route, status=404)
        self.owner.get('/api/v2/files/legacy-text-id/thumbnail', status=204)
        self.owner.get('/api/v2/files/legacy-photo-id/thumbnail', status=204)
        self.owner.get('/api/v2/files/legacy-missing-id/thumbnail', status=204)
        mismatched = (REPO / 'v2/Back-End/internal/app/testdata/webp-small-canvas-large-frame.webp').read_bytes()
        webp = self.owner.upload([('mismatched.webp', mismatched, 'image/webp')])['files'][0]
        self.owner.get('/api/v2/files/' + webp['uniqueID'] + '/thumbnail', status=204)
        check(self.owner.get('/f/d/' + webp['uniqueID']) == mismatched, 'rejected WebP source was modified')
        self.owner.request('DELETE', '/api/v2/files/' + webp['uniqueID'])

    def storage(self):
        directory = self.root / 'fixture-owner'
        expected = sum(p.stat().st_size for p in directory.iterdir() if p.is_file())
        count = sum(p.is_file() for p in directory.iterdir())
        result = self.owner.post('/api/v2/storage/refresh')
        check(result['totalBytes'] == expected and result['totalFiles'] == count, f'storage must count disk paths once: {result}')
        check(result['missingFiles'] >= 1 and result['untrackedBytes'] == len(b'untracked-fixture'), 'storage missing/untracked status differs')
        check(sum(c['bytes'] for c in result['categories']) == expected, 'storage category bytes do not sum to total')
        check(result.get('updatedAt'), 'storage freshness timestamp absent')
        added = directory / 'refresh-untracked.bin'
        added.write_bytes(b'refresh-fixture')
        try:
            refreshed = self.owner.post('/api/v2/storage/refresh')
            check(refreshed['totalBytes'] == expected + len(b'refresh-fixture'), 'explicit storage refresh ignores disk changes')
        finally:
            added.unlink()
            self.owner.post('/api/v2/storage/refresh')

    def account_operations(self):
        client = HTTP(self.base)
        name = 'new-fixture-' + uuid.uuid4().hex
        client.post('/api/account/create', {'username': name, 'password': 'new-password', 'creationCode': 'wrong'}, status=400)
        client.post('/api/account/create', {'username': name, 'password': 'new-password', 'creationCode': 'integration-code'}, status=201)
        token = client.post('/api/authentication/login', {'username': name, 'password': 'new-password'})['token']
        account = HTTP(self.base, token)
        account.post('/f', {}, status=404)
        account.post('/api/account/change', {'toChange': 'password', 'currentPassword': 'wrong', 'newPassword': 'changed'}, status=400)
        account.post('/api/account/change', {'toChange': 'password', 'currentPassword': 'new-password', 'newPassword': 'changed'})
        client.post('/api/authentication/login', {'username': name, 'password': 'changed'})
        client.post('/api/v2/auth/register', {'username': name + '-v2', 'password': 'another-password', 'creationCode': 'integration-code'}, status=201)

    def password_logout(self):
        first, second = self.browser_login(HTTP(self.base)), self.browser_login(HTTP(self.base))
        old_session_token = next(c.value for c in second.cookies if c.name == 'rfs_session')
        first.post('/api/v2/account/password', {'currentPassword': 'wrong', 'newPassword': 'replacement-password'}, status=400)
        first.post('/api/v2/account/password', {'currentPassword': self.accounts[0]['password'], 'newPassword': 'replacement-password'})
        first.get('/api/v2/auth/me', status=401)
        second.get('/api/v2/auth/me', status=401)
        HTTP(self.base, old_session_token).get('/api/v2/auth/me', status=401)
        fresh = HTTP(self.base)
        fresh.post('/api/v2/auth/login', {'username': self.accounts[0]['username'], 'password': self.accounts[0]['password']}, status=401)
        logged = fresh.post('/api/v2/auth/login', {'username': self.accounts[0]['username'], 'password': 'replacement-password'})
        fresh.csrf = logged['csrfToken']
        session_token = next(c.value for c in fresh.cookies if c.name == 'rfs_session')
        fresh.post('/api/v2/auth/logout')
        fresh.get('/api/v2/auth/me', status=401)
        HTTP(self.base, session_token).get('/api/v2/auth/me', status=401)


def fixture(action, database, root, *extra):
    result = subprocess.run(['node', str(REPO / 'tests/fixtures/mongo.mjs'), action, database, str(root), *extra],
                            cwd=REPO, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'Fixture {action} failed: {result.stderr.strip()}')
    return json.loads(result.stdout) if result.stdout.strip() else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, help='prebuilt Go backend; otherwise builds ./cmd/fileshare')
    parser.add_argument('--mongo-uri', default=os.environ.get('MONGO_URI', 'mongodb://127.0.0.1:27017'))
    args = parser.parse_args()
    os.environ['MONGO_URI'] = args.mongo_uri
    if not (REPO / 'tests/node_modules/mongodb').is_dir():
        parser.error('Run npm ci --prefix tests before integration tests')
    with tempfile.TemporaryDirectory(prefix='fileshare-integration-') as temporary:
        temp = Path(temporary)
        database = 'rfs_integration_' + uuid.uuid4().hex
        uploads = temp / 'uploads'
        uploads.mkdir(parents=True, exist_ok=True)
        if any(uploads.iterdir()):
            parser.error('fixture upload directory must be empty')
        process = None
        log = None
        seeded = False
        try:
            try:
                fixture('seed', database, uploads)
            except Exception:
                # A failed seed may have committed its ownership marker before
                # a later write failed. Cleanup still verifies that marker.
                try:
                    fixture('drop', database, uploads)
                except Exception:
                    pass
                raise
            seeded = True
            binary = args.binary.resolve() if args.binary else temp / 'fileshare'
            if not args.binary:
                subprocess.run([os.environ.get('GO', 'go'), 'build', '-o', str(binary), './cmd/fileshare'], cwd=REPO / 'v2/Back-End', check=True)
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            parsed = urllib.parse.urlsplit(args.mongo_uri)
            uri = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, '/' + database, parsed.query, parsed.fragment))
            config = temp / 'Config.json'
            config.write_text(json.dumps({
                'DATABASE_URL': uri, 'HTTP_PORT': port, 'HTTPS_PORT': 0,
                'JWT_SECRET_KEY': SECRET, 'JWT_EXPIRATION': '1h', 'BCRYPT_SALT_ROUNDS': 4,
                'ACCOUNT_CREATION_CODE': 'integration-code', 'MAX_UPLOAD_SIZE': LIMIT,
                'DATE_LANGUAGE': 'en-US', 'DATE_TIMEZONE_REGION': 'UTC',
            }))
            www = temp / 'www'
            www.mkdir()
            (www / 'index.html').write_text('<html>integration shell</html>')
            log = (temp / 'server.log').open('w+')
            command = [str(binary), '--config', str(config), '--uploads-dir', str(uploads),
                       '--www-dir', str(www), '--http-port', str(port), '--https-port', '0']
            process = subprocess.Popen(command,
                                       cwd=REPO / 'v2/Back-End', stdout=log, stderr=subprocess.STDOUT)
            base = f'http://127.0.0.1:{port}'
            deadline = time.monotonic() + 20
            while True:
                if process.poll() is not None:
                    raise RuntimeError('Backend exited before becoming ready')
                try:
                    HTTP(base).get('/api/v2/config')
                    break
                except (OSError, AssertionError):
                    if time.monotonic() > deadline:
                        raise RuntimeError('Backend readiness timeout')
                    time.sleep(0.1)
            def restart_backend():
                nonlocal process
                process.kill()
                process.wait(timeout=5)
                process = subprocess.Popen(command, cwd=REPO / 'v2/Back-End', stdout=log, stderr=subprocess.STDOUT)
                deadline = time.monotonic() + 20
                while True:
                    if process.poll() is not None:
                        raise RuntimeError('Backend exited during recovery restart')
                    try:
                        HTTP(base).get('/api/v2/config')
                        return
                    except (OSError, AssertionError):
                        if time.monotonic() > deadline:
                            raise RuntimeError('Backend recovery readiness timeout')
                        time.sleep(0.1)

            def probe_runtime_lock():
                with socket.socket() as sock:
                    sock.bind(('127.0.0.1', 0))
                    other_port = sock.getsockname()[1]
                competing = list(command)
                competing[competing.index('--http-port') + 1] = str(other_port)
                result = subprocess.run(competing, cwd=REPO / 'v2/Back-End', capture_output=True, text=True, timeout=15)
                check(result.returncode != 0 and 'already in use' in result.stderr.lower(),
                      'second process must reject shared uploads root with runtime lock')

            suite = Suite(base, uploads, database, restart_backend if process else None, probe_runtime_lock if process else None)
            for name in ('config', 'legacy_auth', 'sessions', 'legacy_files', 'downloads', 'pagination', 'filters',
                         'rejected_uploads', 'successful_uploads', 'concurrent_duplicates', 'cancellation', 'interrupted_process',
                         'stale_journal_preserves_replacement', 'runtime_lock',
                         'duplicate_reference_delete', 'inline_security', 'disk_failures', 'database_failure',
                         'malformed_collections', 'thumbnails', 'collections', 'storage', 'account_operations', 'password_logout'):
                suite.run(name, getattr(suite, name))
            suite.run('legacy_bson_preservation', lambda: fixture('verify', database, uploads))
            print(f'\n{suite.passed} groups passed, {len(suite.failed)} groups failed, {suite.skipped} skipped; database {database}', flush=True)
            if suite.failed and log:
                log.flush()
                log.seek(0)
                print('\nBackend log tail:\n' + log.read()[-6000:], file=sys.stderr)
            return 1 if suite.failed else 0
        except Exception as exc:
            print(f'Integration setup failed: {exc}', file=sys.stderr)
            if log:
                log.flush()
                log.seek(0)
                print(log.read()[-6000:], file=sys.stderr)
            return 2
        finally:
            if process:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            if log:
                log.close()
            if seeded:
                fixture('drop', database, uploads)


if __name__ == '__main__':
    sys.exit(main())
