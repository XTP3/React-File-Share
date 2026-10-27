import assert from 'node:assert/strict';
import { photo, noHorizontalOverflow } from './support.mjs';

export async function uploadLayoutRegression({ page, screenshot }) {
  const originalViewport = page.viewportSize();
  const files = Array.from({ length: 24 }, (_, i) => ({
    name: `queue-layout-${i}-${'long-filename-'.repeat(8)}.txt`,
    mimeType: 'text/plain', buffer: Buffer.from('Local selection only'),
  }));
  await page.locator('input[type=file]').setInputFiles([
    { name: 'queue-layout-photo.png', mimeType: 'image/png', buffer: photo },
    ...files, files[0],
  ]);
  const dialog = page.locator('.upload-dialog');
  try {
    for (const [width, height] of [[1440, 1000], [680, 768], [390, 844], [320, 568], [844, 390]]) {
      await page.setViewportSize({ width, height });
      await screenshot(`upload-large-queue-${width}x${height}`);
      const bounds = await dialog.boundingBox();
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= height + 1, 'Upload dialog fits viewport');
      assert.ok(await dialog.evaluate(e => e.scrollHeight <= e.clientHeight + 1), 'Dialog itself does not clip its footer');
      for (const row of await dialog.locator('.upload-item').all()) {
        assert.ok(await row.evaluate(e => e.clientHeight >= e.firstElementChild.scrollHeight), 'File rows retain their complete content height');
      }
      const footer = dialog.locator('.upload-footer');
      const before = await footer.boundingBox();
      const body = dialog.locator('.upload-body');
      await body.evaluate(e => { e.scrollTop = e.scrollHeight; });
      assert.ok(await body.evaluate(e => e.scrollTop > 0), 'Large selections scroll');
      assert.deepEqual(await footer.boundingBox(), before, 'Upload controls remain stationary');
      for (const button of await footer.getByRole('button').all()) {
        const box = await button.boundingBox();
        assert.ok(box.x >= bounds.x && box.x + box.width <= bounds.x + bounds.width + 1);
        assert.ok(box.y >= bounds.y && box.y + box.height <= height, 'Footer buttons remain accessible');
      }
      await noHorizontalOverflow(page);
      await screenshot(`upload-large-queue-bottom-${width}x${height}`);
    }
    await dialog.getByRole('button', { name: `Remove ${files[0].name}`, exact: true }).last().click();
    assert.equal(await dialog.locator('.upload-item').count(), 25, 'Offscreen rows can be removed on mobile');
    assert.ok(await dialog.getByRole('button', { name: 'Upload 25 files', exact: true }).isEnabled());
  } finally {
    await dialog.getByRole('button', { name: 'Clear selection', exact: true }).click();
    await page.setViewportSize(originalViewport);
  }
}
