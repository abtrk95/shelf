import { cp, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const compiler = 'node_modules/typescript/bin/tsc';
if (!existsSync(compiler)) {
  console.error('Build tools are missing. Run npm ci --include=dev, then npm run build.');
  process.exit(1);
}
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
const result = spawnSync(process.execPath, [compiler], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
