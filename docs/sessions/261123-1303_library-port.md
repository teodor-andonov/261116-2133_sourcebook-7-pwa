# Sourcebook 5 library migration

On 23 November 2026, converted the Sourcebook 5 library `lib-01.sb` on LAPTOPSERVER to Sourcebook 7 format 1 in `C:\Users\andon\t\hub\b-cabinet\261021_notebooks\261123_library`. Opened the source SQLite catalog read-only and confirmed it had no unfinished operations.

Preserved 104 originals and their IDs, folder paths, names, titles, notes, timestamps, revisions, 34 tag records, 26 tag assignments, view settings, ID counters and six archived Markdown revisions. Copied 81 cached shortcut previews and generated the other 23 previews with Sourcebook 7. Excluded Windows thumbnail caches, the legacy quick-look cache and completed job receipts.

Built the PWA and opened the converted copy in Chrome using a disposable browser filesystem. Verified the 104-entry count before and after an offline reload, a shortcut preview offline and PDF preview page counts of 17 and 32. Copied the verified library into the empty destination with exclusive file creation and verified SHA-256 hashes for all 543 copied files. The conversion and smoke-test evidence is under `test-artifacts/261123-1303_library-port`.
