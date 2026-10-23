import assert from 'node:assert/strict';
import { api, eventually, visible, noHorizontalOverflow } from './support.mjs';

export async function layoutRegression({ page, context, session, screenshot }) {
  const list = page.getByRole('region', { name: 'File list', exact: true });
  const ready = () => eventually(async () => assert.equal(await list.getAttribute('aria-busy'), 'false'), 'File list finished loading');
  const pagination = page.locator('.explorer > .pagination');
  const originalViewport = page.viewportSize();
  const scrollbar = element => {
    const style = getComputedStyle(element);
    return { width: style.scrollbarWidth, color: style.scrollbarColor };
  };
  let uploaded;
  let release;
  const route = async request => { await new Promise(resolve => { release = resolve; }); await request.continue(); };
  const pageTwo = url => url.pathname === '/api/v2/files' && url.searchParams.get('page') === '2';
  try {
    await ready();
    await page.getByRole('button', { name: 'Hide stats', exact: true }).click();
    await page.reload();
    await ready();
    await visible(page.getByRole('button', { name: 'Show stats', exact: true }));
    assert.equal(await page.getByRole('region', { name: 'Storage overview', exact: true }).count(), 0, 'Stats preference survives reload');
    assert.equal(await page.locator('.workspace-footer').count(), 0);
    const scrollStyle = await list.evaluate(scrollbar);
    assert.equal(scrollStyle.width, 'thin');
    assert.equal(scrollStyle.color, 'rgb(100, 107, 120) rgb(24, 26, 31)', 'File scrollbars have a visible dark thumb and track');
    assert.deepEqual(await page.locator('html').evaluate(scrollbar), scrollStyle, 'Document and content scrollbars match');
    await page.emulateMedia({ forcedColors: 'active' });
    assert.deepEqual(await list.evaluate(scrollbar), { width: 'auto', color: 'auto' }, 'High-contrast mode retains system scrollbars');
    await page.emulateMedia({ forcedColors: 'none' });

    for (const [width, height] of [[1440, 1000], [390, 844], [320, 568], [844, 390]]) {
      await page.setViewportSize({ width, height });
      await ready();
      await eventually(async () => {
        const bounds = await pagination.boundingBox();
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= height, 'Pagination stays in the viewport');
        const content = await list.boundingBox();
        assert.ok(content.height >= 72, 'File content remains usable in a short viewport');
        const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        assert.ok(documentHeight <= height + 1, 'The document does not scroll');
      }, 'Viewport fits file browser');
      const before = await pagination.boundingBox();
      await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
      assert.ok(await list.evaluate(element => element.scrollTop > 0), 'Files scroll within their own region');
      assert.deepEqual(await pagination.boundingBox(), before, 'Scrolling files leaves pagination stationary');
      await noHorizontalOverflow(page);
      await screenshot(`files-viewport-${width}x${height}`);
      await list.evaluate(element => { element.scrollTop = 0; });
    }

    await page.getByRole('button', { name: /^Filters/ }).click();
    await visible(page.locator('.filter-body'));
    assert.deepEqual(await page.locator('.filter-body').evaluate(scrollbar), scrollStyle, 'Filter portal uses the same scrollbars');
    await page.keyboard.press('Escape');
    await page.getByRole('combobox', { name: 'Sort files', exact: true }).click();
    await visible(page.locator('[data-radix-select-viewport]'));
    assert.deepEqual(await page.locator('[data-radix-select-viewport]').evaluate(scrollbar), scrollStyle, 'Select menus do not hide their scrollbar');
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.route(pageTwo, route);
    await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await visible(page.locator('.file-loading'));
    const area = await page.locator('.file-content').boundingBox();
    const indicator = await page.locator('.file-loading [data-slot=badge]').boundingBox();
    assert.ok(Math.abs(indicator.x + indicator.width / 2 - area.x - area.width / 2) < 2);
    assert.ok(Math.abs(indicator.y + indicator.height / 2 - area.y - area.height / 2) < 2);
    assert.equal(await list.getAttribute('inert'), '', 'Stale rows cannot be activated during a transition');
    assert.ok(await page.getByRole('button', { name: 'Next page', exact: true }).isDisabled());
    await screenshot('mobile-files-loading');
    await eventually(async () => assert.ok(release), 'The page request is pending');
    release();
    await ready();
    assert.equal(await list.evaluate(element => element.scrollTop), 0, 'A new results page starts at the top');
    await page.unroute(pageTwo, route);
    await page.getByRole('button', { name: 'Previous page', exact: true }).click();
    await ready();
    await page.getByRole('button', { name: 'Grid view', exact: true }).click();
    await visible(page.locator('.file-grid'));
    await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
    assert.ok(await list.evaluate(element => element.scrollTop > 0), 'Grid cards use the same scrollable region');
    await screenshot('mobile-grid-viewport');
    await page.getByRole('button', { name: 'List view', exact: true }).click();

    const fileName = 'layout-full-filename-' + 'long-name-without-truncation-'.repeat(5) + '.txt';
    uploaded = (await api(context.request, '/files/upload', { method: 'POST', csrfToken: session.csrfToken,
      multipart: { files: { name: fileName, mimeType: 'text/plain', buffer: Buffer.from('Layout fixture') } },
    })).files[0];
    const search = page.getByRole('textbox', { name: 'Search files', exact: true });
    await search.fill('layout-full-filename');
    await search.press('Enter');
    await visible(page.getByRole('button', { name: `Actions for ${fileName}`, exact: true }));
    await page.getByRole('button', { name: `Actions for ${fileName}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'File details', exact: true }).click();
    const details = page.getByRole('dialog', { name: 'File details', exact: true });
    await visible(details);
    assert.equal(await details.locator('.full-filename').innerText(), fileName);
    assert.ok(await details.locator('.full-filename').evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Long filename wraps within the mobile dialog');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await details.getByRole('button', { name: 'Copy filename', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), fileName);
    await screenshot('mobile-full-filename');
    await details.getByRole('button', { name: 'Done', exact: true }).click();
  } finally {
    release?.();
    await page.unroute(pageTwo, route);
    if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
    if (uploaded) await api(context.request, `/files/${uploaded.uniqueID}`, { method: 'DELETE', csrfToken: session.csrfToken });
    await page.setViewportSize(originalViewport);
    const search = page.getByRole('textbox', { name: 'Search files', exact: true });
    await search.fill(''); await search.press('Enter');
    if (await page.getByRole('button', { name: 'Show stats', exact: true }).count())
      await page.getByRole('button', { name: 'Show stats', exact: true }).click();
    await page.reload();
    await ready();
  }
}
