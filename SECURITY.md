# Security model

Shelf is a small, auditable implementation, not an independently audited security product. The browser WebRTC stack supplies encryption; this application does not implement a bespoke encrypted transport.

## Implemented boundaries

- New browser sessions use random bearer tokens. Invitations are short-lived; QR secrets are high entropy. Pairing and incoming transfers require separate explicit approval.
- Bearer tokens stay in runtime memory and HTTP Authorization headers. The QR fragment is removed from history. Tokens are not persisted in storage or placed in event-stream URLs.
- Production requires an explicit HTTPS origin allowlist. POST commands enforce Origin; APIs reject inappropriate content types and oversized JSON. No cross-origin API access is enabled.
- Rate limits apply to new sessions, join guesses, API operations, invitation rotation and stream reconnects. HTTP request/header timeouts and bounded room/session state limit some resource abuse.
- The signaling endpoint accepts only validated offer, answer, candidate and restart forms; clients cannot choose arbitrary forwarding recipients.
- Content messages validate metadata and offsets. Send/receive buffers and message sizes are bounded. The receiver verifies complete size and SHA-256 before reporting success.
- User text is escaped. Only HTTP(S) text can become an active link. Complex untrusted file formats are not rendered in the application. Image previews are local blob URLs for a narrow image-type list.
- Static serving restricts files to the compiled directory, checks real paths, and rejects outside paths. CSP blocks third-party scripts, eval, plugins and embedding; camera, microphone and geolocation are disabled. Styles allow inline values for progress indicators.
- TURN credentials are minted server-side using expiring HMAC credentials; the underlying shared secret never reaches the client.

## Assumptions and remaining risks

The serving origin and device/browser must be trusted. A compromised application host could replace its JavaScript. HTTPS and DTLS do not protect content against compromised endpoints. Device labels are arbitrary. Compare the connection safety mark directly on both devices when the content is sensitive; a short visual mark is not a verified identity or a public-key directory.

The signaling service sees IP addresses, device names, connection metadata and WebRTC negotiation details. Peers, STUN and TURN infrastructure may observe network addresses and traffic sizes/timing. Relayed traffic remains WebRTC-encrypted, but “no servers are involved” would be false. Default STUN is configurable and can be disabled; review its operator for your deployment.

Browser-disk data has no application-level encryption at rest. Forced closure can leave temporary files until later cleanup. There is no guarantee of forensic erasure. Explicitly downloaded files remain on the user's device. Do not promise persistent confidentiality on a shared or compromised browser profile.

Accountless session creation means an attacker can obtain short-lived TURN credentials. Rate limits reduce issuance, not all relay abuse. Set coturn allocation/bandwidth quotas, deny private/metadata/loopback destinations, enforce network egress policies, monitor spend and use an operator kill switch. Ending a room does not revoke already-issued TURN credentials immediately; they expire independently.

## Deploy safely

Do not expose an app with TRUST_PROXY=true directly to untrusted clients. Keep its port private and ensure the trusted proxy overwrites X-Forwarded-For. Protect TLS keys and TURN secrets, pin and update images/dependencies, keep logs free of tokens/content, and complete the public-network and real-device checks in `docs/DEPLOYMENT.md`.

## Reporting

Before publishing this project, add a monitored private security contact or enable a private advisory channel in its repository. Report an issue privately to the deployment owner; do not post live room links, secrets, tokens, or sensitive content in a public issue.
