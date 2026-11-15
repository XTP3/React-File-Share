import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { api, eventually, visible, noHorizontalOverflow } from './support.mjs';

function zipNames(bytes) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'Browser received a complete ZIP');
  let offset = bytes.readUInt32LE(end + 16);
  const names = [];
  for (let count = bytes.readUInt16LE(end + 10); count > 0; count--) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    assert.equal(bytes.readUInt16LE(offset + 10), 0, 'ZIP entries are uncompressed');
    const length = bytes.readUInt16LE(offset + 28);
    names.push(bytes.subarray(offset + 46, offset + 46 + length).toString());
    offset += 46 + length + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  return names;
}

export async function bulkPreviewRegression({ page, context, session, screenshot }) {
  const library = (await api(context.request, '/files?sort=name&direction=asc&pageSize=100')).items;
  const row = index => page.getByRole('checkbox', { name: `Select ${library[index].fileName}`, exact: true });
  const choose = async (name, option) => {
    await page.getByRole('combobox', { name, exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  const clear = async () => {
    const button = page.getByRole('button', { name: 'Clear file selection', exact: true });
    if (await button.count()) await button.click();
  };
  let collection;
  try {
    await choose('Files per page', '25');
    await visible(row(0));
    await row(3).click(); await row(0).click(); await row(5).click({ modifiers: ['Shift'] });
    await row(3).click(); await row(3).click();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copy links', exact: true }).click();
    const ids = [0, 1, 2, 4, 5, 3];
    const links = indexes => indexes.map(i => `${new URL(page.url()).origin}/f/v/${library[i].uniqueID}`).join('\n');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), links(ids), 'Range selection preserves insertion and reselection order');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Download selected files', exact: true });
    await visible(dialog);
    const downloaded = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download', exact: true }).click();
    const zip = await downloaded;
    assert.equal(await zip.failure(), null);
    assert.deepEqual(zipNames(await readFile(await zip.path())), ids.map(i => library[i].fileName), 'Downloaded archive follows selection order');
    await dialog.waitFor({ state: 'hidden' });

    await clear(); await row(8).click(); await row(5).click({ modifiers: ['Shift'] });
    await page.getByRole('button', { name: 'Copy links', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), links([8, 7, 6, 5]), 'Reverse range follows gesture direction');
    await clear(); await row(0).click();
    await page.getByRole('button', { name: 'Next page', exact: true }).click(); await visible(row(25));
    await page.getByRole('button', { name: 'Previous page', exact: true }).click(); await visible(row(0));
    await row(5).click({ modifiers: ['Shift'] });
    await page.getByRole('button', { name: 'Copy links', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), links([0, 5]), 'Pagination clears the range anchor without losing selected files');
    const popupEvent = page.waitForEvent('popup');
    await page.getByRole('link', { name: `Open original ${library[5].fileName}`, exact: true }).click();
    const popup = await popupEvent; await popup.waitForLoadState();
    assert.equal(new URL(popup.url()).pathname, `/f/v/${library[5].uniqueID}`);
    await popup.close(); assert.ok(await row(0).isChecked(), 'Open original preserves selection');

    for (const [width, height] of [[320, 568], [390, 844], [844, 390]]) {
      await page.setViewportSize({ width, height });
      const actions = page.getByRole('button', { name: 'Selected file actions', exact: true });
      await visible(actions);
      await actions.click(); await page.getByRole('menuitem', { name: 'Copy links', exact: true }).click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), links([0, 5]));
      await noHorizontalOverflow(page);
      await screenshot(`bulk-selection-${width}x${height}`);
      await actions.click(); await page.getByRole('menuitem', { name: 'Download', exact: true }).click();
      await visible(dialog); await noHorizontalOverflow(page);
      await screenshot(`bulk-download-${width}x${height}`);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await choose('Download format', 'Separate files');
    const received = [], observe = download => received.push(download);
    page.on('download', observe);
    try {
      await dialog.getByRole('button', { name: 'Download', exact: true }).click();
      await eventually(async () => assert.equal(received.length, 2), 'Separate downloads requested');
      // Native download events arrive when response headers do, so concurrent
      // responses may reorder them. Unit tests assert the dispatch order.
      assert.deepEqual(received.map(download => new URL(download.url()).pathname).sort(), [0, 5].map(i => `/f/d/${library[i].uniqueID}`).sort());
      for (const download of received) assert.equal(await download.failure(), null);
    } finally { page.off('download', observe); }
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    assert.match(await page.getByRole('combobox', { name: 'Download format', exact: true }).innerText(), /One ZIP/);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

    await clear();
    await page.locator('.file-name-button').filter({ hasText: library[24].fileName }).click();
    const viewer = page.locator('.file-preview-dialog');
    await visible(viewer);
    await visible(viewer.getByRole('status').filter({ hasText: '25 / 33' }));
    await viewer.getByRole('button', { name: 'Maximize preview', exact: true }).click();
    await page.keyboard.press('ArrowRight');
    await visible(viewer.getByRole('heading', { name: library[25].fileName, exact: true }));
    assert.equal(await viewer.getAttribute('data-expanded'), 'true', 'Expansion survives page navigation');
    await page.keyboard.press('ArrowLeft');
    await visible(viewer.getByRole('heading', { name: library[24].fileName, exact: true }));
    await viewer.getByRole('button', { name: 'Close preview', exact: true }).click();
    await page.locator('.file-name-button').filter({ hasText: library[0].fileName }).click();
    assert.ok(await viewer.getByRole('button', { name: 'Previous file', exact: true }).isDisabled());
    for (const [width, height] of [[320, 568], [390, 844], [844, 390]]) {
      await page.setViewportSize({ width, height });
      await viewer.getByRole('button', { name: 'Next file', exact: true }).click();
      await visible(viewer.getByRole('heading', { name: library[1].fileName, exact: true }));
      await noHorizontalOverflow(page); await screenshot(`carousel-${width}x${height}`);
      await viewer.getByRole('button', { name: 'Previous file', exact: true }).click();
      await visible(viewer.getByRole('heading', { name: library[0].fileName, exact: true }));
    }
    await viewer.getByRole('button', { name: 'Close preview', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Next page', exact: true }).click(); await visible(row(32));
    await page.locator('.file-name-button').filter({ hasText: library[32].fileName }).click();
    assert.ok(await viewer.getByRole('button', { name: 'Next file', exact: true }).isDisabled());
    await viewer.getByRole('button', { name: 'Close preview', exact: true }).click();
    collection = await api(context.request, '/collections', { method: 'POST', csrfToken: session.csrfToken, data: { title: 'Carousel regression' }, expected: 201 });
    await api(context.request, `/collections/${collection.id}/files`, { method: 'POST', csrfToken: session.csrfToken, data: { fileIds: [library[0].uniqueID, library[1].uniqueID] } });
    await page.goto(`/collections/${collection.id}`);
    await page.locator('.file-name-button').first().click();
    await visible(viewer.getByRole('status').filter({ hasText: '1 / 2' }));
    await viewer.getByRole('button', { name: 'Next file', exact: true }).click();
    await visible(viewer.getByRole('status').filter({ hasText: '2 / 2' }));
    assert.ok(await viewer.getByRole('button', { name: 'Next file', exact: true }).isDisabled());
  } finally {
    if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (collection) await api(context.request, `/collections/${collection.id}`, { method: 'DELETE', csrfToken: session.csrfToken });
    await page.goto('/files');
    await choose('Files per page', '50');
  }
}
