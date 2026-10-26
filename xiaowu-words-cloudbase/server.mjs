import http from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCloudbaseDb } from './lib/cloudbase-db.mjs';
import { createHandler } from './lib/http-handler.mjs';

let db, configError = false;
try {
  db = createCloudbaseDb({ envId: process.env.CLOUDBASE_ENV_ID, apiKey: process.env.CLOUDBASE_APIKEY });
} catch { configError = true; }
const handle = createHandler({ db, configError,
  setupCode: process.env.FAMILY_SETUP_CODE,
  origin: (process.env.APP_ORIGIN || '').replace(/\/$/, ''),
  publicDirectory: fileURLToPath(new URL(existsSync(new URL('./dist/public/index.html', import.meta.url)) ? './dist/public/' : './public/', import.meta.url)),
});
const port = Number(process.env.PORT || 9000);
http.createServer(handle).listen(port, '0.0.0.0', () => {
  // No keys, tokens, learning records, or request bodies in application logs.
  console.log(`小五易错字 HTTP service ready on port ${port}`);
});
