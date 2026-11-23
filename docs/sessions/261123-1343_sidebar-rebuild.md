# Sidebar preview rebuild and link titles

The inspector's Rebuild preview button now runs on the current selection. It remains available when several files are selected regardless of which file supplies the inspector details. The Quick Look command still targets its open file.

An explicit link preview rebuild uses the fetched page title for the displayed Name, including for migrated shortcuts with a legacy title. Background enrichment retains its existing title rules. If no page title is returned, the rebuild does not force a title change. The inspector refreshes when the saved resource revision changes so it shows the updated name.

Built the PWA and smoke-tested the inspector in Chrome using a disposable migrated library. Two selected thumbnails rebuilt while a third stayed untouched. A mocked page-title response updated the migrated shortcut's result label, inspector Name, and stored metadata while retaining the original filename. The shortcut also opened offline. Evidence is under `test-artifacts/261123-1343_sidebar-rebuild`.
