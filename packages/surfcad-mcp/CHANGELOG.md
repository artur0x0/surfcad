# Changelog

## 0.2.0

- `npx surfcad-mcp` starts (or reuses) the loopback agent-bridge relay on `127.0.0.1:17341` so production https://surfcad.com tabs can pair without the Vite dev server.
- Safari is not supported yet: it blocks `ws://127.0.0.1` connections from https pages.
