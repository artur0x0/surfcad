// Load backend .env files (prod systemd injects env; dev uses dotenv).
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadBackendDotenv() {
  const envFile = process.env.NODE_ENV === 'production'
    ? '.env.production'
    : '.env.development';

  dotenv.config({ path: path.join(__dirname, '..', envFile), quiet: true });
  dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });
}
