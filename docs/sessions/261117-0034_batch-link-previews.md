# Batch capture and link previews

External drops preserve all files and usable web addresses. Sourcebook shows a placeholder for each item before writing, then displays saved files and indicates when previews are in progress.

Saved links get a local title and domain. Online enrichment follows the Linkbook prototype. YouTube provides the title and deterministic thumbnail. Defuddle provides other titles and cleaned article Markdown. Sourcebook prefers a usable explicit cover and then tries article images. It stores covers the browser can read as local derivatives, and displays online-only images when the site permits embedding but blocks cross-origin reads. Missing images leave the domain card usable.

Verified Defuddle and YouTube CORS responses from localhost. A Chrome smoke check with mocked providers verified a mixed five-item drop, immediate placeholders, Defuddle and YouTube titles, saved cover images and offline Quick Look.
