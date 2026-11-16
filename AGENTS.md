# Sourcebook 7

Read `docs/status.md` at startup. Sourcebook 5 is the reference for ported workflows. This app is a static, offline PWA.

- Preserve the compact Sourcebook UI and container queries.
- Keep the browser UI, named catalog operations and filesystem adapter separate.
- Keep authoritative state inside the selected library, preserve originals and avoid overwriting occupied destinations.
- Use disposable libraries in development and put disposable evidence under `test-artifacts/`. Build and smoke-test the affected workflows.
- Record substantive work under `docs/sessions/` and link it in `docs/status.md`. Use Europe/London time and `YYMMDD-HHmm` for new records and evidence.
- Install the version hook with `git config core.hooksPath .githooks` and stage the package manifest and lockfile together for version changes.
