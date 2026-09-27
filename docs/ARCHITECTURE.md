# Architecture

## Boundaries

```text
Browser A ── authenticated HTTP POST / streaming SSE ──┐
                                                      ├── Node signaling service
Browser B ── authenticated HTTP POST / streaming SSE ──┘   (ephemeral metadata only)

Browser A ◄════════ ordered WebRTC DataChannel ════════► Browser B
                 browser-to-browser DTLS
               direct or encrypted TURN relay
```

A single Node process hosts static assets and pairing/signaling endpoints. It stores temporary sessions, device labels, room ownership, invitation credentials, pending approvals, bounded signaling-event history, and rate counters. It never intentionally receives transfer metadata or payloads. Rooms contain two browser sessions. No database is needed for this release.

HTTP/SSE was chosen instead of a WebSocket dependency: signaling is a small set of authenticated client commands and a server event stream. A fetch-based SSE reader allows bearer credentials in an Authorization header, not a URL. Heartbeats keep the stream observable. Reconnect includes an event cursor and a state snapshot; history is bounded to 32 events / 64 KiB per session.

## Invitation and trust

Each browser receives a fresh 256-bit bearer token. The host has an eight-character short code and a QR secret generated from 24 random bytes. The QR URL stores its invitation in a fragment, which the client removes before using it. Joining never silently establishes a peer connection: the host approves the joining device first. Possession of a code is not proof of identity. For sensitive use, compare the short safety mark derived from both DTLS certificate fingerprints.

The short-code alphabet contains 32 characters; eight uniformly selected characters provide 40 bits of code space. It is protected by short expiry, join rate limits and approval; the high-entropy QR secret is preferable. The security design does not rely on the short code alone.

A browser joins only one room; there is no automatic public discovery or global list of devices. Pairing invitations expire after ten minutes by default. A room lasts thirty minutes by default and can be extended within a two-hour lifetime.

## Transfer protocol, version 1

One reliable, ordered RTCDataChannel named `shelf-v1` carries both typed JSON controls and binary data. Each control is parsed and validated before use. Filenames, sizes, types, and text are exchanged on this channel, not via HTTP.

```text
offer → receiver explicitly accepts → accept(offset)
      → binary chunks + periodic acknowledgements
      → finish(SHA-256)
      → receiver checks size + digest, finalizes local storage
      → complete(SHA-256)
```

A binary frame contains a 16-byte UUID, an eight-byte big-endian offset, and at most 16,360 payload bytes: 16,384 bytes total. The sender limits unacknowledged data to approximately 256 KiB and checks the data channel's buffered amount. The receiver acknowledges at about 64 KiB intervals and at EOF. It serializes disk writes, control messages, and finalization; the application queue rejects more than 1 MiB or 256 pending messages.

There is one outgoing pumping task per browser; incoming and outgoing directions can run at the same time. Every transfer is separately accepted. Late canceled packets are ignored. Invalid offsets, changed metadata, oversized controls, incomplete files, or digest mismatches cannot become successful deliveries. Completion requires the receiver's verified acknowledgement.

The UI supports up to 64 shelf items, 128 KiB per text snippet, and a configured per-file ceiling of 2 GiB. The ceiling is a limit, not a measured universal browser capability.

## Reconnection and resume

When a peer channel fails, the original room owner coordinates a replacement connection with bounded retry attempts. Existing outgoing file references and incoming storage remain in that live page. A repeated offer for an accepted incoming item returns its current acknowledged offset. The sender rehashes the acknowledged prefix locally and sends only the remaining bytes. The complete digest still covers the whole original item.

Refresh and tab closure are different from a brief connection interruption: session tokens and transfer objects are not persisted, so this release cannot resume across them. Sleep/background behavior remains under browser and operating-system control.

## Storage lifecycle

`TemporaryStorage` probes origin-private browser disk storage. If a writable file is available, it streams received chunks there and applies quota checks. Otherwise it reserves from a total 128 MiB memory budget. Receiver files are not uploaded to cloud object storage.

Removing an item, ending the session, or normal page teardown requests deletion. A forced close can leave temporary files; old abandoned directories are removed after 24 hours on a later visit. This is best-effort deletion, not guaranteed secure erasure. User-downloaded files are outside this lifecycle. There is no separate encryption-at-rest layer for browser storage.

Only appearance, language, sound preference, and a display name persist in localStorage. Live session credentials, content, pairing trust, and file histories do not.

## Scale and operational consequences

In-memory rooms deliberately require one signaling instance. Restarting it loses pairings. Horizontal replicas require an authenticated shared room/event service and coordinated expiry/rate limits, not simply adding replicas. Neither the default 2,000-session limit nor the container memory limit is a tested capacity commitment. TURN requires separate capacity planning because relay bandwidth, not signaling, can dominate cost.

## Primary technical references

- WebRTC data channels and DTLS: https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels
- Buffered amount: https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/bufferedAmount
- Temporary origin-private storage: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
- Clipboard behavior: https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API
