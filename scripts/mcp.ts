import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
// Only the agent credential is read. The desktop credential is never persisted here.
const root = resolve(import.meta.dir, '..');
process.env.DERP_WORKSPACE_TOKEN ??= (await readFile(resolve(root, '.local/workspace-token'), 'utf8')).trim();
const {serveProxy}=await import('../packages/workspace/src/stdio');
await serveProxy();
