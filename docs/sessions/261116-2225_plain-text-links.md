# Plain-text link capture

Chromium rejects Windows Internet Shortcut names through native directory handles. New URL captures use ordinary `.link` text files containing a Markdown autolink. Quick Look opens the stored HTTP or HTTPS address and existing shortcut preview data remains readable. Windows shortcuts submitted for import show a message directing the user to paste the address.

The production build passed. A focused smoke check covered `.link` capture and preview, legacy shortcut parsing and the import message, rejection of unsafe schemes, and ordinary Markdown note capture.
