// server.js — production entry (`node server.js`). Sentry must init before express loads.
import './instrument.js';

await import('./serverApp.js');
