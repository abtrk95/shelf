# Known limitations — version 1.0.0

## Product scope

This release implements the central two-browser shelf, not every idea in the earlier product concept. Persistent trusted-device identities/automatic reconnection across visits, multi-device rooms, auto-receive, public discovery, cloud delivery while the receiver is offline, and permanent histories are not implemented.

There is no built-in QR camera scanner: use the phone's normal camera to open the invitation. The manifest is install-friendly, but there is no offline service worker or OS share-target integration. Native sharing of a received item is exposed only when the browser supports it. No installation is required for the main flow.

Folders may be selected where the browser supports a directory picker, but files are transferred individually; directory structures are not rebuilt on download and no ZIP is generated. Photos are original individual files, not an automatic gallery archive. There is no PDF/document renderer, conversion pipeline, arbitrary-file preview or fetched website metadata. Link cards deliberately avoid contacting remote websites until opened.

The English and Arabic core UI is translated. Some low-level validation/network error strings remain English. Arabic layouts are tested for overflow, not independently reviewed for all linguistic nuances. Keyboard navigation and semantic markup are implemented; this is not a formal WCAG conformance audit.

## Platform behavior

Both devices need the same reachable HTTPS origin. A localhost address works only on that same device. Connecting phones via a plain LAN IP over HTTP is deliberately blocked as insecure.

Both tabs must stay alive. The app handles transient reconnection, not refresh, browser termination, OS suspension, or a server restart. Screen wake lock is best effort, not a guarantee against suspension. Ordinary browser permissions can block clipboard access or sharing; manual-copy/download fallbacks remain available.

File size is bounded by browser storage, device memory and the configured server limit. A 2 GiB ceiling is NOT evidence of tested 2 GiB transfer support. Executed browser tests cover files through 16 MiB, including a forced disconnect and byte-level verification. The memory fallback is 128 MiB total; it is not appropriate for large files. OPFS availability and quota vary by browser/mode. Temporary browser files are not application-encrypted at rest.

## Networking and infrastructure

Restrictive networks need an operator-supplied TURN service. STUN alone is not a relay. The app supports expiring coturn-compatible credentials; no public TURN endpoint, paid service, certificate, DNS record, or hosting account is included. Direct connectivity may still be unavailable on managed corporate browsers or firewalls. Relay-only mode can be used to validate the configured relay or reduce disclosure of endpoint IP addresses to a peer.

The signaling service is single-instance and keeps all rooms in memory. No Redis, distributed rate limit, multi-region orchestration, load test, external penetration test or production uptime monitoring is included. An anonymous application can expose its relay budget to abuse even with short-lived credentials: quotas, egress restrictions, budget alerts and an edge abuse policy are operator responsibilities.

## What has not been verified in this environment

Real Safari/iOS, Firefox, physical Android devices, cross-carrier networking, public HTTPS/TURN routing, certificate automation, Docker/Compose execution, the GitHub-hosted CI run, extreme concurrent load, multi-gigabyte performance, and assistive-technology certification have not been executed here. Chromium mobile emulation is not a substitute for Safari or a physical phone test. Treat the supplied launch checklist as required before a broad public launch.
