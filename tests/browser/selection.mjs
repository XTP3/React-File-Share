import assert from 'node:assert/strict';
import { api, baseURL, eventually, visible, noHorizontalOverflow } from './support.mjs';

// Chromium cannot reproduce Safari's focus zoom. The 16px input rule and an
// unrestricted viewport are the browser-observable prerequisites we can check.
export async function readableEditableInputs(scope, description) {
  const fields = scope.locator('input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable=true]');
  let checked = 0;
  for (const field of await fields.all()) {
    if (!await field.isVisible() || await field.isDisabled()) continue;
    const font = await field.evaluate(element => parseFloat(getComputedStyle(element).fontSize));
    assert.ok(font >= 16, `${description}: editable input ${await field.getAttribute('aria-label') || await field.getAttribute('id')} is ${font}px`);
    checked++;
  }
  assert.ok(checked > 0, `${description}: must exercise an editable input`);
}

async function zoomAllowed(page) {
  const viewport = await page.locator('meta[name=viewport]').getAttribute('content');
  assert.ok(!/user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=\s*1(?:[\s,;]|$)/i.test(viewport), 'Viewport must allow pinch zoom');
}

export async function selectionRegression({ page, context, session, screenshot }) {
  const csrfToken = session.csrfToken;
  const explorer = page.getByRole('region', { name: 'File explorer', exact: true });
  const row = file => explorer.getByRole('checkbox', { name: `Select ${file.fileName}`, exact: true });
  const all = () => explorer.getByRole('checkbox', { name: 'Select all files on this page', exact: true });
  const selected = count => eventually(async () => {
    if (count) assert.match((await page.locator('.selection-bar > span').innerText()).trim(), new RegExp(`^${count} selected(?:\\s|\\(|$)`));
    else assert.equal(await page.locator('.selection-bar').count(), 0);
  }, `Selection count is ${count}`);
  const changeOption = async (name, option) => {
    await page.getByRole('combobox', { name, exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  const search = async (value, expected) => {
    const input = page.getByLabel('Search files', { exact: true });
    await input.fill(value); await input.press('Enter');
    await eventually(async () => assert.equal(await explorer.getByRole('checkbox', { name: /^Select (?!all files)/ }).count(), expected), `Search ${value} rendered ${expected} rows`);
  };
  const library = (await api(context.request, '/files?pageSize=50&sort=name&direction=asc')).items;
  assert.equal(library.length, 33);
  const first = library[0], secondPage = library[25], untouched = library[26];
  const next = async (scope = page, expected = secondPage, checkbox = row) => {
    await scope.getByRole('button', { name: 'Next page', exact: true }).click();
    await visible(checkbox(expected));
  };
  const previous = async (scope = page, expected = first, checkbox = row) => {
    await scope.getByRole('button', { name: 'Previous page', exact: true }).click();
    await visible(checkbox(expected));
  };
  let collection;
  try {
    await changeOption('Files per page', '25');
    await eventually(async () => assert.equal(await explorer.getByRole('checkbox', { name: /^Select (?!all files)/ }).count(), 25), 'First page is rendered');
    await row(first).check();
    assert.equal(await all().getAttribute('aria-checked'), 'mixed');
    await next(); await row(secondPage).check(); await selected(2);
    await previous(); assert.ok(await row(first).isChecked(), 'Returning to page one preserves its selection');
    await all().click(); await selected(26);
    assert.equal(await all().getAttribute('aria-checked'), 'true');
    await all().click(); await selected(1);
    assert.equal(await all().getAttribute('aria-checked'), 'false');
    await next(); assert.ok(await row(secondPage).isChecked(), 'Deselect page one preserves page two');
    assert.equal(await all().getAttribute('aria-checked'), 'mixed');
    await previous(); await row(first).check();
    await search('browser-photo', 1); await selected(2);
    await search('', 25); assert.ok(await row(first).isChecked(), 'Search preserves hidden selected IDs');
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByRole('checkbox', { name: 'Photos', exact: true }).check();
    await page.keyboard.press('Escape');
    await eventually(async () => assert.equal(await explorer.getByRole('checkbox', { name: /^Select (?!all files)/ }).count(), 1), 'Explorer category filter renders one photo');
    await selected(2);
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByRole('checkbox', { name: 'Photos', exact: true }).uncheck(); await page.keyboard.press('Escape');
    await visible(row(first)); assert.ok(await row(first).isChecked(), 'Category filters preserve hidden selected IDs');
    await changeOption('Sort files', 'Name Z–A'); await visible(row(library.at(-1))); await selected(2);
    await changeOption('Sort files', 'Name A–Z'); await visible(row(first));
    assert.ok(await row(first).isChecked(), 'Sort preserves selected IDs');
    await page.getByRole('button', { name: 'Clear file selection', exact: true }).click(); await selected(0);

    await page.getByRole('button', { name: 'Grid view', exact: true }).click();
    await eventually(async () => assert.equal(await explorer.locator('table, .mobile-file-list').count(), 0), 'Grid replaces list markup');
    assert.equal(await all().count(), 1, 'Grid has one accessible page selection checkbox');
    await all().click(); await selected(25); await all().click(); await selected(0);
    await page.getByRole('button', { name: 'List view', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await eventually(async () => { assert.equal(await explorer.locator('table').count(), 0); assert.equal(await explorer.locator('.mobile-file-list').count(), 1); }, 'Mobile list transition finished');
    assert.equal(await all().count(), 1, 'Mobile has one accessible page selection checkbox');
    await all().click(); await selected(25); await all().click(); await selected(0);
    await readableEditableInputs(page, 'Mobile explorer search'); await zoomAllowed(page);
    await page.getByRole('button', { name: /^Filters/ }).click();
    const filter = page.getByRole('dialog', { name: 'Filter files', exact: true });
    await visible(filter); await readableEditableInputs(filter, 'Mobile filter fields');
    await page.keyboard.press('Escape'); await filter.waitFor({ state: 'hidden' });
    await noHorizontalOverflow(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await eventually(async () => assert.equal(await explorer.locator('.mobile-file-list').count(), 0), 'Desktop list transition finished');

    await page.getByRole('button', { name: 'Create collection', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await visible(page.getByLabel('Collection name', { exact: true }));
    await readableEditableInputs(page.getByRole('dialog'), 'Mobile collection dialog');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByLabel('Collection name', { exact: true }).fill('Selection regression');
    await page.getByRole('dialog').getByRole('button', { name: 'Create collection', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    collection = (await api(context.request, '/collections')).items.find(item => item.title === 'Selection regression');
    assert.ok(collection);
    await page.getByRole('button', { name: /^Selection regression/ }).click();
    await page.waitForURL(`/collections/${collection.id}`);
    await visible(page.getByRole('heading', { name: 'Selection regression', exact: true, level: 2 }));
    await page.getByRole('button', { name: 'Add from library', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Add from library', exact: true });
    await visible(picker);
    const pickerRow = file => picker.getByRole('checkbox', { name: `Select ${file.fileName}`, exact: true });
    const pickerCount = count => eventually(async () => assert.equal(await picker.locator('.library-picker-selection [role=status]').innerText(), `${count} selected`), `Picker count is ${count}`);
    const pickerSort = async () => {
      await picker.getByRole('combobox', { name: 'Sort library', exact: true }).click();
      await page.getByRole('option', { name: 'Name A–Z', exact: true }).click();
      await visible(pickerRow(first));
    };
    const pickerNext = async () => { await picker.getByRole('button', { name: 'Next library page', exact: true }).click(); await visible(pickerRow(secondPage)); };
    const pickerPrevious = async () => { await picker.getByRole('button', { name: 'Previous library page', exact: true }).click(); await visible(pickerRow(first)); };
    await pickerSort(); await pickerRow(first).check();
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
    await picker.waitFor({ state: 'hidden' });
    assert.equal((await api(context.request, `/files?collectionId=${collection.id}`)).total, 0, 'Cancelling picker leaves membership unchanged');
    await page.getByRole('button', { name: 'Add from library', exact: true }).click(); await visible(picker);
    await pickerCount(0); await pickerSort();
    await pickerRow(first).check(); await pickerNext(); await pickerRow(secondPage).check();
    await pickerCount(2); await pickerPrevious();
    assert.ok(await pickerRow(first).isChecked(), 'Picker selection survives page changes');
    const pickerRequests = [], observePicker = request => {
      const url = new URL(request.url());
      if (url.pathname === '/api/v2/files' && url.searchParams.get('q')) pickerRequests.push({ url, at: Date.now() });
    };
    page.on('request', observePicker);
    try {
      const started = Date.now();
      const found = page.waitForResponse(response => {
        const url = new URL(response.url());
        return response.status() === 200 && url.pathname === '/api/v2/files' && url.searchParams.get('q') === 'browser-photo.png';
      });
      await picker.getByLabel('Search library', { exact: true }).pressSequentially('browser-photo.png', { delay: 10 });
      await found; await visible(pickerRow(library.find(file => file.fileName === 'browser-photo.png')));
      assert.equal(pickerRequests.length, 1, 'Picker sends one debounced search request');
      assert.ok(pickerRequests[0].at - started >= 250, 'Picker waits for search debounce');
      assert.equal(pickerRequests[0].url.searchParams.get('page'), '1', 'Picker search resets pagination');
      await pickerCount(2);
    } finally { page.off('request', observePicker); }
    await picker.getByLabel('Search library', { exact: true }).fill('');
    await picker.getByLabel('Search library', { exact: true }).press('Enter'); await visible(pickerRow(first));
    await picker.getByRole('combobox', { name: 'Filter library by category', exact: true }).click();
    await page.getByRole('option', { name: 'Photos', exact: true }).click();
    await eventually(async () => assert.equal(await picker.getByRole('checkbox', { name: /^Select browser-/ }).count(), 1), 'Picker category filter renders one photo');
    await pickerCount(2);
    await picker.getByRole('combobox', { name: 'Filter library by category', exact: true }).click();
    await page.getByRole('option', { name: 'All categories', exact: true }).click(); await visible(pickerRow(first));
    const pickerAll = picker.getByRole('checkbox', { name: 'Select this page', exact: true });
    assert.equal(await pickerAll.getAttribute('aria-checked'), 'mixed');
    await pickerAll.click(); await pickerCount(26); await pickerAll.click(); await pickerCount(1);
    await pickerNext(); assert.ok(await pickerRow(secondPage).isChecked(), 'Picker deselect-page leaves off-page selection');
    await picker.getByRole('button', { name: 'Clear selection', exact: true }).click(); await pickerCount(0);
    await pickerPrevious(); await pickerAll.click(); await pickerNext(); await pickerAll.click(); await pickerCount(33);
    await page.setViewportSize({ width: 390, height: 844 });
    await readableEditableInputs(picker, 'Mobile library picker'); await noHorizontalOverflow(page); await zoomAllowed(page);
    await screenshot('mobile-library-picker-selection');
    await picker.getByRole('button', { name: 'Add selected (33)', exact: true }).click();
    await picker.waitFor({ state: 'hidden' });
    const members = (await api(context.request, `/files?collectionId=${collection.id}&pageSize=50`)).items;
    assert.deepEqual(members.map(file => file.uniqueID).sort(), library.map(file => file.uniqueID).sort(), 'Add selected includes every checked page');
    assert.equal((await api(context.request, '/files')).total, 33, 'Picker adds memberships without duplicate files');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await eventually(async () => assert.equal(await explorer.locator('.mobile-file-list').count(), 0), 'Collection returns to desktop list');
    await page.getByRole('button', { name: 'Add from library', exact: true }).click(); await visible(picker); await pickerSort();
    await pickerRow(first).check(); await pickerNext(); await pickerRow(secondPage).check();
    await picker.getByRole('button', { name: 'Add selected (2)', exact: true }).click(); await picker.waitFor({ state: 'hidden' });
    assert.equal((await api(context.request, `/files?collectionId=${collection.id}`)).total, 33, 'Adding existing memberships is idempotent');
    assert.equal((await api(context.request, '/files')).total, 33, 'Repeated addition preserves library count');

    await changeOption('Sort files', 'Name A–Z'); await visible(row(first));
    await row(first).check();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await visible(page.getByRole('dialog').getByText('1 file selected', { exact: true }));
    const removalRequests = [], observeRemoval = request => {
      if (request.method() === 'DELETE' && new URL(request.url()).pathname === `/api/v2/collections/${collection.id}/files`) removalRequests.push(request.url());
    };
    page.on('request', observeRemoval);
    try {
      await page.goBack(); await page.waitForURL('/files');
      await visible(page.getByRole('heading', { name: 'All Files', exact: true, level: 2 }));
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.equal(removalRequests.length, 0, 'Browser Back closes removal confirmation without submitting it');
      assert.equal((await api(context.request, `/files?collectionId=${collection.id}`)).total, 33, 'Browser Back preserves collection membership');
    } finally { page.off('request', observeRemoval); }
    await page.goForward(); await page.waitForURL(`/collections/${collection.id}`);
    await visible(page.getByRole('heading', { name: 'Selection regression', exact: true, level: 2 }));
    assert.equal(await page.getByRole('dialog').count(), 0, 'Browser Forward does not revive the old removal confirmation');
    await selected(0);

    await changeOption('Sort files', 'Name A–Z'); await visible(row(first));
    await row(first).check(); await next(); await row(secondPage).check(); await selected(2);
    await screenshot('desktop-collection-cross-page-selection');
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    let confirmation = page.getByRole('dialog'); await visible(confirmation);
    await visible(confirmation.getByText('2 files selected', { exact: true }));
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click(); await confirmation.waitFor({ state: 'hidden' });
    await selected(2); assert.equal((await api(context.request, `/files?collectionId=${collection.id}`)).total, 33, 'Cancelled bulk removal preserves selection and membership');
    // Completing an unrelated row action must preserve the pending batch.
    await page.getByRole('button', { name: `Actions for ${untouched.fileName}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Remove from collection', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove membership', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' }); await selected(2);
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    confirmation = page.getByRole('dialog'); await visible(confirmation.getByText('2 files selected', { exact: true }));
    await confirmation.getByRole('button', { name: 'Remove membership', exact: true }).click();
    await confirmation.waitFor({ state: 'hidden' }); await selected(0);
    const remaining = (await api(context.request, `/files?collectionId=${collection.id}&pageSize=50`)).items;
    assert.equal(remaining.length, 30, 'Bulk removal includes the off-page selected file');
    assert.deepEqual(remaining.map(file => file.uniqueID).sort(), library.filter(file => ![first, secondPage, untouched].some(removed => removed.uniqueID === file.uniqueID)).map(file => file.uniqueID).sort());

    const coarse = await context.browser().newContext({ baseURL, viewport: { width: 1024, height: 768 }, hasTouch: true });
    try {
      const coarsePage = await coarse.newPage(); await coarsePage.goto('/login');
      await visible(coarsePage.getByLabel('Username', { exact: true }));
      assert.ok(await coarsePage.evaluate(() => matchMedia('(pointer: coarse)').matches), 'Wide touch context uses coarse pointer');
      await readableEditableInputs(coarsePage, 'Coarse-pointer auth inputs'); await zoomAllowed(coarsePage);
    } finally { await coarse.close(); }
  } finally {
    if (await page.getByRole('dialog').count()) { await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' }); }
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (collection) await api(context.request, `/collections/${collection.id}`, { method: 'DELETE', csrfToken });
    await page.goto('/files');
    await visible(page.getByRole('heading', { name: 'All Files', exact: true, level: 2 }));
    await search('', 25);
    await changeOption('Sort files', 'Name A–Z');
    await changeOption('Files per page', '50');
    await eventually(async () => assert.equal(await explorer.getByRole('checkbox', { name: /^Select (?!all files)/ }).count(), 33), 'Restored original 33-file explorer');
    assert.equal((await api(context.request, '/files')).total, 33, 'Regression fixture preserves all library files');
  }
}
