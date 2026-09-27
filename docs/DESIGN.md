# Design notes

## Identity

**Shelf — Your things. On your other device.** A calm system-like workspace, not a dashboard, messenger or cloud drive. The system-font stack avoids a font download and external requests. All icons and the shelf mark are original inline/vector assets.

The visual system uses warm off-white surfaces, dark forest text, a restrained green accent, hairline borders, a limited elevation scale, and generous spacing. The CSS custom properties at the beginning of `public/styles.css` are the source of truth. Light and dark palettes have independent surface/text tokens.

## Hierarchy

Desktop: header/navigation → succinct two-line promise → content drop area beside a pairing card → shared shelf → short guidance/footer. The pairing card becomes the two-device connection bridge after approval, keeping connectivity in the same location.

Mobile: headline → compact pairing surface → content actions → shelf; the bottom action bar keeps Files, Text, and Connect within reach. The large QR expands into a dedicated dialog when needed. Incoming-item notifications include a View shelf action so acceptance is not hidden below the fold.

## Deliberate states

1. Starting / insecure-context / unsupported-browser / service failure.
2. Waiting with real invitation, expiry and entry-code alternative.
3. Join submission, awaiting owner, owner approval, decline and timeout.
4. Connecting, verified connection, actual route display, connection failure and retry.
5. Queued content, incoming acceptance, preparing storage, transfer progress and verification.
6. Completed delivery with relevant open, copy, save, image preview and item details.
7. Paused/reconnecting, error with retry, decline, cancel, removed content, ended/expired session.

No fake preview items, random fake progress, fabricated transfer speeds, silent auto-opened links or automatically accepted downloads are used. The completion state reflects a real remote integrity acknowledgement.

## Interaction

Content can be added before pairing. Files may be selected, dropped or pasted where supported. N opens text entry, J opens code entry, Cmd/Ctrl+O chooses files and ordinary paste adds content. Inputs and dialogs retain their expected text-editing behavior. Dialogs use the native modal element; destructive session ending needs confirmation. Focus outlines and reduced motion are explicitly styled.

File/text/link cards explain direction and status. New content stays visible in a filterable grid/list. The connection mark and route are available without making cryptographic terminology the main interface. Original files are never silently converted.

## Accessibility and localization

Use semantic buttons, labeled inputs, live status announcements, title/description relationships, keyboard focus, contrast-conscious palettes and responsive widths. The automated suite checks 320/390/768/1024/1440-pixel layouts and Arabic RTL overflow. Native dialogs supply modal focus behavior. Motion respects prefers-reduced-motion. Formal screen-reader, contrast, target-size and linguistic audits remain launch work, not certified claims.

## Screenshots

`docs/screenshots/` contains actual Chromium renders from the implemented app, including an empty desktop workspace, mobile workspace, approval prompt, connected/received content, and dark Arabic layout. QR invitations in those historical screenshots are temporary test invitations, not a hosted service.
