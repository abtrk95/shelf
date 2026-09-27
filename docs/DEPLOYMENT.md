# Deployment and launch

## 1. Local preview

```sh
npm start
```

Visit `http://localhost:3000` in two tabs. The prebuilt app runs without npm dependencies. Node 22.16+ is required. Default HTTP binding is `0.0.0.0:3000`; use `HOST=127.0.0.1` in `.env` to restrict a local preview to this computer.

A phone must use a real, reachable HTTPS address. Do not scan a localhost QR on a different device and expect it to reach the computer. HTTPS is needed for the browser APIs used by the app, not merely for a lock icon.

## 2. A small HTTPS deployment with Docker

Prerequisites: a server reachable from both devices, Docker Engine with Compose, a DNS name pointing to that server, and inbound TCP ports 80/443 for web/TLS. Do not put it behind a static-only hosting service or a short-lived function. Both clients must reach the same live signaling process.

From the project root:

```sh
cp .env.example .env
# Edit .env and add: SHELF_DOMAIN=shelf.your-domain.com
# Add TURN configuration below before testing restrictive/different networks.
docker compose up -d --build
docker compose logs -f --tail=50 app
```

Open `https://shelf.your-domain.com` on both devices. The Compose service supplies `ALLOWED_ORIGINS` from `SHELF_DOMAIN`, forces production mode and leaves Node's port private. Caddy handles public TLS. It overwrites X-Forwarded-For, which is why this particular private app service can enable TRUST_PROXY.

Caddy streams `text/event-stream` responses immediately; do not configure a response buffer or short streaming timeout. See the upstream [reverse proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy). The provided configuration deliberately does not enable access logging.

**The Docker files are supplied but were not executed in the build environment.** Review image versions/digests and verify the compose stack on your server. Images use updateable major tags; pin reviewed image digests for a reproducible release and maintain a patch process. Preserve Caddy's data volume so certificates need not be reissued on every restart.

## 3. Configure a relay for blocked direct connections

STUN discovery is not enough when a network blocks peer-to-peer connectivity. Operate coturn or use a service that supports equivalent time-limited HMAC credentials. This app expects the coturn REST-secret scheme; it does not support an arbitrary provider's proprietary token API out of the box.

Generate a secret locally:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Use the same secret in your private coturn configuration and the app's `.env`:

```dotenv
TURN_URLS=turn:turn.your-domain.com:3478?transport=udp,turn:turn.your-domain.com:3478?transport=tcp,turns:turn.your-domain.com:5349?transport=tcp
TURN_SECRET=YOUR_GENERATED_SECRET
ICE_TRANSPORT_POLICY=all
```

`deploy/turnserver.conf.example` is an operator-edited starting template, not an auto-installed relay. Replace its domain, secret, certificate paths and any NAT mapping. Open the configured listener ports and relay UDP range in both host and cloud firewalls; the example range is 49160–49260. Do not proxy TURN through the HTTP Caddy configuration. Private egress and loopback/cloud-metadata destinations must stay blocked.

The template uses secret-based authentication, allocation limits and bandwidth limits. Review these against your network, traffic and budget. Reference: [coturn's official annotated configuration](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf). Protect certificates/secrets, control relay egress and keep logs/retention minimal. TLS TURN on a dedicated 443 endpoint may help some restrictive networks but needs a separate address or properly configured protocol routing; it is not included in the web-only Compose file.

Restart/recreate the app after changing environment configuration:

```sh
docker compose up -d --force-recreate app
```

### Verify the relay, not just credential generation

Temporarily set `ICE_TRANSPORT_POLICY=relay`, recreate the app, open new sessions on two actual devices on different networks, and transfer a file. The UI should show the secure-relay route. Verify the downloaded bytes and your relay's allocation/traffic metrics. Restore `all` for direct-first routing unless relay-only is your privacy policy. This public TURN/network test has **not** been performed as part of the supplied package.

## 4. Configuration reference

| Variable | Default / meaning |
| --- | --- |
| HOST | `0.0.0.0`; use loopback for a local private preview |
| PORT | `3000` |
| NODE_ENV | `development`; production requires HTTPS ALLOWED_ORIGINS |
| ALLOWED_ORIGINS | Comma-separated exact HTTPS origins in production; no trailing slash |
| TRUST_PROXY | `false`; true only behind an inaccessible-to-clients, header-overwriting trusted proxy |
| SESSION_TTL_SECONDS | `1800`; supported configured range 1–7200 |
| INVITE_TTL_SECONDS | `600`; supported range 1–1800, bounded by session expiry |
| MAX_SESSIONS | `2000`; a safety ceiling, not a measured capacity claim |
| MAX_FILE_BYTES | `2147483648`; browser limits can be lower |
| STUN_URLS | `stun:stun.cloudflare.com:3478`; comma-separated, or empty to disable |
| TURN_URLS | Empty until configured; comma-separated TURN/TURNS URLs |
| TURN_SECRET | Server-only HMAC shared secret matching coturn |
| ICE_TRANSPORT_POLICY | `all`; `relay` requires TURN configuration |
| SHELF_DOMAIN | Used by Compose/Caddy only, e.g. `shelf.example.com` |

Health check: `GET /healthz` returns a minimal status/version response, never live content or credentials.

## 5. Launch checklist

- Test physical iPhone/Safari and Android/Chrome against desktop browsers; Chromium mobile emulation alone is insufficient.
- Test both same-network and mobile-data-to-Wi-Fi scenarios, forced relay, network changes, rejected pairing, interrupted transfers, and receiver downloads.
- Validate TLS renewal, proxy streaming, origin rejection, rate limits, private app ports, TURN quotas/egress restrictions and budget alerts.
- Test realistic large files and concurrent sessions for your target hardware; do not advertise a 2 GiB success guarantee based on the configured ceiling.
- Audit accessibility with keyboard, screen reader, zoom, target-size and contrast checks; review Arabic copy and low-level error localization.
- Conduct a security review, add a private security contact, choose log retention, and review required operational/legal notices for the intended service.
- Monitor process health, memory, error rates and relay costs without logging filenames, text, links, tokens or invite secrets.

This version is single-instance. Deploying updates/restarting Node ends live pairings. Give users a maintenance notice; do not promise uninterrupted sessions across deploys. Shared room storage and distributed coordination are required before adding replicas.

## Troubleshooting

**Phone cannot open QR:** check the address; localhost is device-local. Use public/reachable HTTPS.

**Approval works but devices will not connect:** verify TURN credentials, listener/relay firewall ports, DNS, TLS certificates and browser WebRTC restrictions. Test forced relay and inspect browser diagnostics without publishing SDP or private addresses.

**All clients look rate-limited:** confirm the trusted proxy overwrites X-Forwarded-For and the Node port is private; do not blindly enable header trust.

**Pairing events arrive late:** remove proxy/CDN response buffering, verify event-stream support and idle timeouts. Long-lived responses must not be served from cache.

**Browser storage error:** remove completed items, lower file size or use another supported browser. Memory fallback is 128 MiB total.

**A closed/refreshed tab cannot resume:** expected for this version; start a new session. The implemented resume covers transient channel failure while both original tabs remain alive.
