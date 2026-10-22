import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogText = fs.readFileSync(path.join(root, 'test-cases.md'), 'utf8');
const catalog = new Map();

for (const line of catalogText.split(/\r?\n/)) {
  if (!line.startsWith('| POS-')) continue;
  const columns = line.split('|').slice(1, -1).map((value) => value.trim());
  const [id, , , , , automation] = columns;
  if (catalog.has(id)) throw new Error(`Duplicate Case ID in catalog: ${id}`);
  catalog.set(id, automation);
}

const testDir = path.join(root, 'tests');
const files = fs.readdirSync(testDir).filter((name) => name.endsWith('.spec.ts'));
const implemented = new Map();
const idPattern = /\bPOS-[A-Z]+-\d{3}\b/g;

for (const file of files) {
  const text = fs.readFileSync(path.join(testDir, file), 'utf8');
  for (const match of text.matchAll(idPattern)) {
    const id = match[0];
    if (!catalog.has(id)) throw new Error(`${file} uses unknown Case ID ${id}`);
    if (implemented.has(id)) throw new Error(`Duplicate Playwright Case ID ${id}: ${implemented.get(id)} and ${file}`);
    implemented.set(id, file);
  }
}

const missing = [...catalog.entries()]
  .filter(([, automation]) => automation === 'Playwright')
  .map(([id]) => id)
  .filter((id) => !implemented.has(id));
const mislabeled = [...implemented.keys()].filter((id) => catalog.get(id) !== 'Playwright');

if (missing.length || mislabeled.length) {
  if (missing.length) console.error(`Playwright cases missing from source: ${missing.join(', ')}`);
  if (mislabeled.length) console.error(`Implemented tests not labeled Playwright in catalog: ${mislabeled.join(', ')}`);
  process.exit(1);
}

console.log(`Case catalog valid: ${catalog.size} total, ${implemented.size} Playwright cases implemented.`);

