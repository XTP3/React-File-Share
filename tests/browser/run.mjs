import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { baseURL, creationCode, password, changedPassword, photo, audioFixture, api, seedFiles, eventually, visible, noHorizontalOverflow, waitForList } from './support.mjs';
import { readableEditableInputs, selectionRegression } from './selection.mjs';

const artifacts = path.resolve(process.env.ARTIFACTS_DIR || 'artifacts');
await mkdir(artifacts, { recursive: true });
const report = { httpErrors: [], baseURL, startedAt: new Date().toISOString(), checks: [], screenshots: [], browserErrors: [], deferred: [] };
let chromiumPath = process.env.CHROMIUM_PATH;
if (!chromiumPath) { try { await access('/usr/bin/chromium'); chromiumPath = '/usr/bin/chromium'; } catch { chromiumPath = chromium.executablePath(); } }
const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(10000);
page.on('pageerror', error => report.browserErrors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error' && !/Failed to load resource:.*(401|ERR_INTERNET_DISCONNECTED)/.test(message.text())) report.browserErrors.push(`${message.text()} (${message.location().url})`);
});
page.on('response', response => { if (response.status() >= 400 && response.status() !== 401) report.httpErrors.push({ url: response.url(), status: response.status() }); });
page.on('dialog', async dialog => { report.browserErrors.push(`Unexpected native ${dialog.type()}: ${dialog.message()}`); await dialog.dismiss(); });
const username = `browser-${Date.now()}`;
let session, files, collection;
const requests = [];
page.on('request', request => { if (request.url().includes('/api/v2/files?')) requests.push({ url: new URL(request.url()), at: Date.now() }); });
async function screenshot(name) {
  if (!name.includes('explorer')) await page.evaluate(() => window.scrollTo(0, 0));
  const toast = page.locator('[data-sonner-toast]').last();
  if (await toast.count()) await toast.waitFor({ state: 'hidden', timeout: 6000 }).catch(() => {});
  const dialog = page.getByRole('dialog');
  if (await dialog.count() && await dialog.isVisible()) {
    await dialog.evaluate(async element => {
      const animations = element.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity);
      await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
    });
    if (name.includes('upload')) {
      const visual = await dialog.evaluate(element => {
        const style = getComputedStyle(element);
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const drawing = canvas.getContext('2d'); drawing.fillStyle = style.backgroundColor; drawing.fillRect(0, 0, 1, 1);
        return { opacity: Number(style.opacity), backgroundColor: style.backgroundColor, backgroundAlpha: drawing.getImageData(0, 0, 1, 1).data[3] / 255 };
      });
      assert.equal(visual.opacity, 1, 'Upload dialog opening animation must finish before capture');
      assert.equal(visual.backgroundAlpha, 1, 'Upload dialog background must be fully opaque');
      (report.modalVisuals ||= []).push({ screenshot: name, ...visual });
    }
  }
  const file = `${name}.png`; await page.screenshot({ path: path.join(artifacts, file), fullPage: false }); report.screenshots.push(file);
}
async function check(name, action) {
  const start = Date.now();
  try { await action(); report.checks.push({ name, status: 'passed', durationMs: Date.now() - start }); console.log(`PASS ${name}`); }
  catch (error) { report.checks.push({ name, status: 'failed', error: error.stack, durationMs: Date.now() - start }); await screenshot(`failure-${report.checks.length}`); throw error; }
}
async function login(pass = password, account = username) {
  await page.goto('/login');
  await page.getByLabel('Username', { exact: true }).fill(account);
  await page.getByLabel('Password', { exact: true }).fill(pass);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await visible(page.getByRole('heading', { name: 'Files', exact: true }));
  session = await api(context.request, '/auth/me');
}
async function clearFilters() { const button = page.getByRole('button', { name: 'Clear filters', exact: true }); if (await button.isVisible()) await button.click(); await page.getByLabel('Search files', { exact: true }).fill(''); await page.getByLabel('Search files', { exact: true }).press('Enter'); }
async function centeredAuth(formName) {
  await visible(page.getByRole('form', { name: formName, exact: true }));
  await visible(page.getByRole('img', { name: 'X', exact: true }));
  assert.equal(await page.locator('.auth-card').count(), 1);
  assert.equal(await page.locator('.auth-brand, .auth-intro').count(), 0, 'Auth has a single centered card');
  const card = await page.locator('.auth-card').boundingBox(), viewport = page.viewportSize();
  assert.ok(Math.abs(card.x + card.width / 2 - viewport.width / 2) <= 2, 'Auth card must be horizontally centered');
  assert.ok(Math.abs(card.y + card.height / 2 - viewport.height / 2) <= 2, 'Auth card must be vertically centered');
  await noHorizontalOverflow(page);
}
async function currentHeader(title) {
  assert.equal((await page.locator('.header-breadcrumb').innerText()).trim(), title, 'Header contains only the current page');
}
async function previewControlsFit() {
  const dialog = page.locator('.file-preview-dialog');
  await dialog.evaluate(async element => {
    const animations = element.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity);
    await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
  });
  const bounds = await dialog.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(bounds.x >= -1 && bounds.y >= -1 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1, 'Preview dialog stays inside the viewport');
  for (const control of await dialog.locator('button, a, [role="slider"]').all()) {
    assert.ok(await control.isVisible(), `Preview control is visible: ${await control.getAttribute('aria-label') || await control.innerText()}`);
    const box = await control.boundingBox();
    assert.ok(box.x >= bounds.x - 1 && box.y >= bounds.y - 1 && box.x + box.width <= bounds.x + bounds.width + 1 && box.y + box.height <= bounds.y + bounds.height + 1, 'Preview controls remain inside the dialog');
  }
  await noHorizontalOverflow(page);
}
async function mediaPlayback(tag) {
  const dialog = page.locator('.file-preview-dialog'), media = dialog.locator(tag);
  await eventually(async () => assert.ok(await media.evaluate(element => Number.isFinite(element.duration) && element.duration >= 3.9)), 'Real media metadata loaded');
  assert.equal(await media.getAttribute('controls'), null, 'Media uses custom controls');
  if (tag === 'video') assert.notEqual(await media.getAttribute('playsinline'), null, 'Mobile video can play inline with custom controls');
  await dialog.getByRole('button', { name: 'Play', exact: true }).click();
  await eventually(async () => assert.ok(await media.evaluate(element => !element.paused && element.currentTime > 0)), 'Play starts real playback');
  await dialog.getByRole('button', { name: 'Pause', exact: true }).click();
  assert.ok(await media.evaluate(element => element.paused), 'Pause stops playback');
  const seek = dialog.getByRole('slider', { name: 'Seek', exact: true });
  await seek.focus(); await seek.press('Home'); await seek.press('ArrowRight'); await seek.press('ArrowRight');
  await eventually(async () => assert.ok(await media.evaluate(element => Math.abs(element.currentTime - 2) < 0.2)), 'Keyboard seek changes playback position');
  assert.match(await seek.getAttribute('aria-valuetext'), /0:02 of 0:04/);
  await dialog.getByRole('button', { name: 'Play', exact: true }).click();
  await eventually(async () => assert.ok(Number(await seek.getAttribute('aria-valuenow')) > 2.05), 'Timeline continues advancing after a keyboard seek');
  await dialog.getByRole('button', { name: 'Pause', exact: true }).click();
  await seek.press('Home');
  const seekTrack = dialog.locator('.preview-seek [data-slot="slider"]');
  const seekBox = await seekTrack.boundingBox();
  await seekTrack.click({ position: { x: seekBox.width / 2, y: seekBox.height / 2 } });
  await eventually(async () => assert.ok(await media.evaluate(element => Math.abs(element.currentTime - 2) < 0.2)), 'Pointer seek changes playback position');
  await dialog.getByRole('button', { name: 'Play', exact: true }).click();
  await eventually(async () => assert.ok(Number(await seek.getAttribute('aria-valuenow')) > 2.05), 'Timeline resumes after pointer scrubbing finishes');
  await dialog.getByRole('button', { name: 'Pause', exact: true }).click();
  await dialog.getByRole('button', { name: 'Mute', exact: true }).click();
  assert.ok(await media.evaluate(element => element.muted));
  await dialog.getByRole('button', { name: 'Unmute', exact: true }).click();
  assert.ok(await media.evaluate(element => !element.muted));
  const volume = dialog.getByRole('slider', { name: 'Volume', exact: true });
  await eventually(async () => assert.equal(Number(await volume.getAttribute('aria-valuenow')), 1), 'Unmute restores the volume slider before keyboard input');
  await volume.focus(); await volume.press('ArrowLeft');
  await eventually(async () => assert.ok(await media.evaluate(element => element.volume < 1 && element.volume > 0)), 'Volume slider changes real media volume');
  await dialog.getByRole('button', { name: 'Playback speed: 1×. Change playback speed', exact: true }).click();
  assert.equal(await media.evaluate(element => element.playbackRate), 1.25);
  await previewControlsFit();
}
async function previewFullscreen() {
  await page.locator('.file-preview-dialog').getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
  await eventually(async () => assert.ok(await page.evaluate(() => document.fullscreenElement?.classList.contains('file-preview-dialog')) || await page.locator('.file-preview-dialog').getAttribute('data-expanded') === 'true'), 'Fullscreen keeps the dialog and its controls together');
  await previewControlsFit();
  const native = await page.evaluate(() => !!document.fullscreenElement);
  (report.fullscreen ||= []).push({ viewport: page.viewportSize(), native });
  if (native) await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  else await page.getByRole('button', { name: 'Restore preview size', exact: true }).click();
}

