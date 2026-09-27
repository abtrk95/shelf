# Architecture

## Boundaries

One Node process serves the browser assets and pairing APIs. Browsers send authenticated HTTP commands and receive streaming SSE events; WebRTC data channels carry content directly or through an encrypted TURN relay. The signaling service holds ephemeral sessions, labels, invitation credentials, room ownership, bounded event history and rate counters. It does not provide a content-upload endpoint. Rooms contain exactly two browser sessions; no database is required.

SSE uses fetch so bearer credentials remain in Authorization headers, not URLs. Reconnect includes a cursor and a current-state snapshot. Each session's replay history is bounded to 32 events or 64 KiB.

## Invitation permissions

Each session receives a random 256-bit bearer token. QR invitations contain a 24-byte random secret in a URL fragment; the client removes the fragment before use. The alternative is an eight-character code. A valid invitation immediately claims the two-device room; no second approval is required. The code and secret are consumed, as is the joining browser's abandoned invitation.

Room claiming contains no asynchronous gap between validation and mutation. Concurrent attempts cannot add a third device. Self-pairing, unavailable/offline owners, expired invitations and already-claimed rooms are rejected. Join attempts are rate-limited by address and session. Device labels are not verified identities. Treat the invitation as permission to connect and send; keep it private. The connection dialog exposes a short mark derived from both DTLS certificate fingerprints for comparison on the two devices.

Default invitation duration is ten minutes; sessions last thirty minutes and may be extended within a two-hour lifetime. End the session to disconnect both browsers. There is no public directory or persistent device trust.

## Transfer protocol

A reliable ordered channel named shelf-v1 carries validated JSON controls and binary frames:

```
offer -> validate metadata/limits -> reserve storage automatically -> accept(offset)
      -> chunks and acknowledgements -> finish(SHA-256)
      -> receiver verifies size and digest -> complete(SHA-256)
```

Frames contain a 16-byte UUID, eight-byte big-endian offset and up to 16,360 payload bytes. The sender uses channel-buffer backpressure and an approximately 256 KiB unacknowledged window. The receiver acknowledges at approximately 64 KiB and EOF, serializes writes/finalization, and bounds its pending queue to 1 MiB or 256 messages. Each browser runs one outgoing pumping task; receiving can proceed simultaneously.

Valid offers are accepted automatically only after protocol and storage checks. Limits include 64 shelf items, 128 KiB text, a configurable per-file ceiling up to 2 GiB, and a cumulative retained receiving budget of 2 GiB in disk mode or 128 MiB in memory mode. Removing received items frees capacity. The size ceiling is not a claim of tested large-file performance. Invalid offsets, inconsistent metadata, identifier collisions, oversized messages and incomplete/corrupt files cannot become successful deliveries. Cancellation remains available. Links never open and system downloads never start automatically.

## Recovery and storage

The original room owner coordinates bounded connection retries. During a transient interruption, existing blob references and receiving storage remain in the live page. Repeated offers resume from the acknowledged offset. The sender rehashes the acknowledged prefix locally and sends the remaining bytes; final verification still covers the full item.

Refreshing, closing a tab, browser/OS termination or restarting the signaling server does not preserve the session. Browser disk storage is used when a writable origin-private file is available, otherwise a bounded memory fallback is used. Cleanup is requested on removal/end/normal teardown; crashed-tab directories older than 24 hours are removed on a later visit. This is not guaranteed secure erasure. Explicit downloads remain outside this lifecycle. There is no additional application-level encryption at rest.

Only appearance, language, sound and display-name preferences persist in localStorage. Session credentials, content and transfer history do not.

## Interface structure

src/main.ts coordinates lifecycle and user actions. src/lib/ui.ts supplies native accessible dialogs and keyed card reconciliation. Existing cards and image nodes are preserved during progress updates. Connection details move into a header-controlled dialog after pairing; text/image readers expose complete content. Styles in public/workspace.css layer the compact responsive layout and reduced-motion-aware transitions over the original design tokens.

## Deployment consequences

Use one signaling instance. Scaling requires shared authenticated room/event state, coordinated expiry and distributed rate limiting. The configured 2,000-session cap is not a tested capacity promise. TURN needs independent bandwidth planning, quotas and egress controls. See SECURITY.md and DEPLOYMENT.md. Static-only hosting cannot run the signaling service.
