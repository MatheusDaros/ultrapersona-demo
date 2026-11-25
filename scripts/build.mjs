import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

const source = (name) => new URL(`../${name}`, import.meta.url);
const output = source('dist/');
await rm(output, { recursive: true, force: true });
await mkdir(output);
for (const path of ['index.html', 'styles.css', 'app.js', 'health.mjs', 'coarena.mjs', 'assets']) {
  await cp(source(path), new URL(path, output), { recursive: true });
}
await writeFile(new URL('event-config.mjs', output), 'export const eventBackend = true;\n');
