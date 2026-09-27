from pathlib import Path
r=Path('.')
changes={
 'README.md':{
  'explicitly approve and receive content on the other device.':'connect immediately and receive content automatically on the other device.',
  'explicit connection approval, cancellation and rejection':'automatic pairing, single-use invitations, atomic two-device rooms',
  'Per-item approval, decline, cancel, verified delivery, copy/open/download, supported native sharing and safe image previews':'Automatic bounded receiving, cancel, verified delivery, full-text reader, copy/open/download, native sharing and safe image previews',
  'rate limits, approval gates, bounded messages':'rate limits, single-use invitations, bounded receiving',
  '3. Approve the named device. Device names are user-chosen labels, not verified identities.':'3. The two devices connect immediately. Treat the code as permission to connect; only share it with devices you trust.',
  '4. Accept each incoming item. Delivery becomes complete only after integrity verification.':'4. Incoming items arrive automatically. Delivery becomes complete only after integrity verification. Tap text or image previews to view them fully; saving files and opening links remain explicit actions.',
 },
 'SECURITY.md':{
  'Pairing and incoming transfers require separate explicit approval.':'Possession of an unexpired invitation authorizes immediate pairing. Paired devices automatically receive items, subject to protocol, file-size, item-count and cumulative storage limits. Do not expose invitation codes publicly.',
 },
 'docs/ARCHITECTURE.md':{
  'pending approvals, ':'',
  'Joining never silently establishes a peer connection: the host approves the joining device first.':'Joining with a valid code or QR secret immediately claims the two-device room. Both invitations are consumed atomically before signaling; there is no additional approval step.',
  'short expiry, join rate limits and approval;':'short expiry, per-address and per-session join rate limits and single-use consumption;',
  'The security design does not rely on the short code alone.':'The short code is a bearer invitation, not authentication of a person. Keep it private and end the session to revoke the connection.',
  'offer → receiver explicitly accepts → accept(offset)':'offer → validate limits and reserve storage automatically → accept(offset)',
  'Every transfer is separately accepted.':'Every valid offer is automatically accepted after storage and protocol checks. Total retained received content is capped at the browser storage mode budget (2 GiB disk or 128 MiB memory); removing items frees capacity.',
 },
 'docs/DEPLOYMENT.md':{
  'rejected pairing':'invalid/expired pairing invitations',
  '**Approval works but devices will not connect:**':'**Pairing works but devices will not connect:**',
 },
 'docs/KNOWN_LIMITATIONS.md':{
  'auto-receive, ':'',
 }
}
for name,replacements in changes.items():
 p=r/name;s=p.read_text()
 for old,new in replacements.items():
  assert old in s,(name,old)
  s=s.replace(old,new)
 p.write_text(s)
p=r/'docs/DESIGN.md'
p.write_text('''# Shelf interface — version 1.1

## Principles

One temporary space between two devices. Keep sending and reading in the foreground; reveal connection details only when needed. No account/installation marketing badge in the interface. Keep the existing calm green identity, light and dark palettes, and English/Arabic support.

## Before pairing

Desktop shows the sender next to a QR/code card. Mobile shows a compact pairing card. Either device may queue content first. A header Connection control opens the same card in a native modal without duplicating form IDs. The invitation explains that anyone with its code can connect and send.

## After pairing

Valid QR/code invitations connect immediately; no approval prompt. The full pairing card and introductory guidance leave the primary layout on both screen sizes. A compact header pill shows the other device and opens connection details, safety mark, expiry, retry, extension and session-ending controls. Closing returns focus to the opener. A short connected heading, compact sender and shared shelf replace the initial layout. Pairing closes the QR/connection dialog and returns to the top once, not on subsequent progress events. Reconnection preserves the compact layout and queued content.

## Receiving and reading

Valid offers start automatically within storage and protocol limits. The app never automatically opens a link, writes the clipboard or downloads to the system Downloads folder. Saving, copying and opening remain explicit. Verified arrivals announce their status with a View shelf action.

Text/link cards are native preview buttons. A scrollable reader shows the complete original text, preserves whitespace, supports selection and bidirectional text, escapes markup and keeps Copy accessible at the bottom. Safe raster images open in a local blob-based preview. No remote URL previews or metadata fetches are introduced.

## Mobile and accessibility

The connected sender is visible without scrolling at a 390 × 844 viewport. Touch controls are at least 40–44 pixels where space permits; desktop keyboard hints are absent on touch/mobile layouts, including Help. Native dialogs provide modal focus containment and Escape dismissal; focus returns after closing. Reader content has independent scrolling, a labeled region and visible focus. Long content never expands the page horizontally. Formal screen-reader and real iOS Safari validation remain separate release work.

## Motion

No animation dependency. Finite entrance transitions, hover/press feedback, a connection-confirmation pulse, new-card arrivals, a verified-delivery ring, smooth progress and modal entrance/exit motion. Keyed DOM reconciliation preserves existing cards, image elements, focus and running transfer state rather than remounting them on progress updates. Continuous motion is restricted to real connecting/loading states. CSS and Web Animations both honor prefers-reduced-motion.

## Verification

See CI runs and docs/TEST_REPORT.md for completed checks. Screenshots generated by the version 1.1 browser suite use synthetic content. Existing docs/screenshots images belong to version 1.0 and are historical, not current UI references.
''')
p=r/'docs/TEST_REPORT.md';s=p.read_text();s='# Version 1.1 verification\n\n54 unit/protocol/security checks pass in the implementation workspace. Real-browser validation runs in GitHub Actions; see the associated successful run for results and screenshots. The local managed Chromium blocks navigation, so no local browser pass is claimed for version 1.1.\n\n---\n\n## Historical version 1.0 report\n\n'+s;p.write_text(s)
p=r/'e2e/conftest.py';s=p.read_text().replace('def contexts(browser):','def contexts(browser, request):')
s=s.replace('    for context in created:\n        context.close()', '''    for index, context in enumerate(created):
        if getattr(request.node, 'rep_call', None) and request.node.rep_call.failed:
            for number, page in enumerate(context.pages):
                try:
                    folder = ROOT / 'test-results'
                    folder.mkdir(exist_ok=True)
                    page.screenshot(path=str(folder / f'failure-{request.node.name}-{index}-{number}.png'), full_page=True)
                except Exception:
                    pass
        context.close()''')
s+='''\n@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    setattr(item, 'rep_' + report.when, report)
''';p.write_text(s)
