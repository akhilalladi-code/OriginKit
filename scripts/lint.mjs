import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = ['src', 'scripts', 'tests'];
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (/\.(?:m?js)$/.test(entry.name)) files.push(full);
  }
}
for (const target of targets) await walk(path.join(root, target));
const failures = [];
for (const file of files) {
  const source = await readFile(file, 'utf8');
  const relative = path.relative(root, file);
  if (/\bdebugger\s*;/.test(source)) failures.push(`${relative}: remove debugger statement.`);
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(source)) failures.push(`${relative}: dynamic code execution is not allowed.`);
  if (relative.startsWith('src/') && /\bconsole\.log\s*\(/.test(source)) failures.push(`${relative}: remove development console.log calls.`);
  const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (syntax.status !== 0) failures.push(`${relative}: ${syntax.stderr || syntax.stdout}`);
}
if (failures.length) {
  console.error(failures.map((failure) => `✗ ${failure}`).join('\n'));
  process.exit(1);
}
console.log(`Lint checks passed for ${files.length} JavaScript files.`);
