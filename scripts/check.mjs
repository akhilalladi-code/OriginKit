import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const required = ['./styles.css', './src/app.js', './assets/favicon.svg'];
const failures = [];
for (const asset of required) if (!existsSync(path.join(root, asset.slice(2)))) failures.push(`Missing referenced asset: ${asset}`);
if (!html.includes('<html lang="en">')) failures.push('Document language is missing.');
if (!html.includes('name="viewport"')) failures.push('Responsive viewport is missing.');
if (!html.includes('id="viewRoot"')) failures.push('Application root is missing.');
if (!html.includes('id="toastRegion"')) failures.push('Accessible status region is missing.');
if (html.includes('http://') || html.includes('https://')) failures.push('The static shell should not depend on external network resources.');
if (/\sstyle\s*=/.test(html)) failures.push('Inline style attributes are not allowed by the Content Security Policy.');
if (/\son[a-z]+\s*=/i.test(html)) failures.push('Inline event handlers are not allowed.');
if (html.includes('unsafe-inline') || html.includes('unsafe-eval')) failures.push('The Content Security Policy must not allow unsafe inline code.');
for (const file of ['src/app.js', 'src/domain.js', 'src/storage.js', 'src/zip.js', 'tests/domain.test.mjs', 'scripts/build.mjs']) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (result.status !== 0) failures.push(`${file}: ${result.stderr || result.stdout}`);
}
if (failures.length) {
  console.error(failures.map((failure) => `✗ ${failure}`).join('\n'));
  process.exit(1);
}
console.log('Static asset references, document metadata and JavaScript syntax checks passed.');
