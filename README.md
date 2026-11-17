# Sourcebook 7

Sourcebook is an offline PWA for organizing ordinary files in local library folders. The browser handles catalog operations and previews. The published app consists of static files.

## Run locally

Use Node.js 24 or newer.

```powershell
npm ci
npm run dev
```

To try installation, sharing or offline launch, run `npm run build` and then `npm run preview`. Open the URL Vite prints in Chrome or Edge and wait for **Offline ready** before disconnecting. The [published PWA](https://teodor-andonov.github.io/261116-2133_sourcebook-7-pwa/) is served by GitHub Pages. Install it from that address. If you already use a local library, choose **Open library** on the published app and select the same folder to grant access at the Pages address.

## Open a library

- **New library** initializes an empty folder. **Open library** attaches a Sourcebook 7 folder. Use the library button in the sidebar to switch. If the browser asks for permission again, use **Reopen** to grant access to the last library and resume queued shares.
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

## Publish

GitHub Actions publishes the static build after pushes to `main`. Local commits are kept local until a push is explicitly requested.

See [status](docs/status.md) for the latest verification.

## Saved link previews

Sourcebook saves pasted or dropped addresses locally first. With a connection, Sourcebook uses a site-specific image first, such as a YouTube video thumbnail or a direct public X image URL. Thum.io supplies a page screenshot for other public links, including ordinary X posts, and when a site-specific image fails. Defuddle looks up page titles, and YouTube’s title endpoint handles known videos. Sourcebook keeps a compact card when no cover is available and stores covers the image host lets it read. Use **Capture website screenshot** to request a screenshot directly or **Rebuild preview** to run the regular lookup on an existing link. Defuddle and Thum.io receive the public URL when their services are used.
