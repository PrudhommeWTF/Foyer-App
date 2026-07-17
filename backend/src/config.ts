// Loads Home Assistant add-on options (/data/options.json) into process.env as
// fallbacks, so the same image works both as a plain container (env vars) and
// as an HA add-on (options.json). Imported for its side effect before anything
// else reads configuration.
import fs from 'fs';
import path from 'path';

const OPTIONS_PATH = process.env.FOYER_OPTIONS_PATH || path.join(process.env.FOYER_DATA_DIR || '/data', 'options.json');

function setFallback(key: string, value: unknown): void {
  if (value === undefined || value === null || value === '') return;
  if (process.env[key] === undefined || process.env[key] === '') {
    process.env[key] = String(value);
  }
}

try {
  if (fs.existsSync(OPTIONS_PATH)) {
    const opts = JSON.parse(fs.readFileSync(OPTIONS_PATH, 'utf-8')) as Record<string, unknown>;
    setFallback('FOYER_JWT_SECRET', opts['jwt_secret']);
    setFallback('FOYER_ADMIN_EMAIL', opts['admin_email']);
    setFallback('FOYER_ADMIN_PASSWORD', opts['admin_password']);
    if (opts['allow_signup'] !== undefined) setFallback('FOYER_ALLOW_SIGNUP', opts['allow_signup'] ? 'true' : 'false');
    // eslint-disable-next-line no-console
    console.log('[foyer] Options Home Assistant chargées depuis', OPTIONS_PATH);
  }
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn('[foyer] Impossible de lire options.json :', (e as Error).message);
}
