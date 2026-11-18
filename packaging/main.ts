import {realpathSync} from 'node:fs';
import {dirname, resolve} from 'node:path';

process.env.DERP_INSTALL_ROOT = resolve(dirname(realpathSync(process.execPath)), '..');
const command = process.argv[2];
if (command === '--internal-session-host' || command === '--internal-desktop-host') {
  process.argv.splice(2, 1);
  if (command === '--internal-session-host') await import('../scripts/session-host');
  else await import('../scripts/desktop-host');
} else {
  await import('../scripts/cli');
}
