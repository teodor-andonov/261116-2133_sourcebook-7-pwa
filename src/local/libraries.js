import { LibraryFiles, Problem } from "./files.js";
import { Library } from "./library.js";
import { storageKey } from "./app-location.js";

const layout = [
  "files",
  "metadata",
  "thumbnails",
  "previews",
  "settings",
  "staging",
  "revisions",
];
const format = "settings/library.json";
const opened = new Map();
let database;

async function registry(mode, change) {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(storageKey("sourcebook-libraries"), 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("libraries", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("libraries", mode);
    const request = change(transaction.objectStore("libraries"));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

const mode = { mode: "readwrite" };
let recentHandles = new Map();

async function authorized(handle) {
  try {
    return (await handle.queryPermission(mode)) === "granted";
  } catch {
    return false;
  }
}

export async function libraryAuthorized(id) {
  const entry = recentHandles.get(id);
  return entry ? authorized(entry.handle) : false;
}

async function mount(handle, title) {
  const files = new LibraryFiles(handle);
  let info;
  if (title !== undefined) {
    for await (const entry of files.entries("")) {
      throw new Problem(409, "Choose an empty folder for a new library.");
    }
    for (const directory of layout) await files.directory(directory, true);
    info = {
      id: crypto.randomUUID(),
      title: title.trim() || handle.name,
      format: 1,
    };
    await files.writeJSON(format, info, { fresh: true });
  } else {
    info = await files.json(format);
    if (info?.format !== 1 || !info.id)
      throw new Problem(400, "Choose a Sourcebook 7 library folder.");
    await Promise.all(layout.map((directory) => files.directory(directory)));
  }
  let library = opened.get(info.id);
  if (!library) {
    library = new Library(files, info);
    await library.open();
    opened.set(info.id, library);
  } else if (!(await library.files.root.isSameEntry(handle))) {
    throw new Problem(
      409,
      "This library is already open from another folder in this app session.",
    );
  }
  const entry = { id: info.id, title: info.title, handle, used: Date.now() };
  recentHandles.set(info.id, entry);
  await registry("readwrite", (store) => store.put(entry));
  return { id: info.id, title: info.title };
}

export async function pickLibrary(title) {
  if (!window.showDirectoryPicker)
    throw new Problem(
      400,
      "Use Chrome or Edge with writable folder access to open a library.",
    );
  const handle = await window.showDirectoryPicker({
    id: "sourcebook-library",
    mode: "readwrite",
  });
  return mount(handle, title);
}

export async function loadRecent(checkPermission = true) {
  const entries = await registry("readonly", (store) => store.getAll());
  recentHandles = new Map(entries.map((entry) => [entry.id, entry]));
  return Promise.all(
    entries
      .sort((a, b) => b.used - a.used)
      .map(async ({ id, title, handle }) => ({
        id,
        title,
        authorized: checkPermission && (await authorized(handle)),
      })),
  );
}

export async function reopenLibrary(id, prompt = false) {
  const entry = recentHandles.get(id);
  if (!entry) throw new Problem(404, "Choose the library folder again.");
  const granted = prompt
    ? (await entry.handle.requestPermission(mode)) === "granted"
    : await authorized(entry.handle);
  if (!granted)
    throw new Problem(403, "Allow access or choose the library folder again.");
  const library = opened.get(id);
  if (library && (await library.files.root.isSameEntry(entry.handle)))
    return { id, title: entry.title };
  return mount(entry.handle);
}

export function libraryFor(id) {
  const library = opened.get(id);
  if (!library) throw new Problem(403, "Open the library before using it.");
  return library;
}
