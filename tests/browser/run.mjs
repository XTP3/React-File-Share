import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { baseURL, creationCode, password, changedPassword, photo, api, seedFiles, eventually, visible, noHorizontalOverflow, waitForList } from './support.mjs';

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
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await visible(page.getByRole('heading', { name: 'All files', exact: true }));
  session = await api(context.request, '/auth/me');
}
async function clearFilters() { const button = page.getByRole('button', { name: 'Clear filters', exact: true }); if (await button.isVisible()) await button.click(); await page.getByLabel('Search files', { exact: true }).fill(''); await page.getByLabel('Search files', { exact: true }).press('Enter'); }

try {
  await check('Register, login, first-use dark theme, and keyboard focus', async () => {
    await page.goto('/CreateAccount');
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains('dark')), 'Dark theme must be applied on first use');
    await visible(page.getByLabel('Username', { exact: true }));
    await screenshot('desktop-register-dark');
    await page.setViewportSize({ width: 390, height: 844 });
    await noHorizontalOverflow(page);
    await screenshot('mobile-register-dark');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByLabel('Username', { exact: true }).fill(username);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password', { exact: true }).fill(password);
    await page.getByLabel('Account creation code', { exact: true }).fill(creationCode);
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await login();
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => document.activeElement !== document.body), 'Keyboard focus must reach a control');
    await noHorizontalOverflow(page);
    await screenshot('desktop-empty-dark');
  });

  await check('Real fixture upload, global storage totals, and paginated explorer', async () => {
    files = await seedFiles(context.request, session.csrfToken);
    assert.equal(files.length, 33);
    await page.reload();
    await visible(page.getByRole('heading', { name: 'All files', exact: true }));
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

  await check('Create collection, bulk assignment, independent preferences, and nondestructive removal', async () => {
    await page.getByRole('button', { name: 'New collection', exact: true }).click();
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
    await page.getByRole('button', { name: /^Browser collection/ }).click();
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
    await page.getByRole('button', { name: /^All files/ }).click();
    assert.equal(await page.getByLabel('Search files', { exact: true }).inputValue(), '');
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
  });

  await check('Local upload preview supports remove/add before real transfer', async () => {
    await page.getByRole('button', { name: 'Upload files', exact: true }).first().click();
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
    await page.getByRole('button', { name: /^All files/ }).click();
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
    await page.getByRole('button', { name: 'Upload files', exact: true }).first().click();
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
    await page.getByRole('button', { name: 'Upload files', exact: true }).first().click();
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
      await page.getByRole('button', { name: 'Upload files', exact: true }).first().click();
      await page.getByRole('button', { name: 'Cancel update-probe.bin', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
      await eventually(async () => assert.ok(await update.isEnabled()), 'Update enabled after upload cancellation');
      await network.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await update.click();
      await visible(page.getByRole('heading', { name: 'All files', exact: true }));
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
    await visible(page.getByRole('button', { name: 'Sign in', exact: true }));
    assert.equal((await context.request.get('/api/v2/auth/me')).status(), 401);
    await login(changedPassword);
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await visible(page.getByRole('button', { name: 'Sign in', exact: true }));
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
    await visible(page.getByRole('button', { name: 'Sign in', exact: true }));
    await login(changedPassword);
    assert.equal(await page.getByRole('combobox', { name: 'Files per page', exact: true }).textContent(), '50');
    assert.ok((await page.getByRole('combobox', { name: 'Sort files', exact: true }).textContent()).includes('Name A–Z'));
    const preferences = await page.evaluate(() => Object.values(localStorage).join('\n'));
    assert.ok(!preferences.includes(password) && !preferences.includes(changedPassword) && !preferences.includes(session.csrfToken), 'Credentials must never be persisted as preferences');
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await visible(page.getByRole('button', { name: 'Sign in', exact: true }));
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
