import assert from 'node:assert/strict';
import { api, eventually, noHorizontalOverflow } from './support.mjs';

export async function uploadCollectionsRegression({ page, context, session, screenshot }) {
  const csrfToken = session.csrfToken;
  const originalURL = page.url();
  const viewport = page.viewportSize();
  const stamp = `upload-membership-${Date.now()}`;
  const collections = [];
  let uploaded = [];
  const names = [`${stamp}-batch.txt`, `${stamp}-none.txt`, `${stamp}-override.txt`];
  const picker = (name) => page.locator('.upload-collection-picker').filter({ has: page.getByRole("button", { name, exact: true }) });
  try {
    for (const suffix of ['A', 'B']) collections.push(await api(context.request, '/collections', { method: 'POST', data: { title: `${stamp}-${suffix}` }, csrfToken, expected: 201 }));
    await page.goto(`/collections/${collections[0].id}`);
    await page.getByRole('button', { name: 'Upload', exact: true }).first().click();
    const batch = picker('Batch collections');
    assert.match(await batch.getByRole('button', { name: 'Batch collections', exact: true }).innerText(), new RegExp(`${stamp}-A`), 'Fresh queue defaults to current collection');
    await page.locator('input[type=file]').setInputFiles(names.map(name => ({ name, mimeType: 'text/plain', buffer: Buffer.from(name) })));
    await batch.getByRole('button', { name: 'Batch collections', exact: true }).click();
    await batch.getByRole('textbox').fill(`${stamp}-B`);
    await batch.getByRole('checkbox', { name: `${stamp}-B`, exact: true }).check();
    await batch.getByRole('button', { name: 'Batch collections', exact: true }).click();
    const none = picker(`Collections for ${names[1]}`);
    await none.getByRole('button', { name: `Collections for ${names[1]}`, exact: true }).click();
    await none.getByRole('button', { name: 'No collections', exact: true }).click();
    await none.getByRole('button', { name: `Collections for ${names[1]}`, exact: true }).click();
    const custom = picker(`Collections for ${names[2]}`);
    await custom.getByRole('button', { name: `Collections for ${names[2]}`, exact: true }).click();
    await custom.getByRole('checkbox', { name: `${stamp}-A`, exact: true }).uncheck();
    await screenshot('upload-collections-desktop');
    await page.setViewportSize({ width: 390, height: 844 });
    await custom.scrollIntoViewIfNeeded();
    await noHorizontalOverflow(page);
    for (const label of await custom.locator('label').all()) assert.ok((await label.boundingBox()).height >= 44, 'Collection choices have full mobile touch targets');
    await screenshot('upload-collections-mobile');
    await page.getByRole('button', { name: 'Upload 3 files', exact: true }).click();
    await eventually(async () => {
      uploaded = (await api(context.request, `/files?q=${stamp}&pageSize=100`)).items;
      assert.equal(uploaded.length, 3);
      assert.equal(await page.locator('.upload-item').getByText('Uploaded', { exact: true }).count(), 3);
    }, 'All collection upload files complete');
    const a = (await api(context.request, `/files?collectionId=${collections[0].id}&pageSize=100`)).items;
    const b = (await api(context.request, `/files?collectionId=${collections[1].id}&pageSize=100`)).items;
    assert.deepEqual(a.map(file => file.fileName).sort(), [names[0]]);
    assert.deepEqual(b.map(file => file.fileName).sort(), [names[0], names[2]].sort());
    const noneFiles = (await api(context.request, `/files?collectionId=uncollected&q=${stamp}&pageSize=100`)).items;
    assert.deepEqual(noneFiles.map(file => file.fileName), [names[1]]);
  } finally {
    // Remove only this case's fixtures so subsequent global count assertions remain valid.
    uploaded = (await api(context.request, `/files?q=${stamp}&pageSize=100`)).items;
    for (const file of uploaded) await api(context.request, `/files/${file.uniqueID}`, { method: 'DELETE', csrfToken });
    for (const collection of collections) await api(context.request, `/collections/${collection.id}`, { method: 'DELETE', csrfToken });
    await page.setViewportSize(viewport);
    await page.goto(originalURL);
  }
}
