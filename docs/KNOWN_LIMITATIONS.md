# Known limitations

## Product scope

This release supports two browsers per temporary session. It does not implement remembered-device identities across visits, multi-device rooms, public discovery, offline cloud delivery or permanent history. Pairing and receipt are automatic only within the current live session.

Use the phone's regular camera for QR invitations. There is no built-in camera scanner, offline service worker or OS share-target integration. Native sharing is offered where supported. Folders can be selected where supported, but files transfer individually; downloads do not reconstruct directory trees or generate ZIPs. There is no PDF renderer, format conversion or fetched website metadata.

Text/link cards and supported images have full-content dialogs. Core interface copy is English/Arabic; some low-level errors remain English. Responsive layouts, semantic dialogs and keyboard/reduced-motion behavior are implemented but still require the browser/accessibility checks listed in the test report.

## Browser and networking boundaries

Both devices need the same reachable HTTPS origin. Keep both original tabs alive. Temporary channel interruptions can resume, but refreshing, closing a tab, browser/OS suspension or restarting the server can lose the live session. Wake lock, clipboard access and sharing remain subject to browser permissions and support.

The configured per-file ceiling is 2 GiB, not proof of reliable 2 GiB transfers. Receiving storage and available quota can impose lower limits. Memory fallback is capped at 128 MiB total. Automatically received content also has a cumulative retained-storage cap; remove items to reclaim it. Stored browser files have no additional application-level encryption at rest. Cleanup after a crash is best effort.

A valid unexpired invitation is permission to join and send. Keep it private; the app no longer provides a second approval prompt. Files are not automatically downloaded to the operating system, links are not automatically opened and the clipboard is not automatically modified.

Restrictive networks need a separately configured TURN relay. STUN is not a relay. Anonymous TURN issuance needs quotas, egress restrictions and cost controls. No relay service is provisioned by this source update.

## Operations and verification

The signaling server is single-instance and in-memory. Restarts end pairings. Distributed state/rate limiting, load validation, uptime monitoring and independent penetration testing are not included.

54 automated Node checks and the TypeScript build passed locally. The updated real-browser suite has not completed: the local managed browser blocks navigation and the GitHub test job did not start a runner. Real-device Safari/Android, Firefox, public TURN, multi-gigabyte performance, Docker execution and formal accessibility validation remain pending. See `docs/TEST_REPORT.md` and the deployment checklist.