try {
  await check('Register, login, first-use dark theme, and keyboard focus', async () => {
    await page.goto('/CreateAccount');
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains('dark')), 'Dark theme must be applied on first use');
    await visible(page.getByLabel('Username', { exact: true }));
    await centeredAuth('Create Account');
    await screenshot('desktop-register-dark');
    await page.setViewportSize({ width: 390, height: 844 });
    await centeredAuth('Create Account');
    await noHorizontalOverflow(page);
    await readableEditableInputs(page, 'Mobile account creation');
    await screenshot('mobile-register-dark');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByLabel('Username', { exact: true }).fill(username);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password', { exact: true }).fill(password);
    await page.getByLabel('Account creation code', { exact: true }).fill(creationCode);
    await page.getByRole('button', { name: 'Create Account', exact: true }).click();
    await visible(page.getByRole('form', { name: 'Login', exact: true }));
    assert.equal(await page.getByRole('button', { name: 'Create Account', exact: true }).count(), 0, 'Login has no signup section');
    assert.equal(await page.getByRole('link', { name: /create account|sign up/i }).count(), 0);
    await centeredAuth('Login');
    await screenshot('desktop-login-dark');
    await page.setViewportSize({ width: 390, height: 844 });
    await centeredAuth('Login');
    await readableEditableInputs(page, 'Mobile login');
    await screenshot('mobile-login-dark');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await login();
    await currentHeader('Files');
    assert.equal(await page.getByRole('button', { name: /^Uncollected/ }).count(), 0, 'Uncollected is not a sidebar destination');
    assert.equal(await page.getByRole('button', { name: 'New collection', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Create collection', exact: true }).count(), 1, 'One plus button creates collections');
    assert.equal(await page.locator('.page-heading p').count(), 0, 'Files heading has no subtitle');
    await visible(page.getByRole('heading', { name: 'All Files', exact: true, level: 2 }));
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => document.activeElement !== document.body), 'Keyboard focus must reach a control');
    await noHorizontalOverflow(page);
    await screenshot('desktop-empty-dark');
  });

  await check('Real fixture upload, global storage totals, and paginated explorer', async () => {
    files = await seedFiles(context.request, session.csrfToken);
    assert.equal(files.length, 33);
    await page.reload();
    await visible(page.getByRole('heading', { name: 'Files', exact: true }));
    await eventually(async () => assert.equal((await api(context.request, '/storage')).totalFiles, 33), 'Storage file count');
    await visible(page.getByRole('region', { name: 'Storage overview', exact: true }).getByText('33', { exact: true }));
    const storage = await api(context.request, '/storage');
    assert.equal(storage.totalBytes, files.reduce((sum, file) => sum + file.fileSize, 0));
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    await visible(page.getByRole('heading', { name: 'Storage by type', exact: true }));
    await visible(page.getByText('31 files', { exact: true }));
    await visible(page.getByText('68 B', { exact: true }).last());
    await page.keyboard.press('Escape');
    const pageTwo = await waitForList(page, () => page.getByRole('button', { name: 'Next page', exact: true }).click(), url => url.searchParams.get('page') === '2');
    assert.equal(pageTwo.page, 2); assert.equal(pageTwo.items.length, 8);
    await page.getByRole('button', { name: 'Previous page', exact: true }).click();
    await screenshot('desktop-files-dark');
  });

  await check('Debounced search cancels intermediate terms and resets pagination', async () => {
    const search = page.getByLabel('Search files', { exact: true });
    const before = requests.length;
    const started = Date.now();
    const matching = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === '/api/v2/files' && url.searchParams.get('q') === 'browser-photo'; });
    await search.pressSequentially('browser-photo', { delay: 10 });
    await matching;
    const searchRequests = requests.slice(before).filter(request => request.url.searchParams.get('q'));
    assert.equal(searchRequests.length, 1, `Expected one debounced request, received ${searchRequests.length}`);
    assert.ok(searchRequests[0].at - started >= 250, 'Search should wait approximately 300ms');
    assert.equal(searchRequests[0].url.searchParams.get('page'), '1');
    await visible(page.getByText('browser-photo.png', { exact: true }).first());
    assert.equal((await api(context.request, '/files?q=browser-photo')).total, 1);
    const network = await context.newCDPSession(page);
    await network.send('Network.enable');
    await network.send('Network.emulateNetworkConditions', { offline: false, latency: 750, downloadThroughput: 1024 * 1024, uploadThroughput: 1024 * 1024 });
    try {
      const first = page.waitForRequest(request => new URL(request.url()).searchParams.get('q') === 'browser-document');
      await search.fill('browser-document'); await search.press('Enter'); await first;
      const cancelled = page.waitForEvent('requestfailed', { predicate: request => new URL(request.url()).searchParams.get('q') === 'browser-document' });
      const second = page.waitForResponse(response => new URL(response.url()).searchParams.get('q') === 'browser-manual' && response.status() === 200);
      await search.fill('browser-manual'); await search.press('Enter');
      assert.ok((await cancelled).failure()?.errorText.includes('ABORTED'), 'Superseded request must be aborted');
      assert.equal((await (await second).json()).total, 1);
      await visible(page.getByText('browser-manual.pdf', { exact: true }).first());
    } finally {
      await network.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await network.detach();
    }
    await search.fill(''); await search.press('Enter');
  });

  await check('Filters compose, preferences survive reload, and themes persist', async () => {
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByRole('checkbox', { name: 'Photos', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Archives', exact: true }).check();
    await page.getByLabel('Maximum size (MB)', { exact: true }).fill('0.0001');
    await page.keyboard.press('Escape');
    await eventually(async () => {
      const last = requests.at(-1)?.url;
      assert.ok(last?.searchParams.get('category')?.includes('photo')); assert.ok(last.searchParams.get('category').includes('archive'));
      assert.ok(Number.isInteger(Number(last.searchParams.get('maxSize'))));
      assert.ok(Number(last.searchParams.get('maxSize')) >= 100 && Number(last.searchParams.get('maxSize')) <= 105);
    }, 'Composed category and size filter request');
    await page.reload();
    await page.getByRole('button', { name: /^Filters/ }).click();
    assert.ok(await page.getByRole('checkbox', { name: 'Photos', exact: true }).isChecked());
    assert.equal(await page.getByLabel('Maximum size (MB)', { exact: true }).inputValue(), '0.0001');
    await page.keyboard.press('Escape');
    const filtered = await api(context.request, '/files?' + requests.at(-1).url.searchParams.toString());
    assert.equal(filtered.total, 2);
    await visible(page.getByRole('region', { name: 'Storage overview', exact: true }).getByText('33', { exact: true }));
    assert.ok(filtered.items.every(file => ['photo', 'archive'].includes(file.category) && file.fileSize <= 105));
    await clearFilters();
    await page.getByRole('combobox', { name: 'Sort files', exact: true }).click();
    await page.getByRole('option', { name: 'Name A–Z', exact: true }).click();
    await page.getByRole('combobox', { name: 'Files per page', exact: true }).click();
    await page.getByRole('option', { name: '50', exact: true }).click();
    await page.getByRole('button', { name: 'Grid view', exact: true }).click();
    await page.reload();
    assert.equal(await page.getByRole('button', { name: 'Grid view', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.ok((await page.getByRole('combobox', { name: 'Sort files', exact: true }).textContent()).includes('Name A–Z'));
    assert.equal(await page.getByRole('combobox', { name: 'Files per page', exact: true }).textContent(), '50');
    await page.getByRole('button', { name: 'List view', exact: true }).click();
    await page.getByRole('button', { name: 'Change theme', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Light', exact: true }).click();
    assert.ok(!(await page.evaluate(() => document.documentElement.classList.contains('dark'))));
    await page.reload();
    assert.ok(!(await page.evaluate(() => document.documentElement.classList.contains('dark'))));
    await screenshot('desktop-files-light');
    await page.getByRole('button', { name: 'Change theme', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Dark', exact: true }).click();
  });

  await check('Cross-page selection, library picker membership, and mobile input sizing', async () => {
    await selectionRegression({ page, context, session, screenshot });
  });

  await check('Create collection, bulk assignment, independent preferences, and nondestructive removal', async () => {
    await page.getByRole('button', { name: 'Create collection', exact: true }).click();
    await page.getByLabel('Collection name', { exact: true }).fill('Browser collection');
    await page.getByRole('button', { name: 'Create collection', exact: true }).click();
    await eventually(async () => { collection = (await api(context.request, '/collections')).items.find(item => item.title === 'Browser collection'); assert.ok(collection); }, 'Created collection');
    await page.getByRole('checkbox', { name: `Select ${files.at(-1).fileName}`, exact: true }).check();
    await page.getByRole('checkbox', { name: `Select ${files.at(-2).fileName}`, exact: true }).check();
    await page.getByRole('button', { name: 'Add to collection', exact: true }).click();
    await page.getByRole('combobox', { name: 'Select collection', exact: true }).click();
    await page.getByRole('option', { name: 'Browser collection', exact: true }).click();
    await page.getByRole('button', { name: 'Add files', exact: true }).click();
    await eventually(async () => assert.equal((await api(context.request, `/files?collectionId=${collection.id}`)).total, 2), 'Bulk membership');
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByRole('checkbox', { name: 'Uncollected', exact: true }).check();
    await page.keyboard.press('Escape');
    await eventually(async () => assert.equal(requests.at(-1).url.searchParams.get('collectionId'), 'uncollected'), 'Uncollected filter uses API sentinel');
    assert.equal((await api(context.request, '/files?collectionId=uncollected')).total, 31, 'Uncollected excludes assigned files');
    await page.reload();
    await page.getByRole('button', { name: /^Filters/ }).click();
    assert.ok(await page.getByRole('checkbox', { name: 'Uncollected', exact: true }).isChecked(), 'Uncollected preference survives reload');
    await page.keyboard.press('Escape');
    await currentHeader('Files');
    await page.getByRole('button', { name: /^Browser collection/ }).click();
    await currentHeader('Browser collection');
    await page.getByRole('button', { name: /^Filters/ }).click();
    assert.equal(await page.getByRole('checkbox', { name: 'Uncollected', exact: true }).count(), 0, 'Uncollected filter exists only in main Files');
    await page.keyboard.press('Escape');
    await page.getByLabel('Search files', { exact: true }).fill('browser-archive');
    await page.waitForTimeout(450);
    await page.reload();
    assert.equal(await page.getByLabel('Search files', { exact: true }).inputValue(), 'browser-archive');
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await page.getByLabel('Collection name', { exact: true }).fill('Browser renamed');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await eventually(async () => assert.equal((await api(context.request, '/collections')).items[0].title, 'Browser renamed'), 'Rename preserves stable collection');
    assert.equal((await api(context.request, '/collections')).items[0].id, collection.id);
    assert.equal(await page.getByLabel('Search files', { exact: true }).inputValue(), 'browser-archive');
    await page.getByRole('button', { name: /^All Files/ }).click();
    assert.equal(await page.getByLabel('Search files', { exact: true }).inputValue(), '');
    await page.getByRole('button', { name: /^Filters/ }).click();
    assert.ok(await page.getByRole('checkbox', { name: 'Uncollected', exact: true }).isChecked(), 'Main Files preference is independent of collection preferences');
    await page.getByRole('checkbox', { name: 'Uncollected', exact: true }).uncheck();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Browser renamed/ }).click();
    await page.getByLabel('Search files', { exact: true }).fill('');
    await page.getByRole('checkbox', { name: `Select ${files.at(-1).fileName}`, exact: true }).check();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await page.getByRole('button', { name: 'Remove membership', exact: true }).click();
    await eventually(async () => assert.equal((await api(context.request, `/files?collectionId=${collection.id}`)).total, 1), 'Nondestructive member removal');
    await page.getByRole('button', { name: 'Manage Browser renamed', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Delete collection', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await eventually(async () => assert.equal((await api(context.request, '/collections')).items.length, 0), 'Deleted collection');
    assert.equal((await api(context.request, '/files')).total, 33, 'Deleting a collection must preserve files');
    // API completion can precede the deletion handler replacing the Explorer.
    // Wait for its UI transition before the next group edits the search input.
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.waitForURL(url => url.pathname === '/files');
    await visible(page.getByRole('heading', { name: 'All Files', exact: true, level: 2 }));
    await currentHeader('Files');
    assert.equal(await page.getByLabel('Search files', { exact: true }).inputValue(), '');
  });

  await check('Static thumbnails defer original images and media previews work on desktop and mobile', async () => {
    const originalImage = await readFile(new URL('./fixtures/preview.png', import.meta.url));
    const mediaFiles = [];
    const originalRequests = [];
    const observeOriginal = request => { if (new URL(request.url()).pathname.startsWith('/f/v/')) originalRequests.push(request.url()); };
    page.on('request', observeOriginal);
    try {
      for (const [name, mimeType, buffer] of [
        ['preview-fixture-image.png', 'image/png', originalImage],
        ['preview-fixture-video.webm', 'video/webm', await readFile(new URL('./fixtures/preview.webm', import.meta.url))],
        ['preview-fixture-audio.wav', 'audio/wav', audioFixture()],
      ]) {
        const result = await api(context.request, '/files/upload', { method: 'POST', csrfToken: session.csrfToken, multipart: { files: { name, mimeType, buffer } } });
        mediaFiles.push(...result.files);
      }
      await waitForList(page, async () => { await page.getByLabel('Search files', { exact: true }).fill('preview-fixture'); await page.getByLabel('Search files', { exact: true }).press('Enter'); }, url => url.searchParams.get('q') === 'preview-fixture');
      const imageFile = mediaFiles.find(file => file.category === 'photo');
      assert.ok(imageFile);
      const thumbnailPath = `/api/v2/files/${imageFile.uniqueID}/thumbnail`;
      const thumbnail = page.locator(`[aria-label="File explorer"] img[src="${thumbnailPath}"]`);
      await thumbnail.scrollIntoViewIfNeeded();
      await eventually(async () => assert.ok(await thumbnail.evaluate(image => image.complete && image.naturalWidth > 0)), 'Server thumbnail decoded');
      const dimensions = await thumbnail.evaluate(image => ({ width: image.naturalWidth, height: image.naturalHeight }));
      assert.deepEqual(dimensions, { width: 384, height: 288 }, 'Thumbnail preserves aspect ratio within the 384px bound');
      const thumbnailBox = await thumbnail.boundingBox();
      assert.ok(thumbnailBox.width <= 64 && thumbnailBox.height <= 64, 'List displays a small thumbnail');
      const thumbnailResponse = await context.request.get(thumbnailPath);
      assert.equal(thumbnailResponse.status(), 200);
      assert.match(thumbnailResponse.headers()['content-type'], /^image\/png/);
      assert.match(thumbnailResponse.headers()['cache-control'], /private/);
      assert.match(thumbnailResponse.headers()['cache-control'], /no-store/);
      const thumbnailBytes = (await thumbnailResponse.body()).length;
      assert.ok(thumbnailBytes < originalImage.length, 'Thumbnail transfers fewer bytes than the original');
      report.thumbnail = { path: thumbnailPath, ...dimensions, bytes: thumbnailBytes, originalBytes: originalImage.length };
      assert.deepEqual(originalRequests, [], 'Browsing the image list never requests original image bytes');
      assert.equal(await page.locator('.mobile-file-list').count(), 0);
      assert.equal(await page.getByRole('checkbox', { name: `Select ${imageFile.fileName}`, exact: true }).count(), 1);
      await page.setViewportSize({ width: 390, height: 844 });
      await eventually(async () => assert.equal(await page.locator('[aria-label="File explorer"] table').count(), 0), 'Mobile list mounts without a desktop table');
      assert.equal(await thumbnail.count(), 1, 'Mobile image mounts exactly one static thumbnail');
      await thumbnail.scrollIntoViewIfNeeded();
      await eventually(async () => assert.ok(await thumbnail.evaluate(image => image.complete && image.naturalWidth === 384)), 'Mobile static thumbnail decoded');
      assert.deepEqual(originalRequests, [], 'Mobile image browsing also defers originals until preview');
      await page.setViewportSize({ width: 1440, height: 1000 });
      await eventually(async () => assert.equal(await page.locator('.mobile-file-list').count(), 0), 'Desktop list mounts without mobile cards');
      await page.getByRole('button', { name: imageFile.fileName, exact: true }).click();
      const previewImage = page.locator('.file-preview-dialog img');
      await eventually(async () => assert.equal(await previewImage.evaluate(image => image.naturalWidth), 1024), 'Preview loads the original image');
      assert.ok(originalRequests.some(url => new URL(url).pathname === `/f/v/${imageFile.uniqueID}`));
      const openOriginal = page.getByRole('link', { name: 'Open original file in a new tab', exact: true });
      assert.equal(new URL(await openOriginal.getAttribute('href')).pathname, `/f/v/${imageFile.uniqueID}`);
      assert.equal(await openOriginal.getAttribute('target'), '_blank');
      assert.match(await openOriginal.getAttribute('rel'), /noopener/);
      const popupEvent = page.waitForEvent('popup'); await openOriginal.click();
      const popup = await popupEvent; await popup.waitForLoadState();
      assert.equal(new URL(popup.url()).pathname, `/f/v/${imageFile.uniqueID}`);
      await eventually(async () => assert.equal(await popup.locator('img').evaluate(image => image.naturalWidth), 1024), 'Original image URL loads in the native browser image viewer');
      await popup.close();
      await previewControlsFit();
      await screenshot('desktop-image-preview');
      await page.getByRole('button', { name: 'Maximize preview', exact: true }).click();
      await eventually(async () => {
        const maximized = await page.locator('.file-preview-dialog').boundingBox();
        assert.ok(Math.abs(maximized.x) <= 1 && Math.abs(maximized.y) <= 1 && maximized.width >= page.viewportSize().width - 2 && maximized.height >= page.viewportSize().height - 2, `Maximized preview fills the viewport: ${JSON.stringify(maximized)}`);
      }, 'Maximized geometry');
      await page.getByRole('button', { name: 'Restore preview size', exact: true }).click();
      await previewFullscreen();
      await page.getByRole('button', { name: 'Close preview', exact: true }).click();
      for (const [width, height] of [[1440, 1000], [390, 844], [844, 390]]) {
        await page.setViewportSize({ width, height });
        for (const file of mediaFiles) {
          await page.locator('.file-name-button').filter({ hasText: file.fileName }).click();
          await previewControlsFit();
          if (width === 390) {
            const box = await page.locator('.file-preview-dialog').boundingBox();
            assert.ok(box.x <= 1 && box.y <= 1 && box.width >= width - 2 && box.height >= height - 2, 'Mobile preview fills the entire viewport');
          }
          if (file.category === 'video' || file.category === 'audio') {
            await mediaPlayback(file.category === 'video' ? 'video' : 'audio');
            await previewFullscreen();
            if (width === 1440) {
              const nativeViewEvent = page.waitForEvent('popup');
              await page.getByRole('link', { name: 'Open original file in a new tab', exact: true }).click();
              const nativeView = await nativeViewEvent;
              const nativeConsole = [], nativeFailures = [], nativeResponses = [];
              nativeView.on('console', message => nativeConsole.push(message.text()));
              nativeView.on('requestfailed', request => nativeFailures.push({ url: request.url(), error: request.failure()?.errorText }));
              nativeView.on('response', response => nativeResponses.push({ url: response.url(), status: response.status(), range: response.request().headers().range }));
              try {
                await nativeView.waitForLoadState();
                assert.equal(new URL(nativeView.url()).pathname, `/f/v/${file.uniqueID}`);
                await eventually(async () => assert.ok(await nativeView.locator('video, audio').evaluate(media => media.error === null && Number.isFinite(media.duration) && media.duration >= 3.9)), 'Original media URL loads in the native browser player');
              } finally {
                (report.nativeOriginal ||= []).push({ file: file.fileName, url: nativeView.url(), console: nativeConsole, failedRequests: nativeFailures, responses: nativeResponses,
                  media: await nativeView.locator('video, audio').evaluate(media => ({ error: media.error && { code: media.error.code, message: media.error.message }, currentSrc: media.currentSrc, networkState: media.networkState, readyState: media.readyState, duration: Number.isFinite(media.duration) ? media.duration : String(media.duration) })).catch(error => ({ error: error.message })),
                  headers: (await context.request.get(`/f/v/${file.uniqueID}`)).headers(),
                });
                await nativeView.close();
              }
            }
          }
          const screen = width === 1440 ? 'desktop' : width === 390 ? 'mobile' : 'mobile-landscape';
          await screenshot(`${screen}-${file.category}-preview`);
          await page.getByRole('button', { name: 'Close preview', exact: true }).click();
          assert.equal(await page.locator('.file-preview-dialog video, .file-preview-dialog audio').count(), 0, 'Closing releases the media element');
        }
      }
    } catch (error) {
      if (await page.locator('.file-preview-dialog').count()) {
        report.failedPreviewGeometry = await page.locator('.file-preview-dialog').evaluate(element => {
          const css = getComputedStyle(element), bounds = element.getBoundingClientRect();
          return { bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, position: css.position, top: css.top, left: css.left, translate: css.translate, transform: css.transform, animation: css.animationName, twTranslateX: css.getPropertyValue('--tw-translate-x'), twTranslateY: css.getPropertyValue('--tw-translate-y') };
        });
      }
      await screenshot('failure-media-preview');
      throw error;
    } finally {
      page.off('request', observeOriginal);
      await page.evaluate(async () => { if (document.fullscreenElement) await document.exitFullscreen(); });
      if (await page.locator('.file-preview-dialog').count()) await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 1440, height: 1000 });
      for (const file of mediaFiles) await api(context.request, `/files/${file.uniqueID}`, { method: 'DELETE', csrfToken: session.csrfToken });
      await clearFilters();
      await page.reload();
    }
    assert.equal((await api(context.request, '/files')).total, 33, 'Media fixtures are removed before count-sensitive checks');
  });

  await check('Local upload preview supports remove/add before real transfer', async () => {
    await page.getByRole('button', { name: 'Upload', exact: true }).first().click();
    await page.locator('input[type=file]').setInputFiles([
      { name: 'queue-photo.png', mimeType: 'image/png', buffer: photo },
      { name: 'queue-remove.txt', mimeType: 'text/plain', buffer: Buffer.from('Remove this before upload') },
    ]);
    await visible(page.getByText('queue-photo.png', { exact: true }));
    assert.equal((await api(context.request, '/files')).total, 33, 'Selection must never transfer bytes');
    assert.equal(await page.locator('[aria-label="Upload selection"] img').count(), 1, 'Selected image thumbnail');
    await eventually(async () => assert.ok(await page.locator('[aria-label="Upload selection"] img').evaluate(image => image.complete && image.naturalWidth > 0)), 'Thumbnail decoded');
    await page.getByRole('button', { name: 'Remove queue-remove.txt', exact: true }).click();
    await page.locator('input[type=file]').setInputFiles({ name: 'queue-added.txt', mimeType: 'text/plain', buffer: Buffer.from('Added after removing one selection') });
    await visible(page.getByText('queue-photo.png', { exact: true }));
    await visible(page.getByText('queue-added.txt', { exact: true }));
    await screenshot('desktop-upload-preview');
    await page.locator('input[type=file]').setInputFiles({ name: 'queue-photo.png', mimeType: 'image/png', buffer: photo });
    await visible(page.getByText('Some filenames repeat. Remove duplicates before uploading.', { exact: true }));
    assert.ok(await page.getByRole('button', { name: 'Upload 3 files', exact: true }).isDisabled());
    await page.getByRole('button', { name: 'Remove queue-photo.png', exact: true }).last().click();
    await eventually(async () => assert.ok(await page.getByRole('button', { name: 'Upload 2 files', exact: true }).isEnabled()), 'Removing duplicate restores upload');
    assert.equal((await api(context.request, '/files')).total, 33);
    await page.getByRole('button', { name: 'Upload 2 files', exact: true }).click();
    await eventually(async () => assert.equal((await api(context.request, '/files')).total, 35), 'Real transfer');
    assert.equal((await api(context.request, '/files?q=queue-remove')).total, 0);
  });

  await check('Public downloads and mobile navigation have no horizontal overflow', async () => {
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: /^All Files/ }).click();
    await page.getByLabel('Search files', { exact: true }).fill('queue-added');
    await visible(page.getByText('queue-added.txt', { exact: true }).first());
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Actions for queue-added.txt', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Copy view link', exact: true }).click();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(new URL(link).pathname.split('/').slice(0, 3).join('/'), '/f/v');
    const publicView = await browser.newContext();
    assert.equal((await publicView.request.get(link)).status(), 200);
    await publicView.close();
    await page.getByRole('button', { name: 'Actions for queue-added.txt', exact: true }).click();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Download', exact: true }).click();
    const download = await downloadEvent;
    assert.equal(download.suggestedFilename(), 'queue-added.txt');
    assert.equal(await download.failure(), null);
    await download.saveAs(path.join(artifacts, 'downloaded-queue-added.txt'));
    assert.equal(await readFile(path.join(artifacts, 'downloaded-queue-added.txt'), 'utf8'), 'Added after removing one selection');
    await page.setViewportSize({ width: 390, height: 844 });
    await clearFilters();
    await noHorizontalOverflow(page);
    const uploadBox = await page.getByRole('button', { name: 'Upload', exact: true }).boundingBox();
    const headingBox = await page.locator('.page-heading').boundingBox();
    assert.ok(Math.abs(uploadBox.width - headingBox.width) <= 2, 'Upload spans the mobile content width');
    await eventually(async () => assert.equal(await page.locator('[aria-label="File explorer"] table').count(), 0), 'Mobile list does not mount a second desktop table');
    assert.equal(await page.getByRole('checkbox', { name: 'Select browser-archive.zip', exact: true }).count(), 1);
    await screenshot('mobile-files-dark');
    await page.evaluate(() => document.querySelector('[aria-label="File explorer"]').scrollIntoView({ block: 'start' }));
    await screenshot('mobile-explorer-dark');
    const typography = await page.locator('.mobile-file-list').evaluate(element => ({
      filenamePx: parseFloat(getComputedStyle(element.querySelector('.file-name')).fontSize),
      metadataPx: parseFloat(getComputedStyle(element.querySelector('.mobile-file-meta')).fontSize),
    }));
    assert.ok(typography.filenamePx >= 14 && typography.metadataPx >= 12, 'Mobile filenames and metadata must remain readable');
    const actionSize = await page.getByRole('button', { name: 'Actions for browser-archive.zip', exact: true }).boundingBox();
    report.mobileTypography = { ...typography, fileActionWidth: actionSize.width, fileActionHeight: actionSize.height };
    assert.ok(actionSize.width >= 44 && actionSize.height >= 44, `Mobile file actions need 44px touch targets; measured ${actionSize.width}x${actionSize.height}`);
    await page.getByRole('button', { name: /^Filters/ }).click();
    await visible(page.getByRole('dialog', { name: 'Filter files', exact: true }));
    const filterBox = await page.locator('.filter-sheet').boundingBox();
    assert.ok(filterBox.y <= 1 && filterBox.height >= page.viewportSize().height - 2, 'Mobile filter sheet fills the viewport height');
    const sheetScroll = await page.locator('.filter-sheet').evaluate(element => ({ height: element.clientHeight, content: element.scrollHeight }));
    assert.ok(sheetScroll.content <= sheetScroll.height + 1, 'Filter content scrolls within the full height sheet');
    await screenshot('mobile-filter-dark');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Upload', exact: true }).first().click();
    await noHorizontalOverflow(page);
    await screenshot('mobile-upload-dark');
    const closeSize = await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).boundingBox();
    report.mobileTypography.dialogCloseWidth = closeSize.width; report.mobileTypography.dialogCloseHeight = closeSize.height;
    assert.ok(closeSize.width >= 44 && closeSize.height >= 44, `Mobile dialog close needs a 44px touch target; measured ${closeSize.width}x${closeSize.height}`);
    const removeSize = await page.getByRole('button', { name: 'Remove queue-photo.png', exact: true }).boundingBox();
    report.mobileTypography.queueRemoveWidth = removeSize.width; report.mobileTypography.queueRemoveHeight = removeSize.height;
    assert.ok(removeSize.width >= 44 && removeSize.height >= 44, `Mobile queue remove needs a 44px touch target; measured ${removeSize.width}x${removeSize.height}`);
    report.mobileTypography.dialogCloseWidth = closeSize.width; report.mobileTypography.dialogCloseHeight = closeSize.height;
    report.mobileTypography.queueRemoveWidth = removeSize.width; report.mobileTypography.queueRemoveHeight = removeSize.height;
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await eventually(async () => assert.equal(await page.locator('.mobile-file-list').count(), 0), 'Desktop list does not mount mobile cards');
  });

  await check('Installable PWA shell works offline and account APIs are not cached', async () => {
    await page.goto('/');
    await page.evaluate(async () => { await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker readiness timeout')), 15000))]); });
    if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload();
    assert.ok(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), 'Registered worker must control application');
    const manifestLink = await page.locator('link[rel=manifest]').getAttribute('href');
    assert.ok(manifestLink);
    const manifestResponse = await context.request.get(manifestLink);
    assert.equal(manifestResponse.status(), 200);
    const manifest = await manifestResponse.json();
    assert.ok(manifest.name && manifest.start_url && manifest.display && manifest.icons?.length >= 2);
    const cachedRequests = await page.evaluate(async () => {
      const requests = [];
      for (const key of await caches.keys()) for (const request of await (await caches.open(key)).keys()) requests.push(new URL(request.url).pathname);
      return requests;
    });
    assert.ok(cachedRequests.length > 0, 'Worker must cache an application shell');
    assert.ok(cachedRequests.every(url => !url.startsWith('/api/') && !url.startsWith('/f/')), `Private/download cache entries: ${cachedRequests.join(', ')}`);
    await context.setOffline(true);
    await page.reload();
    await visible(page.getByText(/offline/i).first());
    const status = await page.evaluate(async () => { try { const response = await fetch('/api/v2/files'); return response.status; } catch { return 'unavailable'; } });
    assert.notEqual(status, 200, 'Private API data must not be available from cache');
    await screenshot('offline-shell');
    await context.setOffline(false);
    await page.reload();
  });

  if (process.env.TEST_WWW_DIR) await check('Real service-worker update waits for active uploads', async () => {
    await page.getByRole('button', { name: 'Upload', exact: true }).first().click();
    await page.locator('input[type=file]').setInputFiles({ name: 'update-probe.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(512 * 1024, 7) });
    const network = await context.newCDPSession(page);
    await network.send('Network.enable');
    await network.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: 1024 * 1024, uploadThroughput: 1024 });
    try {
      await page.getByRole('button', { name: 'Upload 1 files', exact: true }).click();
      await visible(page.getByRole('button', { name: 'Cancel update-probe.bin', exact: true }));
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
      const worker = path.join(process.env.TEST_WWW_DIR, 'sw.js');
      const original = await readFile(worker, 'utf8');
      await writeFile(worker, original + '\n// Browser lifecycle fixture build ' + Date.now() + '\n');
      await page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration.update(); });
      const update = page.getByRole('button', { name: 'Update app', exact: true });
      await visible(update);
      assert.ok(await update.isDisabled(), 'Update reload must be disabled during uploads');
      await screenshot('pwa-update-deferred');
      await page.getByRole('button', { name: 'Upload', exact: true }).first().click();
      await page.getByRole('button', { name: 'Cancel update-probe.bin', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
      await eventually(async () => assert.ok(await update.isEnabled()), 'Update enabled after upload cancellation');
      await network.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await update.click();
      await visible(page.getByRole('heading', { name: 'Files', exact: true }));
      assert.equal((await api(context.request, '/files?q=update-probe')).total, 0, 'Cancelled upload leaves no record');
    } finally { await network.detach(); }
  });
  else report.deferred.push('Run test:isolated to exercise a second worker build during uploads.');

  await check('File deletion confirms in app and reconciles storage', async () => {
    await page.getByLabel('Search files', { exact: true }).fill('queue-added');
    await visible(page.getByText('queue-added.txt', { exact: true }).first());
    await page.getByRole('button', { name: 'Actions for queue-added.txt', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Delete file', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await eventually(async () => assert.equal((await api(context.request, '/files')).total, 34), 'Deleted file removed');
    await eventually(async () => assert.equal((await api(context.request, '/storage')).totalFiles, 34), 'Storage count after deletion');
    await clearFilters();
  });

  await check('Password change logs out and fresh login/logout remain usable', async () => {
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Change password', exact: true }).click();
    await page.getByLabel('Current password', { exact: true }).fill(password);
    await page.getByLabel('New password', { exact: true }).fill(changedPassword);
    await page.getByLabel('Confirm new password', { exact: true }).fill(changedPassword);
    await page.getByRole('button', { name: 'Change password', exact: true }).click();
    await visible(page.getByRole('button', { name: 'Login', exact: true }));
    assert.equal((await context.request.get('/api/v2/auth/me')).status(), 401);
    await login(changedPassword);
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await visible(page.getByRole('button', { name: 'Login', exact: true }));
    assert.equal((await context.request.get('/api/v2/auth/me')).status(), 401);

  });
  await check('Authenticated preferences stay isolated between accounts', async () => {
    const secondary = `${username}-other`;
    await api(context.request, '/auth/register', { method: 'POST', data: { username: secondary, password, creationCode }, expected: 201 });
    await login(password, secondary);
    assert.equal(await page.getByRole('combobox', { name: 'Files per page', exact: true }).textContent(), '25');
    assert.ok((await page.getByRole('combobox', { name: 'Sort files', exact: true }).textContent()).includes('Newest first'));
    assert.equal(await page.getByLabel('Search files', { exact: true }).inputValue(), '');
    assert.equal((await api(context.request, '/files')).total, 0);
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await visible(page.getByRole('button', { name: 'Login', exact: true }));
    await login(changedPassword);
    assert.equal(await page.getByRole('combobox', { name: 'Files per page', exact: true }).textContent(), '50');
    assert.ok((await page.getByRole('combobox', { name: 'Sort files', exact: true }).textContent()).includes('Name A–Z'));
    const preferences = await page.evaluate(() => Object.values(localStorage).join('\n'));
    assert.ok(!preferences.includes(password) && !preferences.includes(changedPassword) && !preferences.includes(session.csrfToken), 'Credentials must never be persisted as preferences');
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await visible(page.getByRole('button', { name: 'Login', exact: true }));
    assert.deepEqual(report.browserErrors, [], `Browser exceptions/errors: ${report.browserErrors.join('\n')}`);
  });
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  const declaredChecks = Array.from((await readFile(new URL(import.meta.url), 'utf8')).matchAll(/await check\('([^']+)'/g), match => match[1]);
  report.unrun = declaredChecks.filter(name => !report.checks.some(check => check.name === name));
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(`${report.checks.filter(check => check.status === 'passed').length} passed; ${report.checks.filter(check => check.status === 'failed').length} failed. Artifacts: ${artifacts}`);
}
