let database;

function open() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("sourcebook-7-intake", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("drafts", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error) => {
    database = null;
    throw error;
  });
  return database;
}

async function transact(mode, operation) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("drafts", mode);
    const request = operation(tx.objectStore("drafts"));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error ?? new Error("Intake storage failed."));
  });
}

export const readDrafts = () => transact("readonly", (store) => store.getAll());
export const putDraft = (draft) =>
  transact("readwrite", (store) => store.put(draft));
export const deleteDraft = (id) =>
  transact("readwrite", (store) => store.delete(id));

function linkFile(address, title) {
  return new File(["<" + address + ">\n"], title + ".link", {
    type: "text/plain",
  });
}

export async function portableLinkFile(file) {
  if (!/\.url$/i.test(file.name)) return file;
  if (file.size <= 8192) {
    const text = await file.text();
    const address = /^[ \t]*URL[ \t]*=[ \t]*([^\r\n]+)/im
      .exec(text)?.[1]
      ?.trim();
    if (address && /^https?:\/\/\S+$/i.test(address)) {
      let url;
      try {
        url = new URL(address);
      } catch {
        /* Leave invalid shortcuts in Needs attention. */
      }
      if (url)
        return linkFile(url.href, file.name.slice(0, -4) || url.hostname);
    }
  }
  throw new Error(
    "This shortcut has no valid HTTP or HTTPS address. Paste the address to save it as a .link file.",
  );
}

export function captureEntries({
  text = "",
  uriList = "",
  files = [],
  title = "",
} = {}) {
  const trimmed = text.trim();
  const prose = trimmed && !/^https?:\/\/\S+$/i.test(trimmed);
  const direct = (prose ? "" : uriList)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const possible = text.trim() || (files.length === 1 ? files[0].name : "");
  if (!direct.length && /^https?:\/\/\S+$/i.test(possible))
    direct.push(possible);
  const links = [
    ...new Set(
      direct
        .map((value) => {
          try {
            const url = new URL(value);
            if (url.protocol === "http:" || url.protocol === "https:")
              return url.href;
          } catch {}
          return "";
        })
        .filter(Boolean),
    ),
  ];
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map(({ type, value }) => [type, value]),
  );
  const date =
    parts.year + parts.month + parts.day + "-" + parts.hour + parts.minute;
  const name = title
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .trim()
    .slice(0, 120);
  const realFiles = files.filter(
    (file) =>
      !links.length ||
      (!/\.(url|download)$/i.test(file.name) && file.name !== possible),
  );
  if (links.length && realFiles.length === 0)
    return links.map((link) =>
      linkFile(link, name || new URL(link).hostname || "Link"),
    );
  if (realFiles.length) return realFiles;
  if (!trimmed) return [];
  const file = new File([text], (name || date) + ".md", {
    type: "text/markdown",
  });
  if (!name) file.unnamedNote = true;
  return [file];
}

export function makeDraft(file, catalog = null) {
  return {
    id: crypto.randomUUID(),
    catalog,
    file,
    unnamedNote: file?.unnamedNote === true,
    time: Date.now(),
    error: "",
  };
}
