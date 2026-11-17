# Library reopen and website screenshots

Library startup checks access for the last opened folder. Opening reads metadata and operation receipts in bounded batches, loads settings and thumbnail names concurrently, and reuses handles during folder traversal. A foregrounded app rechecks folder access. If Chrome requires permission again, **Reopen** requests access to the remembered folder directly and resumes queued shares after access returns.

Thum.io supplies a screenshot when a public link has no usable cover from the existing providers. **Capture website screenshot** requests one directly. Screenshots the browser can read are saved as local preview derivatives. The requested public address is sent to Thum.io.

The production build passed. A Chrome smoke test covered simulated permission loss on return, queued share intake across a restart, a Thum.io fallback, and the screenshot action. A synthetic 64-file library with delayed sidecar reads opened with 16 concurrent reads. Thum.io returned a PNG with cross-origin read access for a public example URL. Android timing and native permission prompts still need a device check for this update.
