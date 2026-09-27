# Executed test report

**Build:** Shelf 1.0.0  
**Date:** 26 September 2026  
**Status:** local checks passed; public deployment and untested platforms remain subject to the launch checklist.

## Environment actually used

- Node.js v22.16.0; TypeScript 5.8.3, strict configuration.
- Chromium 144.0.7559.96 on Linux, controlled through Python Playwright 1.57.0 and pytest 9.0.2.
- Real local HTTP signaling server, two independent browser contexts, real ordered WebRTC channels. Localhost is a browser secure context.
- STUN disabled for these local connectivity tests; no external TURN service or public network was involved.
- Mobile dimensions/touch behavior were emulated in Chromium. An iPhone-shaped/user-agent test remains Chromium, not an actual Safari/iPhone test.

## Results

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run build` | Passed |
| Node unit/protocol/transfer/server-security suite | **44 passed; 0 failed** |
| Real-browser end-to-end suite | **5 passed; 0 failed**; final run 15.37 s |
| Manual two-browser link + 2 MiB file/download | Passed, exact downloaded byte comparison |
| Browser script errors during observed transfer | None observed |
| Rendered desktop and mobile QR decoding | Passed with an independent QR decoder |
| Source ZIP runtime smoke test | Recorded in `PACKAGE_VERIFICATION.txt` at the package root |

### Unit and server coverage

SHA-256 known answers, million-byte input and arbitrary chunk boundaries are compared against Node crypto. Six QR matrices are checked against independently generated Python qrcode byte-mode/L vectors, including Unicode and longer payloads. Protocol tests cover size limits, typed controls, byte framing and large offsets. Helpers cover safe URLs, escaping and filename sanitization.

Server tests cover origin checks, authentication, pairing approval, rejection of strangers and third participants, invitation expiry/rotation, rate limits, session endings, signaling field filtering, static-path protections, capacity checks and expiring TURN HMAC credentials.

Transfer-engine tests cover explicit acceptance, correct integrity acknowledgement, corrupted data rejection, out-of-order data closure, receiver storage limits, bounded hostile message queues and late packets after cancellation.

### Real-browser scenarios

1. Responsive widths 320, 390, 768, 1024 and 1440 pixels; dark mode; Arabic RTL; no horizontal overflow; text-dialog keyboard opening, initial focus and Escape closing.
2. Queue a link before pairing, obtain owner approval, compare matching safety marks, receive a link, send multilingual text in the reverse direction, receive/download both a 2 MiB binary file and a zero-byte file, then end the session on both sides.
3. Transfer a **16 MiB** binary file; forcibly close the original real peer connection after about 1 MiB; establish another connection; observe resumed frames beginning above offset zero; verify the full downloaded SHA-256.
4. Decline incoming text, cancel an incoming file, treat `javascript:` text as non-clickable text, and ensure an HTML-looking filename is displayed without inserting executable markup.
5. Open a QR invitation deep link, remove its fragment from the visible URL, require host approval, decline, and show a useful error to the joining browser.

The interruption test instruments observation and closes a real connection. It does not replace transfer APIs with mock success responses. Unit tests, separately, use controlled test channels to exercise malformed and malicious payloads.

## Evidence

`docs/screenshots/` contains actual rendered empty, mobile, pairing-approval, connected, dark desktop and dark Arabic views. These are screenshots of the supplied code, not design renders. Historical QR codes in the images are temporary test invitations.

One independently verified 2 MiB sample consisted of bytes 0–255 repeated 8,192 times. Its digest was:

```text
91d3beb88a9b2f778a6c44a1c53b63d3c79931845a9aef84b3fb414610bd1938
```

The sample binary is deliberately not included in the deliverable.

## Not claimed

No Docker image build, Compose startup, public TLS/TURN test, remote-network benchmark, GitHub-hosted workflow run, real Safari/Firefox/physical-phone check, multi-gigabyte transfer, large-scale load test, external penetration test or formal accessibility certification was completed here. See `KNOWN_LIMITATIONS.md` and `DEPLOYMENT.md` before public launch.
