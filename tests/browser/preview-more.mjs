import assert from 'node:assert/strict';
import { eventually, visible, noHorizontalOverflow } from './support.mjs';

// Invoke while the three preview-fixture files are uploaded and the explorer is
// searched to "preview-fixture", after closing the initial image viewer.
export async function previewMediaNavigationRegression({ page, screenshot, mediaFiles }) {
  const viewport = page.viewportSize();
  const sort = page.getByRole('combobox', { name: 'Sort files', exact: true });
  const previousSort = (await sort.innerText()).trim();
  const audio = mediaFiles.find(file => file.category === 'audio');
  const image = mediaFiles.find(file => file.category === 'photo');
  const video = mediaFiles.find(file => file.category === 'video');
  assert.ok(audio && image && video, 'Media navigation fixtures are available');
  const dialog = page.locator('.file-preview-dialog');
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (!previousSort.includes('Name A–Z')) {
      await sort.click();
      await page.getByRole('option', { name: 'Name A–Z', exact: true }).click();
    }
    await eventually(async () => assert.equal(await page.getByRole('region', { name: 'File list', exact: true }).getAttribute('aria-busy'), 'false'), 'Sorted media list ready');
    await page.getByRole('button', { name: audio.fileName, exact: true }).click();
    await visible(dialog);
    const oldAudio = await dialog.locator('audio').elementHandle();
    await eventually(async () => assert.ok(await oldAudio.evaluate(media => Number.isFinite(media.duration) && media.duration >= 3.9)), 'Audio metadata ready');

    // Seeking must retain this file even though a next item exists.
    const seek = dialog.getByRole('slider', { name: 'Seek', exact: true });
    await seek.focus();
    await seek.press('Home');
    await seek.press('ArrowRight');
    await eventually(async () => assert.ok(await oldAudio.evaluate(media => Math.abs(media.currentTime - 1) < 0.15)), 'Arrow key seeks media');
    await visible(dialog.getByRole('heading', { name: audio.fileName, exact: true }));
    await dialog.getByRole('button', { name: 'Play', exact: true }).click();
    await eventually(async () => assert.ok(await oldAudio.evaluate(media => !media.paused)), 'Audio starts before navigation');

    await dialog.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
    await eventually(async () => assert.ok(await dialog.evaluate(element => document.fullscreenElement === element)), 'Native fullscreen entered');
    await dialog.getByRole('button', { name: 'Next file', exact: true }).click();
    await visible(dialog.getByRole('heading', { name: image.fileName, exact: true }));
    assert.ok(await dialog.evaluate(element => document.fullscreenElement === element), 'Native fullscreen survives changing files');
    assert.deepEqual(await oldAudio.evaluate(media => ({ attached: media.isConnected, paused: media.paused, source: media.getAttribute('src') })), { attached: false, paused: true, source: null }, 'Previous audio is paused and released');
    await oldAudio.dispose();

    await dialog.getByRole('button', { name: 'Next file', exact: true }).click();
    await visible(dialog.getByRole('heading', { name: video.fileName, exact: true }));
    assert.ok(await dialog.getByRole('button', { name: 'Next file', exact: true }).isDisabled(), 'Navigation stops at final result');
    const oldVideo = await dialog.locator('video').elementHandle();
    await eventually(async () => assert.ok(await oldVideo.evaluate(media => Number.isFinite(media.duration))), 'Video metadata ready');
    await dialog.getByRole('button', { name: 'Play', exact: true }).click();
    await eventually(async () => assert.ok(await oldVideo.evaluate(media => !media.paused)), 'Video starts before navigation');
    await dialog.press('ArrowLeft');
    await visible(dialog.getByRole('heading', { name: image.fileName, exact: true }));
    assert.ok(await dialog.evaluate(element => document.fullscreenElement === element), 'Keyboard navigation also retains native fullscreen');
    assert.deepEqual(await oldVideo.evaluate(media => ({ attached: media.isConnected, paused: media.paused, source: media.getAttribute('src') })), { attached: false, paused: true, source: null }, 'Previous video is paused and released');
    await oldVideo.dispose();
    await noHorizontalOverflow(page);
    await screenshot('preview-native-fullscreen-navigation');
    await dialog.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
    await dialog.getByRole('button', { name: 'Close preview', exact: true }).click();
  } finally {
    await page.evaluate(async () => { if (document.fullscreenElement) await document.exitFullscreen(); });
    if (await dialog.count()) await page.keyboard.press('Escape');
    if (!previousSort.includes('Name A–Z')) {
      await sort.click();
      await page.getByRole('option', { name: previousSort, exact: true }).click();
    }
    await page.setViewportSize(viewport);
  }
}
