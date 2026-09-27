# Shelf
### Your things. On your other device.

A temporary shared shelf between two browsers. Add files, photos, text or links; scan a QR invitation or enter an eight-character code; share in both directions without approval prompts.

## Run from source

Requires Node.js 22.16 or newer and npm.

```sh
npm ci --include=dev
npm start
```

Open `http://localhost:3000` in two tabs. `npm start` builds the TypeScript client before starting the Node service. The generated `dist/` directory is ignored by Git; source files are authoritative. Do not open the HTML directly: pairing requires the server.

For a real phone and computer, open the same reachable HTTPS address on both devices. A phone's localhost does not point to your computer. See `docs/DEPLOYMENT.md` for HTTPS and TURN configuration.

## Sharing flow

1. Add content before or after connecting.
2. Scan the QR with the phone's regular camera, or enter the other device's code. A valid invitation connects immediately.
3. Items arrive automatically on the paired device. File size and integrity are verified before delivery is marked complete.
4. Tap a text or image preview to view it fully. Copying text, opening links and saving files to the device remain explicit actions.
5. Manage or end the session through the Connection button in the header.

**Keep invitation codes private:** anyone holding an unexpired code can join the two-device session and send content. Invitations are consumed on pairing. Keep both tabs open; reloading loses the live shelf.

## Interface

Once paired, the large connection card moves out of the main flow. A compact header control opens its details in a dialog. The sender and shelf stay in the foreground on both mobile and desktop. Text readers preserve whitespace and support selection, scrolling and copying; image previews use local blob URLs.

Light/dark/system themes, English/Arabic RTL, keyboard navigation, desktop-only shortcuts and reduced-motion preferences are supported in the implementation. New-card, progress, completion, hover and dialog transitions are lightweight; existing cards remain mounted during progress updates. No remote fonts, animation library, analytics or fetched link previews are used.

## Build and tests

```sh
npm run check       # TypeScript check, build, Node tests
npm run build       # Rebuild static assets
npm run dev         # Build once, then watch the server
```

Browser regression suite:

```sh
python -m pip install -r e2e/requirements.txt
python -m playwright install chromium
npm run test:e2e
```

The browser suite creates a local server and two real browser contexts. `SHELF_E2E_BASE_URL` can select an existing server. It includes automatic pairing/receiving, binary downloads, interrupted-transfer recovery, mobile layout, readable previews and reduced motion. See `docs/TEST_REPORT.md` for what actually ran; authored tests are not a claim that all browsers have passed.

## Implementation and boundaries

Strict TypeScript and native HTML/CSS power the UI. A single Node process serves static assets and authenticated HTTP/SSE pairing signals. Content travels through an ordered WebRTC data channel, directly when possible or through an operator-configured TURN relay. No database or content-upload endpoint is used.

The receiver streams to temporary browser storage when available, with a bounded memory fallback. File/message sizes, item count and total retained receiving storage are limited. Temporary connection interruptions can resume while both original tabs remain alive; refresh, tab closure and server restarts do not preserve sessions.

Source map: `src/main.ts` for the UI; `src/lib/ui.ts` for dialogs and keyed cards; `src/lib/peer.ts` for transport; `src/lib/transfer.ts` for transfers; `server/index.mjs` for signaling; `public/` for static assets; `tests/` and `e2e/` for checks.

## Operations and documentation

Copy `.env.example` to `.env` for local configuration. Never commit real environment files or TURN secrets. Production requires an exact HTTPS origin allowlist. Deploy one signaling instance; multiple replicas require shared state and coordination. Docker/Compose/Caddy and coturn templates are included, but need operator configuration and testing.

See `SECURITY.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/DEPLOYMENT.md`, `docs/KNOWN_LIMITATIONS.md` and `docs/TEST_REPORT.md`. Existing images in `docs/screenshots/` are historical version 1.0 captures, not verification of this UX update.

MIT license. TypeScript is a pinned build dependency. No independent security audit, universal browser compatibility or multi-gigabyte performance guarantee is claimed.
