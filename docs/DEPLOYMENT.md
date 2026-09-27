# Deployment and launch

## Local source checkout

Requires Node.js 22.16 or newer.

```sh
npm ci --include=dev
npm start
```

Open http://localhost:3000 in two tabs. Startup builds the client with the pinned compiler; dist/ is generated, not committed. To restrict a preview to this computer, set HOST=127.0.0.1 in .env. Do not open dist/index.html directly. A different device must use a reachable HTTPS address, not your computer's localhost.

## Render web service

Deploy this repository as a Node web service, not a static site. Build with `npm ci --include=dev && npm run build`; start with `npm start`. Set NODE_ENV=production and ALLOWED_ORIGINS to the exact HTTPS service origin with no trailing slash. Set NODE_VERSION to a supported patched Node 22 version at least 22.16.0. The application reads Render's PORT and binds to 0.0.0.0. `/healthz` is the health endpoint.

The repository .npmrc includes development dependencies so the pinned TypeScript compiler is installed even when NODE_ENV is production. Builds fail clearly rather than falling back to an unrelated global compiler. Use a single instance: live rooms are in memory. A server restart or deployment can end existing pairings; save content and establish fresh sessions after an update.

Verify whether Git-provider integration is authorized for automatic deploys. A deploy must actually reach live status on the intended commit; do not infer it merely from a successful GitHub push. Monitor hosting limits and separately configure TURN for networks that block direct connections.

## Docker and HTTPS

Prerequisites: Docker Engine with Compose, a DNS name pointing to a reachable server, and inbound TCP ports 80/443.

```sh
cp .env.example .env
# Edit .env: SHELF_DOMAIN=shelf.your-domain.com
# Add private TURN configuration when needed.
docker compose up -d --build
docker compose logs -f --tail=50 app
```

Compose sets the production origin from SHELF_DOMAIN and keeps the Node port private behind Caddy. Caddy supplies HTTPS and streaming proxying. Only enable TRUST_PROXY when the application is inaccessible directly and the trusted proxy overwrites X-Forwarded-For. Do not buffer SSE responses or impose short streaming timeouts. Preserve Caddy's certificate data volume.

The Docker configuration is included but has not been executed in the implementation environment. Review image versions, pin reviewed image digests for releases and maintain security updates. The runtime image starts Node directly with the compiled client and no runtime npm dependencies.

## TURN relay

STUN is not a relay. Use coturn or a compatible time-limited HMAC credential service when direct WebRTC is blocked. The app does not support an arbitrary proprietary TURN-token API without adaptation.

Generate a secret privately:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Set the same private shared secret in coturn and the application's environment:

```dotenv
TURN_URLS=turn:turn.your-domain.com:3478?transport=udp,turn:turn.your-domain.com:3478?transport=tcp,turns:turn.your-domain.com:5349?transport=tcp
TURN_SECRET=YOUR_GENERATED_SECRET
ICE_TRANSPORT_POLICY=all
```

Edit deploy/turnserver.conf.example with the real domain, secret, certificate paths, NAT mapping and appropriate quotas. Open listener ports and the configured relay UDP range in both firewalls. TURN is not routed through the HTTP Caddy proxy. Deny private, loopback and cloud-metadata destinations; enforce egress restrictions, bandwidth/allocation limits and cost alerts. A public anonymous app may expose its relay budget to abuse even with expiring credentials.

To validate the relay, temporarily set ICE_TRANSPORT_POLICY=relay, restart the service and transfer a file between actual devices on different networks. Check the connection dialog's route, downloaded bytes and relay traffic. Restore all for direct-first operation unless relay-only is deliberate policy. This network test remains pending.

## Configuration

- HOST defaults to 0.0.0.0; PORT to 3000.
- NODE_ENV=production requires ALLOWED_ORIGINS containing exact HTTPS origins, comma-separated, without trailing slashes.
- TRUST_PROXY defaults to false; trust forwarded addresses only behind a protected header-overwriting proxy.
- SESSION_TTL_SECONDS defaults to 1800, maximum 7200. INVITE_TTL_SECONDS defaults to 600, maximum 1800, bounded by session expiry.
- MAX_SESSIONS defaults to 2000, a safety cap rather than a capacity claim.
- MAX_FILE_BYTES defaults to 2147483648; receiver browser/storage limits may be lower.
- STUN_URLS defaults to stun:stun.cloudflare.com:3478; use an empty value to disable it.
- TURN_URLS is empty until configured; TURN_SECRET is a server-only shared secret.
- ICE_TRANSPORT_POLICY is all or relay; relay requires TURN.
- SHELF_DOMAIN is used by Compose/Caddy only.

Never commit .env, bearer credentials, invitation secrets or TURN keys. Health responses must not expose content or credentials.

## Before broad release

Test physical Safari/iPhone and Android/Chrome plus desktop browsers; same-network and cross-network pairing; forced relay; interrupted transfer recovery; full text and image readers; keyboard, zoom, screen-reader and reduced-motion behavior. Verify TLS renewal, proxy streaming, rate limits, origin rejection, storage constraints, realistic large files, relay quotas and security reporting. Monitor health without logging text, filenames, links or credentials. See TEST_REPORT.md for completed checks; deployment success is not a substitute for device testing.

## Troubleshooting

Phone QR fails: use a shared reachable HTTPS origin, not localhost. Pairing works but transfer does not: inspect TURN/firewall/browser restrictions. All clients become rate-limited: review trusted proxy address handling rather than blindly trusting incoming headers. Events arrive late: disable response buffering/cache and review streaming timeouts. Storage is full: remove received items or send smaller files. Refresh or closed tab cannot resume: start a fresh session; only transient channel failure in live tabs supports resume.
