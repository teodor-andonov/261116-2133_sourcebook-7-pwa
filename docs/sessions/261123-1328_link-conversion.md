# Migrated shortcuts and bulk preview rebuild

Converted 81 migrated Windows shortcuts in `261123_library` using the app's intake converter. The new `.link` files contain the normalized URL in angle brackets followed by a newline. Preserved resource IDs, folders, basenames, titles and link metadata. Updated each catalog path, filename extension and byte size. Verified that all thumbnail and preview files retained their SHA-256 hashes. The destination originals and pre-conversion metadata are backed up under `test-artifacts/261123-1328_link-conversion/destination-backup`.

Rebuild preview now uses the current selection from the More menu and file context menu. Quick Look still targets the open file. Verified both bulk menu paths in Chrome on a disposable copy by rebuilding two selected thumbnails and checking that a third stayed untouched. Confirmed that a converted shortcut preview opened after an offline reload. The PWA build passed.
