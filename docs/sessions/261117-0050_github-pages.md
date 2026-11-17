# GitHub Pages deployment

Sourcebook 7 publishes to the GitHub Pages path for `teodor-andonov/261116-2133_sourcebook-7-pwa`. An Actions workflow builds the static app on pushes to `main` and publishes only `dist/`.

The Pages base path determines the manifest ID and launch scope, service worker registration, app asset paths, and browser storage namespace. The local root build keeps its existing install identity and browser data. The Pages app can open a local library folder after the browser grants access for the GitHub Pages site.

A subpath Chrome smoke test verified the manifest and worker scope, a sibling cache, offline restart, offline share intake, and offline PDF rendering. Local builds continue to work at the root URL.
