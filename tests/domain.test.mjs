import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAttributions, buildManifest, classifyFile, escapeHtml, filterAssets,
  readiness, safeFilename, summarizeAssets, toCsv, validateAssetRecord,
  validateProjectName,
} from '../src/domain.js';
import { createStoredZip, readStoredZip, crc32 } from '../src/zip.js';

const clearedAsset = {
  id: 'asset-1', projectId: 'project-1', name: 'hero.png', kind: 'image', size: 10,
  creator: 'A. Designer', provider: 'Studio', sourceUrl: 'https://example.com/hero',
  licenseName: 'Written client permission', evidenceUrl: 'https://example.com/permission',
  permissions: { commercialUse: true, modification: true, redistribution: true },
  attributionRequired: false, attribution: '', aiOrigin: 'not-ai', expiresAt: '', sha256: 'abc123',
};

test('readiness requires complete provenance and explicit permissions', () => {
  assert.equal(readiness(clearedAsset).status, 'cleared');
  assert.equal(readiness({ name: 'incomplete' }).status, 'review');
  assert.match(readiness({ name: 'incomplete' }).reasons.join(' '), /source URL/i);
});

test('explicitly denied permissions block an asset', () => {
  const result = readiness({ ...clearedAsset, permissions: { ...clearedAsset.permissions, commercialUse: false } });
  assert.equal(result.status, 'blocked');
  assert.match(result.reasons[0], /Commercial use/);
});

test('expired license blocks an otherwise complete asset', () => {
  assert.equal(readiness({ ...clearedAsset, expiresAt: '2026-01-01' }, '2026-11-23').status, 'blocked');
});

test('attribution is required when the record says it is required', () => {
  const asset = { ...clearedAsset, attributionRequired: true, attribution: '' };
  assert.equal(readiness(asset).status, 'review');
  assert.ok(validateAssetRecord(asset).some((error) => /Attribution text/.test(error)));
});

test('source and evidence URLs reject non-http schemes', () => {
  const errors = validateAssetRecord({ ...clearedAsset, sourceUrl: 'javascript:alert(1)', evidenceUrl: 'file:///etc/passwd' });
  assert.equal(errors.length, 2);
});

test('project names are trimmed and length-limited', () => {
  assert.equal(validateProjectName('   '), 'Enter a project name.');
  assert.equal(validateProjectName('A'.repeat(81)), 'Project names must be 80 characters or fewer.');
  assert.equal(validateProjectName('  Campaign  '), '');
});

test('filtering combines search, project, type and readiness', () => {
  const assets = [clearedAsset, { ...clearedAsset, id: 'asset-2', name: 'font.woff2', kind: 'font', projectId: 'project-2', licenseName: '', permissions: {} }];
  assert.deepEqual(filterAssets(assets, { projectId: 'project-1' }).map((asset) => asset.id), ['asset-1']);
  assert.deepEqual(filterAssets(assets, { status: 'review' }).map((asset) => asset.id), ['asset-2']);
  assert.deepEqual(filterAssets(assets, { query: 'woff', type: 'font' }).map((asset) => asset.id), ['asset-2']);
});

test('summary counts statuses and duplicate markers', () => {
  const summary = summarizeAssets([clearedAsset, { ...clearedAsset, id: 'asset-2', permissions: {}, duplicateOf: 'asset-1' }]);
  assert.deepEqual(summary, { total: 2, cleared: 1, review: 1, blocked: 0, duplicates: 1 });
});

test('manifest omits file bytes and includes computed readiness', () => {
  const manifest = buildManifest([{ id: 'project-1', name: 'Campaign' }], [{ ...clearedAsset, file: new Blob(['secret bytes']) }]);
  assert.equal(manifest.assets[0].rightsStatus, 'cleared');
  assert.equal('file' in manifest.assets[0], false);
  assert.equal(manifest.assets[0].projectName, 'Campaign');
});

test('CSV quotes delimiters and neutralizes spreadsheet formulas', () => {
  const csv = toCsv([{ ...clearedAsset, name: 'hero, "final"\nrev2.png' }, { ...clearedAsset, id: 'asset-2', name: '=HYPERLINK("https://bad.example")' }], []);
  assert.match(csv, /"hero, ""final""\nrev2\.png"/);
  assert.match(csv, /'=HYPERLINK/);
});

test('attribution sheet contains recorded attribution and source', () => {
  const markdown = buildAttributions([{ ...clearedAsset, attributionRequired: true, attribution: 'Photo by A. Designer' }], [{ id: 'project-1', name: 'Campaign' }]);
  assert.match(markdown, /Photo by A\. Designer/);
  assert.match(markdown, /Campaign/);
});

test('HTML escaping prevents markup injection in reports', () => {
  assert.equal(escapeHtml('<script x="1">&\'x\'</script>'), '&lt;script x=&quot;1&quot;&gt;&amp;&#39;x&#39;&lt;/script&gt;');
});

test('file classification recognizes common creative assets', () => {
  assert.equal(classifyFile({ name: 'brand.svg', type: 'image/svg+xml' }), 'image');
  assert.equal(classifyFile({ name: 'display.woff2', type: '' }), 'font');
  assert.equal(classifyFile({ name: 'layout.indd', type: '' }), 'design');
  assert.equal(classifyFile({ name: 'brief.pdf', type: '' }), 'document');
});

test('filenames are made safe for downloads and archive paths', () => {
  assert.equal(safeFilename('../client logo?.png'), 'client-logo-.png');
  assert.equal(safeFilename(''), 'originkit-export');
});

test('stored ZIP backup round-trips files and verifies CRC', async () => {
  const zip = createStoredZip([
    { name: 'origin-kit-backup.json', bytes: new TextEncoder().encode('{"ok":true}') },
    { name: 'files/a/hello.txt', bytes: new TextEncoder().encode('origin data') },
  ]);
  const files = readStoredZip(await zip.arrayBuffer());
  assert.equal(new TextDecoder().decode(files.get('origin-kit-backup.json')), '{"ok":true}');
  assert.equal(new TextDecoder().decode(files.get('files/a/hello.txt')), 'origin data');
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('stored ZIP reader rejects path traversal and corrupted payloads', async () => {
  const unsafe = createStoredZip([{ name: '../escape.txt', bytes: new Uint8Array([1]) }]);
  const unsafeBytes = new Uint8Array(await unsafe.arrayBuffer());
  assert.throws(() => readStoredZip(unsafeBytes), /unsafe file path/i);
  const valid = new Uint8Array(await createStoredZip([{ name: 'safe.txt', bytes: new Uint8Array([1, 2, 3]) }]).arrayBuffer());
  const parsed = readStoredZip(valid);
  assert.equal(parsed.get('safe.txt').length, 3);
  const centralSignature = valid.findIndex((value, index) => value === 0x50 && valid[index + 1] === 0x4b && valid[index + 2] === 0x01 && valid[index + 3] === 0x02);
  valid[38] ^= 0xff;
  assert.throws(() => readStoredZip(valid), /integrity check failed/i);
  assert.ok(centralSignature > 0);
});
