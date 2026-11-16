export class Problem extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function component(name) {
  if (
    typeof name !== "string" ||
    !name ||
    name.length > 240 ||
    /[\\/<>:"|?*\x00-\x1f]/u.test(name) ||
    /[. ]$/.test(name) ||
    /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)
  )
    throw new Problem(400, "Choose a valid file or folder name.");
  return name;
}

export const relativeParts = (path) =>
  path ? path.split("/").map(component) : [];
export const nameOf = (path) => path.split("/").at(-1);
export const parentOf = (path) => path.split("/").slice(0, -1).join("/");
export const extensionOf = (name) => /.+(\.[^.]+)$/.exec(name)?.[1] ?? "";
export const inside = (path, folder) =>
  path === folder || path?.startsWith(folder + "/");
const missing = (error) => error.name === "NotFoundError";

export class LibraryFiles {
  constructor(root) {
    this.root = root;
  }

  async directory(path, create = false) {
    let handle = this.root;
    for (const part of relativeParts(path))
      handle = await handle.getDirectoryHandle(part, { create });
    return handle;
  }

  async file(path) {
    try {
      const directory = await this.directory(parentOf(path));
      return await (
        await directory.getFileHandle(component(nameOf(path)))
      ).getFile();
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }

  async json(path, fallback = null) {
    const file = await this.file(path);
    return file ? JSON.parse(await file.text()) : fallback;
  }

  async write(path, data, { fresh = false } = {}) {
    const directory = await this.directory(parentOf(path));
    const name = component(nameOf(path));
    if (fresh) {
      try {
        await directory.getFileHandle(name);
        throw new Problem(
          409,
          "The destination is occupied. The source was kept.",
        );
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
    const handle = await directory.getFileHandle(name, { create: true });
    const writer = await handle.createWritable();
    try {
      if (data instanceof Blob) await data.stream().pipeTo(writer);
      else {
        await writer.write(data);
        await writer.close();
      }
    } catch (error) {
      await writer.abort().catch(() => {});
      throw error;
    }
  }

  writeJSON(path, data, options) {
    return this.write(path, JSON.stringify(data, null, 2) + "\n", options);
  }

  async remove(path) {
    try {
      const directory = await this.directory(parentOf(path));
      await directory.removeEntry(nameOf(path));
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }

  async *entries(path) {
    yield* (await this.directory(path)).entries();
  }
}

export async function equalBytes(left, right) {
  if (!left || !right || left.size !== right.size) return false;
  const chunk = 1024 * 1024;
  for (let offset = 0; offset < left.size; offset += chunk) {
    const [a, b] = await Promise.all(
      [left, right].map(
        async (file) =>
          new Uint8Array(
            await file.slice(offset, offset + chunk).arrayBuffer(),
          ),
      ),
    );
    if (a.some((value, index) => value !== b[index])) return false;
  }
  return true;
}
