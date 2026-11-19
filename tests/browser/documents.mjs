import assert from 'node:assert/strict';
import { api, eventually, noHorizontalOverflow, visible } from './support.mjs';

const prefix = 'document-preview-fixture';
const firstPageText = 'Selectable PDF first page';
const secondPageText = 'Selectable PDF second page';
const textLimit = 256 * 1024;

function pdfFixture() {
  const stream = content => `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
  const page = (contents, rotation = 0) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]
    /Rotate ${rotation} /Resources << /Font << /F1 5 0 R >> >> /Contents ${contents} 0 R >>`;
  const pageContent = text => stream(`0.13 0.35 0.68 rg\n48 704 516 35 re f\n0 g\nBT /F1 24 Tf 48 672 Td (${text}) Tj ET`);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    page(6),
    page(7, 90),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    pageContent(firstPageText),
    pageContent(secondPageText),
    // Keep the file above the PDF.js range-loading threshold.
    stream(' '.repeat(256 * 1024)),
  ];
  const chunks = ['%PDF-1.4\n'];
  const offsets = ['0000000000 65535 f \n'];
  let length = Buffer.byteLength(chunks[0]);
  for (const [index, object] of objects.entries()) {
    const chunk = `${index + 1} 0 obj\n${object}\nendobj\n`;
    offsets.push(`${String(length).padStart(10, '0')} 00000 n \n`);
    chunks.push(chunk);
    length += Buffer.byteLength(chunk);
  }
  chunks.push(`xref\n0 ${offsets.length}\n${offsets.join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`);
  return Buffer.from(chunks.join(''));
}

