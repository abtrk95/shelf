# Shelf interface — September UX update

## Principles

One temporary space between two devices. Keep sending and reading in the foreground; reveal connection details only when needed. Remove the account/installation marketing badge. Preserve the calm green identity, light and dark palettes, and English/Arabic support.

## Before pairing

Desktop shows the sender next to a QR/code card. Mobile uses a compact pairing card. Either device may queue content first. A header Connection control opens the same card in a native modal without duplicating form IDs. The invitation explains that anyone with its code can connect and send.

## After pairing

Valid QR/code invitations connect immediately. The full connection card and introductory guidance leave the primary layout on both screen sizes. A compact header pill identifies the other device and opens connection details, safety mark, expiry, retry, extension and session-ending controls. A short connected heading, compact sender and shelf replace the initial layout. Pairing closes the QR/connection dialog and returns to the top once, not on subsequent progress updates. Reconnection retains the compact workspace and queue.

## Receiving and reading

Valid offers start automatically within storage/protocol limits. The app does not automatically open links, write the clipboard or download to the operating system. Verified arrivals announce their status with a View shelf action.

Text/link cards are preview buttons. Their reader shows the complete original text, preserves whitespace, supports selection and bidirectional text, escapes markup and keeps Copy available below the scrolling content. Supported raster images open in a local blob-based preview. No remote previews or metadata fetches are introduced.

## Responsive design and accessibility

The connected layout is designed to put the sender above the fold at 390 by 844 pixels; the browser suite contains a check for this target. Touch controls use 40–44 pixel minimum sizes where possible. Desktop shortcut hints are hidden on touch/mobile layouts, including Help.

Native modal dialogs provide focus containment and Escape dismissal, with focus returned on close. Reader content scrolls independently with a visible focus target. Logical alignment and text direction support Arabic. Actual browser, screen-reader, zoom and accessibility validation remain pending as recorded in TEST_REPORT.md.

## Motion

No animation dependency. Use finite entrances, hover/press feedback, connection confirmation, new-card arrivals, a verified-delivery ring, smooth progress and modal entrance/exit transitions. Keyed reconciliation preserves existing cards, images and focus instead of remounting during progress. Continuing animation is restricted to real connecting/loading/transfer activity. CSS and Web Animations honor prefers-reduced-motion.

## Verification

See TEST_REPORT.md for executed checks and pending browser cases. Browser-test content is synthetic. Existing docs/screenshots captures belong to version 1.0 and are historical, not proof of the updated design.
