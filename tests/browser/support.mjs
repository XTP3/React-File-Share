import assert from 'node:assert/strict';

export const baseURL = process.env.BASE_URL || 'http://127.0.0.1:8080';
export const creationCode = process.env.CREATION_CODE || 'browser-fixture-code';
export const password = 'Browser-fixture-2026!';
export const changedPassword = 'Changed-browser-fixture-2026!';
export const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1QAAAAASUVORK5CYII=', 'base64');

// Four seconds of PCM audio: generated in Node so CI needs no media tooling.
export function audioFixture() {
  const sampleRate = 8000, samples = sampleRate * 4;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) wav.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 440 / sampleRate) * 1000), 44 + index * 2);
  return wav;
}

export async function api(request, path, { method = 'GET', data, csrfToken, multipart, expected = 200 } = {}) {
  const response = await request.fetch(`/api/v2${path}`, {
    method, data, multipart, headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : undefined,
  });
  assert.equal(response.status(), expected, `${method} ${path}: ${await response.text()}`);
  const text = await response.text();
  return text ? (response.headers()['content-type']?.includes('application/json') ? JSON.parse(text) : text) : null;
}

export async function seedFiles(request, csrfToken) {
  const files = [];
  for (let i = 0; i < 30; i++) {
    const name = `browser-document-${String(i).padStart(2, '0')}.txt`;
    const result = await api(request, '/files/upload', {
      method: 'POST', csrfToken,
      multipart: { files: { name, mimeType: 'text/plain', buffer: Buffer.from(`fixture ${i}: ${'x'.repeat(128 + i)}`) } },
    });
    files.push(...result.files);
  }
  for (const [name, mimeType, buffer] of [
    ['browser-photo.png', 'image/png', photo],
    ['browser-manual.pdf', 'application/pdf', Buffer.from('%PDF-1.4\nBrowser fixture\n%%EOF\n')],
    ['browser-archive.zip', 'application/zip', Buffer.from('PK\x05\x06' + '\0'.repeat(18))],
  ]) {
    const result = await api(request, '/files/upload', { method: 'POST', csrfToken, multipart: { files: { name, mimeType, buffer } } });
    files.push(...result.files);
  }
  return files;
}

export async function eventually(check, message, timeout = 8000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeout) {
    try { await check(); return; } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`${message}: ${lastError?.message}`, { cause: lastError });
}

export async function visible(locator) {
  await locator.waitFor({ state: 'visible', timeout: 10000 });
}

export async function noHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, body: document.documentElement.scrollWidth }));
  assert.ok(dimensions.body <= dimensions.viewport + 1, `Horizontal overflow: ${dimensions.body}px in ${dimensions.viewport}px viewport`);
}

export async function waitForList(page, action, predicate = () => true) {
  const response = page.waitForResponse(response => response.url().includes('/api/v2/files?') && response.status() === 200 && predicate(new URL(response.url())), { timeout: 10000 });
  await action();
  return (await response).json();
}