export async function documentRegression({ page, context, session, screenshot }) {
  const files = [];
  const viewport = page.viewportSize();
  const search = page.getByLabel('Search files', { exact: true });
  const previousSearch = await search.inputValue();
  const viewer = page.locator('.file-preview-dialog');
  const pdfCanvas = viewer.locator('canvas');
  const fitWidth = viewer.getByRole('button', { name: 'Fit PDF to width', exact: true });
  const previousPage = viewer.getByRole('button', { name: 'Previous PDF page', exact: true });
  const nextPage = viewer.getByRole('button', { name: 'Next PDF page', exact: true });
  const textPreview = viewer.getByRole('region', { name: 'Text preview', exact: true });
  const markup = '<h1>Literal HTML</h1>\n<script>window.previewFixtureScriptRan = true</script>\n<p>UTF-8 café 🪐</p>';
  const largeTextStart = 'Large text fixture\n';
  const largeText = Buffer.from(largeTextStart + 'a'.repeat(textLimit - largeTextStart.length - 1) + '🪐\nOutside preview');
  const setSearch = async value => {
    await search.fill(value);
    await search.press('Enter');
  };
  const openFile = async file => {
    await page.getByRole('button', { name: file.fileName, exact: true }).click();
    await visible(viewer.getByRole('heading', { name: file.fileName, exact: true }));
  };
  const close = async () => {
    await viewer.getByRole('button', { name: 'Close preview', exact: true }).click();
    await viewer.waitFor({ state: 'hidden' });
  };

  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const [extension, mimeType, buffer] of [
      ['pdf', 'application/pdf', pdfFixture()],
      ['html', 'text/html', Buffer.from(markup)],
      ['txt', 'text/plain', largeText],
      ['-corrupt.pdf', 'application/pdf', Buffer.from('%PDF-1.4\ntruncated document\n')],
    ]) {
      const name = `${prefix}${extension.startsWith('-') ? '' : '.'}${extension}`;
      const upload = await api(context.request, '/files/upload', {
        method: 'POST', csrfToken: session.csrfToken, multipart: { files: { name, mimeType, buffer } },
      });
      files.push(...upload.files);
    }
    const [pdf, html, text, corrupt] = files;
    await setSearch(prefix);

    const pdfRange = page.waitForResponse(response => (
      new URL(response.url()).pathname === `/f/v/${pdf.uniqueID}` && response.status() === 206
    ));
    await openFile(pdf);
    const firstLine = viewer.getByText(firstPageText, { exact: true });
    await visible(firstLine);
    assert.match((await pdfRange).request().headers().range, /^bytes=\d+-\d+$/);
    assert.ok(await previousPage.isDisabled(), 'The first page is the lower navigation bound');
    assert.equal(await fitWidth.getAttribute('aria-pressed'), 'true');
    const firstCanvas = await pdfCanvas.evaluate(canvas => {
      const pixel = canvas.getContext('2d').getImageData(Math.round(canvas.width * 0.5), Math.round(canvas.height * 0.09), 1, 1).data;
      return { width: canvas.clientWidth, pixel: [...pixel] };
    });
    assert.ok(firstCanvas.pixel[0] < 100 && firstCanvas.pixel[2] > 100 && firstCanvas.pixel[3] === 255, 'The PDF canvas renders page artwork');
    assert.equal(await firstLine.evaluate(element => {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      const text = selection.toString();
      selection.removeAllRanges();
      return getComputedStyle(element).userSelect === 'text' ? text : '';
    }), firstPageText, 'The canvas has a selectable text layer');
    await screenshot('desktop-preview-pdf');

    await nextPage.click();
    await visible(viewer.getByText(secondPageText, { exact: true }));
    assert.equal(await firstLine.count(), 0);
    assert.ok(await nextPage.isDisabled(), 'The last page is the upper navigation bound');
    await previousPage.click();
    await visible(firstLine);
    const zoomIn = viewer.getByRole('button', { name: 'Zoom in', exact: true });
    while (await zoomIn.isEnabled()) await zoomIn.click();
    await eventually(async () => {
      await visible(firstLine);
      const canvas = await pdfCanvas.evaluate(element => ({ width: element.width, height: element.height, displayWidth: element.clientWidth }));
      assert.ok(canvas.displayWidth > firstCanvas.width, 'Zoom grows the PDF page');
      assert.ok(Math.max(canvas.width, canvas.height) <= 4096 && canvas.width * canvas.height <= 8_000_000, 'Zoom keeps the canvas within its rendering budget');
    }, 'Zoomed PDF renders');
    await fitWidth.click();
    await eventually(async () => {
      await visible(firstLine);
      assert.equal(await pdfCanvas.evaluate(element => element.clientWidth), firstCanvas.width);
    }, 'Fit width restores the desktop page width');
    for (const [width, height] of [[320, 568], [844, 390]]) {
      await page.setViewportSize({ width, height });
      await eventually(async () => {
        await visible(firstLine);
        const canvas = await pdfCanvas.boundingBox();
        const region = await viewer.getByRole('region', { name: 'PDF page', exact: true }).boundingBox();
        assert.ok(canvas.width < region.width && canvas.width > region.width - 56, 'The page fits the resized viewer');
      }, 'PDF reflows at the new viewport size');
      const controls = await viewer.getByRole('group', { name: 'PDF controls', exact: true }).getByRole('button').all();
      const targets = await Promise.all(controls.map(control => control.boundingBox()));
      assert.ok(targets.every(target => target.width >= 44 && target.height >= 44), 'PDF controls retain 44px targets');
      assert.ok(targets.every(target => Math.abs(target.y - targets[0].y) < 1), 'PDF controls fit on one row');
      await noHorizontalOverflow(page);
      await screenshot(`preview-pdf-${width}x${height}`);
    }
    await close();

    await page.setViewportSize({ width: 1440, height: 1000 });
    await openFile(html);
    await visible(textPreview);
    assert.equal(await textPreview.locator('pre').textContent(), markup, 'HTML and Unicode render as literal text');
    assert.equal(await textPreview.locator('h1, script, iframe').count(), 0);
    assert.equal(await page.evaluate(() => window.previewFixtureScriptRan), undefined);
    await page.setViewportSize({ width: 390, height: 844 });
    await noHorizontalOverflow(page);
    await screenshot('mobile-preview-text');
    await close();

    await page.setViewportSize({ width: 1440, height: 1000 });
    const textRange = page.waitForResponse(response => (
      new URL(response.url()).pathname === `/f/v/${text.uniqueID}` && response.status() === 206
    ));
    await openFile(text);
    const checkTruncation = async () => {
      await visible(viewer.getByText('Showing the first 256 KiB of this file.', { exact: true }));
      const preview = await textPreview.locator('pre').textContent();
      assert.ok(preview.startsWith(largeTextStart));
      assert.equal(Buffer.byteLength(preview), textLimit - 1, 'A cut UTF-8 character is omitted');
      assert.ok(!preview.includes('Outside preview'));
    };
    await checkTruncation();
    assert.equal((await textRange).request().headers().range, `bytes=0-${textLimit - 1}`);
    await close();

    const url = `**/f/v/${text.uniqueID}`;
    const ignoreRange = route => route.fulfill({ status: 200, contentType: 'text/plain', body: largeText });
    await page.route(url, ignoreRange);
    try {
      await openFile(text);
      await checkTruncation();
      await close();
    } finally {
      await page.unroute(url, ignoreRange);
    }

    await openFile(corrupt);
    await visible(viewer.getByText('This PDF could not be displayed. Open the original file or download it to view it.', { exact: true }));
    await visible(viewer.getByRole('link', { name: 'Download', exact: true }));
    await close();
  } finally {
    if (await viewer.count()) await page.keyboard.press('Escape');
    await page.setViewportSize(viewport);
    for (const file of files) {
      await api(context.request, `/files/${file.uniqueID}`, { method: 'DELETE', csrfToken: session.csrfToken });
    }
    await setSearch(previousSearch);
  }
}
