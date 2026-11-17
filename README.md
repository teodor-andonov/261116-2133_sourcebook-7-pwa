# Sourcebook 7

Sourcebook is an offline PWA for organizing ordinary files in local library folders. The browser handles catalog operations and previews. The published app consists of static files.

## Run locally

Use Node.js 24 or newer.

```powershell
npm ci
npm run dev
```

To try installation, sharing or offline launch, run `npm run build` and then `npm run preview`. Open the URL Vite prints in Chrome or Edge and wait for **Offline ready** before disconnecting. For access from another device, serve `dist/` at the root of a dedicated HTTPS origin. Keep that origin stable so the installed app and saved folder permissions continue to work. Serve `.js` and `.mjs` as JavaScript and `.wasm` as WebAssembly.

## Open a library

- **New library** initializes an empty folder. **Open library** attaches a Sourcebook 7 folder. Use the library button in the sidebar to switch or reauthorize access.
- Add files from Sourcebook, or put them in `files/` and click **Refresh** to assign IDs in place. Files copied to `staging/` appear in **Drop Inbox** after Refresh and can be processed into a folder.
- For an external move, leave the timestamp filename and extension intact and click **Refresh**. If the filename changed, find the missing entry under **Needs attention** and use **Relink original** after Refresh adopts the renamed file.
- Paste a web address to save it as a plain-text `.link` file containing a Markdown autolink. Quick Look shows the address offline, and following it opens a browser tab. Use **Retry** in **Needs attention** to recover failed Windows shortcuts that contain an HTTP or HTTPS address.

## Library layout

| Directory | Contents |
| --- | --- |
| `files/` | Originals, grouped in regular folders and named with UTC timestamp IDs and their original extensions. |
| `metadata/` | One JSON file per resource, including the original filename, display name, notes, tags and revisions. |
| `thumbnails/` | Small images loaded as results enter view. |
| `previews/` | Quick Look images and readable preview data. Additional PDF pages use an ID plus a page suffix. |
| `settings/` | Format version, library identity, allocation counters, tags, views and workspace state. |
| `staging/` | Drop Inbox, operation receipts and temporary originals for interrupted work. |
| `revisions/` | Earlier Markdown file bytes. |

The folder is the library. Browser storage keeps folder permissions and temporary drafts. Current library format is **1**. Only open existing Sourcebook 7 libraries with this app.

See [status](docs/status.md) for the latest verification.

## Saved link previews

Sourcebook saves pasted or dropped addresses locally first. With a connection, it looks up public page titles and covers using Defuddle. YouTube videos use YouTube’s title endpoint and thumbnail. The app shows the page title and domain, keeps a compact card when no cover is available, and stores covers that the image host lets it read. Other cover images can display while online. Defuddle receives the public URL for lookup. Use **Rebuild preview** to enrich an existing link or retry an unavailable cover.
