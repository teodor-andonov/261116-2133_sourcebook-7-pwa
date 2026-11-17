import { describeFile } from "../core/file-types.js";

const limit = 128 * 1024;
let pdfModule;

async function pdf() {
  if (!pdfModule) {
    pdfModule = Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]).then(([module, worker]) => {
      module.GlobalWorkerOptions.workerSrc = new URL(
        worker.default,
        globalThis.location.origin,
      ).href;
      return module;
    });
  }
  return pdfModule;
}

export function scaled(width, height, max) {
  const ratio = Math.min(1, max / Math.max(width, height));
  return new OffscreenCanvas(
    Math.max(1, Math.round(width * ratio)),
    Math.max(1, Math.round(height * ratio)),
  );
}

function card(title, second = "", content = "") {
  const canvas = new OffscreenCanvas(960, 600);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#27282d";
  ctx.fillRect(0, 0, 960, 600);
  ctx.fillStyle = "#a7afc7";
  ctx.font = "24px system-ui";
  ctx.fillText(second, 54, 82, 850);
  ctx.fillStyle = "#f4f5f9";
  ctx.font = "42px system-ui";
  ctx.fillText(title, 54, 155, 850);
  ctx.fillStyle = "#c3c5ce";
  ctx.font = "24px monospace";
  content
    .split("\n")
    .slice(0, 10)
    .forEach((line, index) =>
      ctx.fillText(line.slice(0, 110), 54, 220 + index * 32, 850),
    );
  return canvas;
}

async function readText(file, type) {
  const cap = type === "link" ? 8192 : limit;
  const text = await file.slice(0, cap).text();
  if (text.includes("\0")) return {};
  if (type !== "link") return { text, truncated: file.size > cap };
  try {
    const trimmed = text.trim();
    const address =
      /^\s*URL\s*=\s*(.+)$/im.exec(text)?.[1]?.trim() ||
      /^<(https?:\/\/[^<>\s]+)>$/i.exec(trimmed)?.[1] ||
      trimmed;
    const url = new URL(address);
    if (file.size <= cap && ["http:", "https:"].includes(url.protocol))
      return {
        url: url.href,
        title: /^\s*TITLE\s*=\s*(.+)$/im.exec(text)?.[1]?.trim(),
        card: true,
      };
  } catch {
    /* Use a file card for invalid shortcuts. */
  }
  return { text, truncated: file.size > cap };
}

async function renderPDF(file, page) {
  const { getDocument } = await pdf();
  const assets = new URL(
    import.meta.env.BASE_URL + "pdf/",
    globalThis.location.origin,
  );
  const task = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
    useSystemFonts: true,
    useWorkerFetch: true,
    cMapPacked: true,
    cMapUrl: new URL("cmaps/", assets).href,
    standardFontDataUrl: new URL("standard_fonts/", assets).href,
    wasmUrl: new URL("wasm/", assets).href,
  });
  try {
    const doc = await task.promise;
    const item = await doc.getPage(page);
    const initial = item.getViewport({ scale: 1 });
    const viewport = item.getViewport({
      scale: Math.min(3, 1600 / Math.max(initial.width, initial.height)),
    });
    const canvas = new OffscreenCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    await item.render({
      canvas,
      canvasContext: canvas.getContext("2d"),
      viewport,
    }).promise;
    return { canvas, pages: doc.numPages };
  } finally {
    await task.destroy();
  }
}

export async function renderDerivatives(file, name, page, frame) {
  const { type, ext } = describeFile(name);
  let canvas;
  let pages = 1;
  let text;
  try {
    if (frame) {
      canvas = scaled(frame.width, frame.height, 1600);
      canvas
        .getContext("2d")
        .drawImage(frame, 0, 0, canvas.width, canvas.height);
    }
    if (type === "image" && ext !== "svg") {
      const bitmap = await createImageBitmap(file);
      try {
        canvas = scaled(bitmap.width, bitmap.height, 1600);
        canvas
          .getContext("2d")
          .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      } finally {
        bitmap.close();
      }
    }
    if (type === "pdf") ({ canvas, pages } = await renderPDF(file, page));
    if (["text", "code", "html", "link"].includes(type))
      text = await readText(file, type);
  } catch {
    // A derivative can always fall back to the filename card.
  } finally {
    frame?.close();
  }
  const label = text?.url
    ? new URL(text.url).hostname
    : ext.toUpperCase() || type;
  canvas ??= card(text?.title || name, label, text?.url || text?.text);
  const small = scaled(canvas.width, canvas.height, 320);
  small.getContext("2d").drawImage(canvas, 0, 0, small.width, small.height);
  const [image, thumbnail] = await Promise.all([
    canvas.convertToBlob({ type: "image/webp", quality: 0.86 }),
    small.convertToBlob({ type: "image/webp", quality: 0.8 }),
  ]);
  return { image, thumbnail, pages, text };
}
