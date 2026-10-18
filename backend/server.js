// server.js — production entry (`node server.js`). Sentry must init before express loads.
import './instrument.js';

const { startServer } = await import('./serverApp.js');
await startServer();
