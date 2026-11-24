const limit = 512 * 1024;

function publicURL(value, base) {
  try {
    const url = new URL(value, base);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      host.includes(".") &&
      !/^(?:[\d.]+|.*\.(?:localhost|local|internal|lan|home|test|invalid))$/.test(
        host,
      )
    )
      return url;
  } catch {
    /* Only public web addresses are eligible for enrichment. */
  }
  return null;
}

export function basicLink(address, name) {
  const url = new URL(address);
  const domain = url.hostname.replace(/^www\./i, "");
  let slug = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
  try {
    slug = decodeURIComponent(slug);
  } catch {
    /* Keep the original path. */
  }
  slug = slug
    .replace(/\.(?:html?|php|aspx?)$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  const saved = name.replace(/\.(?:link|url|sblink)$/i, "");
  return {
    domain,
    title:
      saved && ![domain, url.hostname].includes(saved) ? saved : slug || domain,
  };
}

export function linkTitle({ title, domain }) {
  const suffix = " - " + domain;
  const clean = title.replace(/\s+/g, " ").trim();
  return clean.endsWith(suffix)
    ? clean.slice(0, 240)
    : clean.slice(0, Math.max(1, 240 - suffix.length)) + suffix;
}

export function youtubeId(url) {
  const host = url.hostname.replace(/^www\./i, "");
  let id;
  if (host === "youtu.be") id = url.pathname.split("/")[1];
  else if (host === "youtube.com" || host === "m.youtube.com") {
    id =
      url.pathname === "/watch"
        ? url.searchParams.get("v")
        : /^\/(?:shorts|live|embed)\/([^/]+)/.exec(url.pathname)?.[1];
  }
  return /^[\w-]{11}$/.test(id ?? "") ? id : "";
}

export function parseDefuddle(body) {
  const match = /^---\r?\n([\s\S]{0,20000}?)\r?\n---(?:\r?\n|$)/.exec(body);
  const fields = new Map();
  for (const line of (match?.[1] ?? "").split(/\r?\n/)) {
    const field = /^([\w-]+):\s*(.+)$/i.exec(line);
    if (!field) continue;
    const value = field[2].trim();
    let decoded = value;
    if (value.startsWith('"')) {
      try {
        decoded = JSON.parse(value);
      } catch {
        decoded = value.slice(1, -1);
      }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      decoded = value.slice(1, -1).replaceAll("''", "'");
    }
    if (typeof decoded === "string")
      fields.set(field[1].toLowerCase(), decoded);
  }
  return { title: fields.get("title") };
}

async function responseText(url) {
  const response = await fetch(url, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok || !response.body)
    throw new Error("Link lookup unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let result = "";
  let size = 0;
  try {
    while (size < limit) {
      const { value, done } = await reader.read();
      if (done) break;
      result += decoder.decode(value.subarray(0, limit - size), {
        stream: true,
      });
      size += value.byteLength;
    }
    return result + decoder.decode();
  } finally {
    void reader.cancel().catch(() => {});
  }
}

export async function lookupLink(address) {
  const url = publicURL(address);
  if (!url) return null;
  url.hash = "";
  const id = youtubeId(url);
  if (id) {
    const query = new URLSearchParams({
      url: "https://www.youtube.com/watch?v=" + id,
      format: "json",
    });
    let title;
    try {
      ({ title } = JSON.parse(
        await responseText("https://www.youtube.com/oembed?" + query),
      ));
    } catch {
      /* The thumbnail is still available by video ID. */
    }
    if (typeof title === "string" && title.trim())
      return { title, favicon: "https://www.youtube.com/favicon.ico" };
  }
  return {
    ...parseDefuddle(await responseText("https://defuddle.md/" + url.href)),
    favicon: new URL("/favicon.ico", url).href,
  };
}

export function nativeCoverURL(address) {
  const url = publicURL(address);
  if (!url) return null;
  const id = youtubeId(url);
  if (id) return "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg";
  if (
    url.protocol === "https:" &&
    url.hostname === "pbs.twimg.com" &&
    url.pathname.startsWith("/media/")
  ) {
    url.hash = "";
    return url.href;
  }
  return null;
}

export function screenshotURL(address) {
  const url = publicURL(address);
  if (!url) return null;
  url.hash = "";
  return "https://image.thum.io/get/width/960/crop/650/noanimate/" + url.href;
}

async function loadImage(url, cors, milliseconds) {
  const image = new Image();
  image.referrerPolicy = "no-referrer";
  if (cors) image.crossOrigin = "anonymous";
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(reject, milliseconds);
      image.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      image.onerror = () => {
        clearTimeout(timer);
        reject();
      };
      image.src = url;
    });
    return image;
  } catch {
    image.removeAttribute("src");
    return null;
  }
}

function coverBitmap(image) {
  const scale = Math.min(
    1,
    960 / Math.max(image.naturalWidth, image.naturalHeight),
  );
  return createImageBitmap(image, {
    resizeWidth: Math.round(image.naturalWidth * scale),
    resizeHeight: Math.round(image.naturalHeight * scale),
  });
}

function isThumBrowserError(image) {
  if (image.naturalWidth !== 960 || image.naturalHeight !== 520) return false;
  // Thum.io can return a Chromium network error as a successful PNG, with
  // no capture status exposed to the browser. Match the icon and heading,
  // above the URL-specific text, in the standard screenshot crop.
  const canvas = document.createElement("canvas");
  canvas.width = 240;
  canvas.height = 94;
  const context = canvas.getContext("2d");
  context.drawImage(image, 244, 156, 240, 94, 0, 0, 240, 94);
  const pixels = context.getImageData(0, 0, 240, 94).data;
  let hash = 2166136261;
  for (let index = 0; index < pixels.length; index += 4) {
    const dark = Number(pixels[index] < 180);
    hash = Math.imul(hash ^ dark, 16777619);
  }
  return (hash >>> 0) === 1908066656;
}

export async function chooseCover(covers, timeout = 3500) {
  const deadline = performance.now() + Math.max(7000, timeout);
  const load = (url, cors) => {
    const remaining = deadline - performance.now();
    return remaining > 0
      ? loadImage(url, cors, Math.min(timeout, remaining))
      : null;
  };
  for (const url of covers) {
    if (performance.now() >= deadline) break;
    const readable = await load(url, true);
    const image = readable ?? (await load(url, false));
    if (!image || image.naturalWidth < 160 || image.naturalHeight < 100)
      continue;
    if (readable) {
      try {
        return { bitmap: await coverBitmap(image) };
      } catch {
        /* Fall back to displaying the original image URL. */
      }
    }
    return { cover: url };
  }
  return {};
}

export async function resolveLinkCover(address, screenshot = false) {
  const native = screenshot ? null : nativeCoverURL(address);
  if (native) {
    const cover = await chooseCover([native]);
    if (cover.bitmap || cover.cover) return cover;
  }
  const fallback = screenshotURL(address);
  if (!fallback) return {};
  const image = await loadImage(fallback, true, 12000);
  if (!image || image.naturalWidth < 160 || image.naturalHeight < 100)
    return {};
  try {
    if (!isThumBrowserError(image)) return { bitmap: await coverBitmap(image) };
  } catch {
    /* Keep the existing preview when the screenshot cannot be checked. */
  }
  return {};
}
