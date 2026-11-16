import { describeFile } from "../core/file-types.js";
import { normalizeTags, queryRows } from "../core/model.js";
import { rewriteQueryPath } from "../core/query-language.js";
import { writePreset, writeView } from "../core/saved-views.js";
import { groupRows } from "../core/workspace.js";
import {
  component,
  equalBytes,
  extensionOf,
  inside,
  nameOf,
  parentOf,
  Problem,
} from "./files.js";
import { makeDerivatives } from "./previews.js";

const idPattern = /^\d{6}-\d{6}-\d{4}$/;
const settingsPath = "settings/catalog.json";
const receiptPath = (id) => "staging/" + id + ".job.json";
const sidecar = (id) => "metadata/" + id + ".json";
const thumbnail = (id) => "thumbnails/" + id + ".webp";
const preview = (id) => "previews/" + id + ".webp";
const textPreview = (id) => "previews/" + id + ".json";
const markdownLimit = 1024 * 1024;
const isMarkdown = (name) => /\.m(?:d|arkdown)$/i.test(name);

function ensureTagBranch(tags, path) {
  const parts = path.split("/");
  let tag;
  for (let index = 1; index <= parts.length; index++) {
    const branch = parts.slice(0, index).join("/");
    tag = tags.find((item) => item.path.toLowerCase() === branch.toLowerCase());
    if (!tag) {
      tag = { id: crypto.randomUUID(), path: branch };
      tags.push(tag);
    }
  }
  return tag.id;
}
const finished = (job) => ["done", "cancelled"].includes(job.phase);
const noteDate = (date) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/London",
    dateStyle: "short",
    timeStyle: "short",
  })
    .format(date)
    .replace(/[-:]/g, "")
    .replace(" ", "-")
    .slice(2);

export class Library {
  constructor(files, info) {
    this.files = files;
    this.info = info;
    this.rows = new Map();
    this.jobs = new Map();
    this.locations = new Map();
    this.folders = new Set();
    this.inbox = [];
    this.ready = new Set();
    this.previewJobs = new Map();
    this.previewFailures = new Set();
    this.previewQueue = Promise.resolve();
    this.queue = Promise.resolve();
  }

  write(operation) {
    const task = this.queue.then(() => {
      const locks = globalThis.navigator?.locks;
      return locks
        ? locks.request("sourcebook:" + this.info.id, operation)
        : operation();
    });
    this.queue = task.catch(() => {});
    return task;
  }

  async open() {
    return this.write(async () => {
      this.config = await this.files.json(settingsPath, {});
      this.workspace = await this.files.json("settings/workspace.json", {});
      await this.loadIndex();
      for await (const [name, handle] of this.files.entries("staging")) {
        if (handle.kind !== "file" || !name.endsWith(".job.json")) continue;
        const job = JSON.parse(await (await handle.getFile()).text());
        if (name === job.id + ".job.json") this.jobs.set(job.id, job);
      }
      for (const job of this.jobs.values())
        if (!finished(job) && !job.error && job.phase !== "awaiting-upload")
          await this.execute(job);
      await this.scan();
      for (const id of this.locations.keys())
        if (!this.ready.has(id)) this.generate(id);
    });
  }

  async loadIndex() {
    const rows = new Map();
    const ready = new Set();
    for await (const [name, handle] of this.files.entries("metadata")) {
      if (
        handle.kind !== "file" ||
        !name.endsWith(".json") ||
        !idPattern.test(name.slice(0, -5))
      )
        continue;
      const record = JSON.parse(await (await handle.getFile()).text());
      if (record.id + ".json" === name) rows.set(record.id, record);
    }
    for await (const [name, handle] of this.files.entries("thumbnails")) {
      if (handle.kind === "file" && name.endsWith(".webp"))
        ready.add(name.slice(0, -5));
    }
    this.rows = rows;
    this.ready = ready;
  }

  async *originals(folder = "") {
    for await (const [name, handle] of this.files.entries(
      folder ? "files/" + folder : "files",
    )) {
      const path = [folder, name].filter(Boolean).join("/");
      if (handle.kind === "directory") {
        this.folders.add(path);
        yield* this.originals(path);
      } else yield ["files/" + path, handle];
    }
  }

  async scan() {
    const found = new Map();
    const untracked = [];
    const owned = new Set();
    this.folders.clear();
    for (const job of this.jobs.values()) {
      if (finished(job)) continue;
      owned.add(job.source);
      owned.add(job.destination);
    }
    for await (const [path, handle] of this.originals()) {
      const name = nameOf(path);
      const id = name.slice(0, name.length - extensionOf(name).length);
      if (idPattern.test(id)) {
        const matches = found.get(id) ?? [];
        found.set(id, [...matches, path]);
      } else if (!owned.has(path)) untracked.push([path, handle]);
    }
    this.locations = new Map();
    for (const [id, paths] of found) {
      const row = this.rows.get(id);
      if (paths.length !== 1) {
        if (paths.includes(row?.path)) this.locations.set(id, row.path);
        continue;
      }
      const [path] = paths;
      if (row?.path === path) this.locations.set(id, path);
      if (owned.has(path) || row?.path === path) continue;
      if (row) await this.saveRow({ ...row, path, revision: row.revision + 1 });
      else {
        const original = await this.files.file(path);
        if (!original) continue;
        await this.saveRow(this.newRow(id, nameOf(path), path, original.size));
        this.generate(id);
      }
      this.locations.set(id, path);
    }
    const ids = await this.reserve(untracked.length);
    for (const [index, [path, handle]] of untracked.entries()) {
      const file = await handle.getFile();
      await this.start({
        kind: "adopt",
        resource: ids[index],
        source: path,
        name: file.name,
        folder: parentOf(path).slice(6),
        expected: file.size,
      });
    }
    this.inbox = [];
    for await (const [name, handle] of this.files.entries("staging")) {
      if (
        handle.kind === "file" &&
        !name.endsWith(".job.json") &&
        !name.endsWith(".part")
      )
        this.inbox.push({ name, size: (await handle.getFile()).size });
    }
  }

  settings() {
    return {
      ...this.config,
      ...this.info,
      workspace: this.workspace,
      tagIdentity: Object.fromEntries(
        this.tags().map(({ id, path }) => [path.toLowerCase(), id]),
      ),
    };
  }

  async saveSettings(config) {
    await this.files.writeJSON(settingsPath, config);
    this.config = config;
    return this.settings();
  }

  async changeSettings(body) {
    const next = { ...this.config, ...body };
    if (body.captureFolder === null) delete next.captureFolder;
    if (body.captureFolder)
      await this.files.directory("files/" + body.captureFolder);
    return this.saveSettings(next);
  }

  async view(kind, id, body) {
    let pending = structuredClone(this.config);
    const store = {
      settings: () => pending,
      saveSettings: (config) => {
        pending = config;
      },
      tagId: (path) =>
        this.tags().find((tag) => tag.path.toLowerCase() === path.toLowerCase())
          ?.id,
      directory: (folder) => {
        if (folder && !this.folders.has(folder))
          throw new Problem(404, "Folder unavailable.");
      },
    };
    const result =
      kind === "preset"
        ? writePreset(store, body)
        : writeView(store, id, body, { remove: kind === "remove" });
    await this.saveSettings(pending);
    return kind === "preset" ? this.settings() : result;
  }

  tags() {
    return this.config.tags ?? [];
  }

  tagPaths(row) {
    return row.tagIds
      .map((id) => this.tags().find((tag) => tag.id === id)?.path)
      .filter(Boolean);
  }

  async ensureTags(paths) {
    const tags = this.tags().slice();
    const ids = normalizeTags(paths).map((path) => ensureTagBranch(tags, path));
    if (this.tags().length !== tags.length)
      await this.saveSettings({ ...this.config, tags });
    return ids;
  }

  async changeTag({ path, rename, pinned, before }) {
    if (typeof pinned === "boolean") await this.ensureTags([path]);
    const tags = structuredClone(this.tags());
    const tag = tags.find(
      (item) => item.path.toLowerCase() === path.toLowerCase(),
    );
    if (!tag) throw new Problem(404, "Tag not found.");
    let config = { ...this.config, tags };
    if (typeof pinned === "boolean") tag.pinned = pinned;
    if (rename !== undefined) {
      const [replacement] = normalizeTags([rename]);
      if (
        !replacement ||
        replacement.toLowerCase().startsWith(path.toLowerCase() + "/")
      )
        throw new Problem(400, "Choose a different tag path.");
      const change = (value) =>
        inside(value.toLowerCase(), path.toLowerCase())
          ? replacement + value.slice(path.length)
          : value;
      for (const item of tags) item.path = change(item.path);
      if (
        new Set(tags.map((item) => item.path.toLowerCase())).size !==
        tags.length
      )
        throw new Problem(409, "The destination tag already exists.");
      const parent = parentOf(replacement);
      if (parent) ensureTagBranch(tags, parent);
      config = this.rewriteSettings(config, "tag", change);
    }
    if (before !== undefined) {
      tags.splice(tags.indexOf(tag), 1);
      const at =
        before === null
          ? tags.length
          : tags.findIndex((entry) => entry.path === before);
      tags.splice(at < 0 ? tags.length : at, 0, tag);
    }
    return this.saveSettings(config);
  }

  rewriteSettings(config, field, change, removed) {
    const rewrite = (values) =>
      values?.search
        ? { ...values, search: rewriteQueryPath(values.search, field, change) }
        : values;
    return {
      ...config,
      viewDefault: rewrite(config.viewDefault),
      views: (config.views ?? []).map((view) =>
        view.where?.scope === field
          ? {
              ...view,
              where: { ...view.where, [field]: change(view.where[field]) },
              ...(removed?.(view.where[field]) ? { unavailable: true } : {}),
            }
          : view,
      ),
      viewPresets: Object.fromEntries(
        Object.entries(config.viewPresets ?? {}).flatMap(([key, preset]) => {
          if (field === "folder" && key.startsWith("folder:")) {
            const path = key.slice(7);
            if (removed?.(path)) return [];
            key = "folder:" + change(path);
          }
          return [[key, { ...preset, values: rewrite(preset.values) }]];
        }),
      ),
    };
  }

  presentation(row) {
    const available = this.locations.has(row.id);
    const file = describeFile(row.originalName);
    return {
      key: row.id,
      id: row.id,
      title: row.title,
      name: row.originalName,
      folder: parentOf(row.path).slice(6),
      source: "files",
      sourceName: "Files",
      type: file.type,
      icon: file.icon,
      extension: file.ext,
      color: file.color,
      available,
      object: true,
      notes: row.notes,
      tags: this.tagPaths(row),
      size: row.size,
      modified: row.created,
      revision: row.revision,
      contentRevision: row.contentRevision,
      previewVersion: String(row.contentRevision),
      previewToken: String(this.previewTokens?.get(row.id) ?? ""),
      preview: available && this.ready.has(row.id),
      previewStatus: this.previewJobs.has(row.id)
        ? "pending"
        : this.previewFailures.has(row.id)
          ? "failed"
          : this.ready.has(row.id)
            ? "ready"
            : "",
      markdown: isMarkdown(row.originalName) && row.size <= markdownLimit,
    };
  }

  pendingJobs() {
    return [...this.jobs.values()].filter(
      (job) => !finished(job) && job.phase !== "awaiting-upload",
    );
  }

  activity(ids) {
    return {
      previews:
        ids?.split(",").flatMap((id) => {
          const row = this.rows.get(id);
          return row ? [this.presentation(row)] : [];
        }) ?? [],
      jobs: this.pendingJobs(),
      previewPending: this.previewJobs.size > 0,
    };
  }

  async browse(options) {
    if (options.refresh === "1")
      await this.write(async () => {
        await this.loadIndex();
        await this.scan();
        for (const id of this.locations.keys())
          if (!this.ready.has(id)) this.generate(id);
      });
    const rows = [...this.rows.values()].map((row) => this.presentation(row));
    let results;
    try {
      results = queryRows(rows, {
        ...options,
        recursive: options.recursive === "1",
        desc: options.desc === "1",
        scope: options.scope === "missing" ? "unavailable" : "all",
      });
    } catch (error) {
      throw new Problem(400, error.message);
    }
    const offset = Number(options.offset ?? 0);
    const limit = Number(options.limit ?? Math.max(results.length, 1));
    let end = 0;
    const groups = groupRows(results, options.group, () => "Files").flatMap(
      ({ name, rows }) => {
        const start = end;
        end += rows.length;
        const page = rows.slice(
          Math.max(0, offset - start),
          Math.max(0, offset + limit - start),
        );
        return page.length ? [{ name, rows: page }] : [];
      },
    );
    const order = this.config.folderOrder ?? [];
    const compareFolders = (a, b) => {
      const left = a.split("/");
      const right = b.split("/");
      const index = left.findIndex((part, i) => part !== right[i]);
      if (index < 0 || index >= right.length) return left.length - right.length;
      const rank = (parts) =>
        order.indexOf(parts.slice(0, index + 1).join("/")) + 1 || Infinity;
      return (
        rank(left) - rank(right) || left[index].localeCompare(right[index])
      );
    };
    const folders = [...this.folders].sort(compareFolders).map((path) => ({
      path,
      name: nameOf(path),
      parent: parentOf(path),
      depth: path.split("/").length,
    }));
    const counts = new Map();
    for (const row of rows) {
      const ancestors = new Set();
      for (const name of row.tags) {
        const parts = name.toLowerCase().split("/");
        for (let index = 1; index <= parts.length; index++)
          ancestors.add(parts.slice(0, index).join("/"));
      }
      for (const name of ancestors)
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const records = this.tags();
    const tags = [];
    const appendTags = (parent) => {
      for (const tag of records.filter(
        ({ path }) => parentOf(path).toLowerCase() === parent,
      )) {
        tags.push({
          ...tag,
          depth: tag.path.split("/").length - 1,
          count: counts.get(tag.path.toLowerCase()) ?? 0,
        });
        appendTags(tag.path.toLowerCase());
      }
    };
    appendTags("");
    return {
      groups: groups.length ? groups : [{ name: "", rows: [] }],
      next: offset + limit < results.length ? offset + limit : null,
      views: this.config.views ?? [],
      count: results.length,
      missing: rows.filter((row) => !row.available).length,
      folders,
      tags,
      pinnedTags: tags.filter((tag) => tag.pinned).map((tag) => tag.path),
      inbox: this.inbox.filter(
        ({ name }) =>
          !this.pendingJobs().some((job) => job.source === "staging/" + name),
      ),
      jobs: this.pendingJobs(),
      previewPending: this.previewJobs.size > 0,
    };
  }

  async reserve(count) {
    const ids = [];
    while (ids.length < count) {
      const stamp = new Date()
        .toISOString()
        .slice(2, 19)
        .replaceAll("-", "")
        .replaceAll(":", "")
        .replace("T", "-");
      const path = "settings/id-counters-" + stamp.slice(0, 6) + ".json";
      const counters = await this.files.json(path, {});
      const suffix = stamp.slice(7);
      let counter = counters[suffix] ?? -1;
      for (const id of this.rows.keys())
        if (id.startsWith(stamp + "-"))
          counter = Math.max(counter, Number(id.slice(-4)));
      while (ids.length < count && counter < 9999)
        ids.push(stamp + "-" + String(++counter).padStart(4, "0"));
      counters[suffix] = counter;
      await this.files.writeJSON(path, counters);
      if (ids.length < count)
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return ids;
  }

  newRow(id, name, path, size) {
    return {
      id,
      originalName: name,
      title: name,
      path,
      size,
      notes: "",
      tagIds: [],
      revision: 1,
      contentRevision: 1,
      created: new Date().toISOString(),
    };
  }

  async saveRow(row) {
    await this.files.writeJSON(sidecar(row.id), row);
    this.rows.set(row.id, row);
    return row;
  }

  row(id) {
    const row = this.rows.get(id);
    if (!row) throw new Problem(404, "File not found.");
    return row;
  }

  async original(id) {
    const file = await this.files.file(this.row(id).path);
    if (!file) throw new Problem(404, "The original is missing.");
    return file;
  }

  async edit(id, { name, notes, tags, revision }) {
    const row = this.row(id);
    if (row.revision !== revision)
      throw new Problem(409, "The file changed. Refresh and try again.");
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 240 ||
      typeof notes !== "string" ||
      notes.length > 64000
    )
      throw new Problem(400, "Invalid file properties.");
    const tagIds =
      tags === undefined ? row.tagIds : await this.ensureTags(tags);
    return this.presentation(
      await this.saveRow({
        ...row,
        title: name.trim(),
        notes,
        tagIds,
        revision: revision + 1,
      }),
    );
  }

  selectionTags(ids) {
    return [...new Set(ids)]
      .filter((id) => this.rows.has(id))
      .map((id) => ({ id, tags: this.tagPaths(this.row(id)) }));
  }

  async bulkTags({ ids, add, remove }) {
    const removals = new Set(
      normalizeTags(remove ?? []).map((tag) => tag.toLowerCase()),
    );
    const results = [];
    for (const id of new Set(ids)) {
      try {
        const row = this.row(id);
        const tags = [
          ...this.tagPaths(row).filter(
            (tag) => !removals.has(tag.toLowerCase()),
          ),
          ...(add ?? []),
        ];
        results.push({
          id,
          previousRevision: row.revision,
          row: await this.edit(id, {
            name: row.title,
            notes: row.notes,
            tags,
            revision: row.revision,
          }),
        });
      } catch (error) {
        results.push({ id, error: error.message });
      }
    }
    return results;
  }

  relinkCandidates(id) {
    this.row(id);
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.id !== id &&
          row.revision === 1 &&
          !row.notes &&
          !row.tagIds.length &&
          this.locations.has(row.id),
      )
      .map((row) => this.presentation(row));
  }

  async relink(id, targetId) {
    const row = this.row(id);
    const target = this.row(targetId);
    if (
      this.locations.has(id) ||
      target.revision !== 1 ||
      target.notes ||
      target.tagIds.length
    )
      throw new Problem(409, "Choose an unedited original to relink.");
    await this.original(targetId);
    return this.start({
      kind: "relink",
      resource: id,
      sourceId: targetId,
      source: target.path,
      folder: parentOf(target.path).slice(6),
      name: row.title,
    });
  }

  async createFolder(parent, name) {
    const path = [parent, component(name)].filter(Boolean).join("/");
    if (this.folders.has(path))
      throw new Problem(409, "That folder already exists.");
    await this.files.directory("files/" + path, true);
    this.folders.add(path);
    return path;
  }

  async inspectFolder(folder) {
    if (!folder) throw new Problem(400, "Choose a folder below Files.");
    const base = "files/" + folder;
    await this.files.directory(base);
    const directories = [];
    const entries = [];
    const collect = async (path) => {
      directories.push(path);
      for await (const [name, handle] of this.files.entries(path)) {
        const child = path + "/" + name;
        if (handle.kind === "directory") await collect(child);
        else {
          const file = await handle.getFile();
          entries.push({
            path: child,
            bytes: file.size,
            modified: file.lastModified,
          });
        }
      }
    };
    await collect(base);
    entries.sort((a, b) => a.path.localeCompare(b.path));
    directories.sort();
    return {
      files: entries.length,
      folders: directories.length - 1,
      token: JSON.stringify({ entries, directories }),
    };
  }

  async changeFolder({ folder, destination, token, before }) {
    if (before !== undefined) {
      const siblings = [...this.folders].filter(
        (path) => parentOf(path) === parentOf(folder) && path !== folder,
      );
      const order = this.config.folderOrder ?? [];
      siblings.sort(
        (a, b) =>
          (order.indexOf(a) + 1 || Infinity) -
          (order.indexOf(b) + 1 || Infinity),
      );
      const at = before === null ? siblings.length : siblings.indexOf(before);
      if (at < 0) throw new Problem(409, "Choose a sibling folder.");
      siblings.splice(at, 0, folder);
      return this.saveSettings({
        ...this.config,
        folderOrder: [
          ...order.filter((path) => !siblings.includes(path)),
          ...siblings,
        ],
      });
    }
    const snapshot = await this.inspectFolder(folder);
    if (destination === undefined && snapshot.token !== token)
      throw new Problem(409, "The folder changed. Review it again.");
    if (destination !== undefined) {
      if (
        !destination ||
        inside(destination.toLowerCase(), folder.toLowerCase()) ||
        [...this.folders].some(
          (path) => path.toLowerCase() === destination.toLowerCase(),
        )
      )
        throw new Problem(409, "Choose a new folder outside this one.");
      const parent = parentOf(destination);
      await this.files.directory(parent ? "files/" + parent : "files");
    }
    const job = await this.start({
      kind: "folder",
      source: "files/" + folder,
      name: folder,
      folder,
      target: destination,
      inventory: JSON.parse(snapshot.token),
    });
    if (job.error) throw new Problem(409, job.error);
  }

  async captureFolder() {
    if (this.config.captureFolder !== undefined)
      return this.config.captureFolder;
    if (!this.folders.has("Inbox")) await this.createFolder("", "Inbox");
    return "Inbox";
  }

  async prepareUploads(drafts) {
    const fresh = drafts.filter(({ id }) => !this.jobs.has(id));
    const ids = await this.reserve(fresh.length);
    for (const [index, draft] of fresh.entries()) {
      const folder =
        draft.managed === false ? draft.folder : await this.captureFolder();
      const name = this.captureName(draft.file.name, draft.unnamedNote);
      await this.saveJob({
        id: draft.id,
        resource: ids[index],
        source: "staging/" + draft.id + ".part",
        name,
        folder,
        expected: draft.file.size,
        kind: "upload",
        phase: "awaiting-upload",
      });
    }
  }

  captureName(name, automatic) {
    if (!automatic) return component(name);
    const stem = noteDate(new Date());
    const occupied = new Set([
      ...[...this.rows.values()].map((row) => row.originalName),
      ...[...this.jobs.values()].map((job) => job.name),
    ]);
    let next = stem + ".md";
    for (let suffix = 2; occupied.has(next); suffix++)
      next = stem + "-" + suffix + ".md";
    return next;
  }

  async upload(receipt, options, file, progress) {
    const existing = this.jobs.get(receipt);
    if (existing && existing.phase !== "awaiting-upload") return existing;
    if (!existing)
      await this.prepareUploads([
        {
          id: receipt,
          file: { name: options.name, size: file.size },
          folder: options.folder ?? "",
          managed: options.capture === "1",
          unnamedNote: options.note === "1",
        },
      ]);
    const job = this.job(receipt);
    if (job.expected !== file.size)
      throw new Problem(409, "The import file changed.");
    await this.files.remove(job.source);
    await this.files.write(job.source, file, { fresh: true });
    progress(100);
    await this.saveJob({ ...job, phase: "intent" });
    return this.execute(this.job(receipt));
  }

  async importInbox(name, folder) {
    const source = "staging/" + component(name);
    const file = await this.files.file(source);
    if (!file) throw new Problem(404, "The staged file is missing.");
    return this.start({
      kind: "adopt",
      resource: (await this.reserve(1))[0],
      source,
      name,
      folder,
      expected: file.size,
    });
  }

  async batch({ kind, folder, items }) {
    if (!["copy", "move", "delete"].includes(kind))
      throw new Problem(400, "Invalid file operation.");
    const results = [];
    const ids = await this.reserve(
      kind === "copy"
        ? items.filter(({ receipt }) => !this.jobs.has(receipt)).length
        : 0,
    );
    for (const { id, receipt } of items) {
      try {
        if (this.jobs.has(receipt)) {
          results.push({ id, job: this.job(receipt) });
          continue;
        }
        const row = this.row(id);
        if (kind === "move" && parentOf(row.path).slice(6) === folder)
          throw new Problem(409, "This file is already in that folder.");
        results.push({
          id,
          job: await this.start({
            id: receipt,
            kind,
            folder,
            source: row.path,
            sourceId: id,
            resource: kind === "copy" ? ids.shift() : id,
            name: row.originalName,
          }),
        });
      } catch (error) {
        results.push({ id, error: error.message });
      }
    }
    return results;
  }

  async saveJob(job) {
    if (!/^[\da-f-]{36}$/i.test(job.id))
      throw new Problem(400, "Invalid operation receipt.");
    await this.files.writeJSON(receiptPath(job.id), job);
    this.jobs.set(job.id, job);
    return job;
  }

  async start(input) {
    const job = await this.saveJob({
      ...input,
      id: input.id ?? crypto.randomUUID(),
      phase: "intent",
    });
    return this.execute(job);
  }

  job(id) {
    const job = this.jobs.get(id);
    if (!job) throw new Problem(404, "Operation not found.");
    return job;
  }

  async cancel(id) {
    const job = this.job(id);
    if (finished(job)) return job;
    if (
      !["intent", "awaiting-upload"].includes(job.phase) ||
      job.destination ||
      job.kind === "folder" ||
      job.kind === "markdown"
    )
      throw new Problem(409, "Retry this operation to finish its cleanup.");
    if (job.kind === "upload") await this.files.remove(job.source);
    return this.saveJob({ ...job, phase: "cancelled", error: null });
  }

  async cancelAll() {
    const jobs = [];
    for (const job of this.pendingJobs()) {
      try {
        jobs.push(await this.cancel(job.id));
      } catch {
        jobs.push(job);
      }
    }
    return jobs;
  }

  async execute(input) {
    let job = { ...input, error: null };
    try {
      if (finished(job)) return job;
      if (job.kind === "markdown") await this.finishMarkdown(job);
      else if (job.kind === "folder") await this.finishFolder(job);
      else if (job.kind === "delete") await this.finishDelete(job);
      else await this.finishTransfer(job);
      job.phase = "done";
      if (job.source?.startsWith("staging/"))
        this.inbox = this.inbox.filter(
          ({ name }) => name !== nameOf(job.source),
        );
    } catch (error) {
      return this.saveJob({ ...this.jobs.get(job.id), error: error.message });
    }
    await this.saveJob(job);
    if (["upload", "adopt", "copy", "relink", "markdown"].includes(job.kind))
      this.generate(job.resource);
    return job;
  }

  async finishTransfer(job) {
    const old = this.rows.get(job.sourceId);
    const file = await this.files.file(job.source);
    const keepsId = ["move", "relink"].includes(job.kind);
    const extension = extensionOf(
      job.kind === "upload" ? job.name : nameOf(job.source),
    );
    if (extension.toLowerCase() === ".url")
      throw new Problem(400, "Paste the web address to save it as a .link file.");
    const path =
      job.destination ??
      ["files", job.folder, job.resource + extension].filter(Boolean).join("/");
    const target = await this.files.file(path);
    if (job.phase === "intent") {
      if (!file || (job.expected !== undefined && file.size !== job.expected))
        throw new Problem(409, "The source changed or is missing.");
      if (target) {
        if (!job.destination || !(await equalBytes(file, target)))
          throw new Problem(
            409,
            "The destination is occupied. The source was kept.",
          );
      } else {
        job.destination = path;
        await this.saveJob({ ...job });
        await this.files.write(path, file, { fresh: true });
      }
      if (!(await equalBytes(file, await this.files.file(path))))
        throw new Problem(409, "The copied bytes differ. The source was kept.");
      const base = keepsId
        ? this.row(job.resource)
        : old && job.kind === "copy"
          ? {
              ...this.newRow(job.resource, old.originalName, path, file.size),
              title: old.title,
              notes: old.notes,
              tagIds: old.tagIds,
            }
          : this.newRow(job.resource, job.name, path, file.size);
      if (!keepsId || base.path !== path)
        await this.saveRow({
          ...base,
          path,
          size: file.size,
          revision: keepsId ? base.revision + 1 : base.revision,
          contentRevision:
            job.kind === "relink"
              ? base.contentRevision + 1
              : base.contentRevision,
        });
      this.locations.set(job.resource, path);
      job.phase = "cleanup";
      await this.saveJob({ ...job });
    }
    if (job.kind !== "copy" && file) {
      const source = await this.files.file(job.source);
      if (!(await equalBytes(source, await this.files.file(path))))
        throw new Problem(
          409,
          "The source or destination changed. Both files were kept.",
        );
      await this.files.remove(job.source);
    }
    if (job.kind === "relink") await this.removeRow(job.sourceId);
  }

  async removeRow(id) {
    await this.files.remove(sidecar(id));
    this.rows.delete(id);
    this.locations.delete(id);
    this.ready.delete(id);
    const derivatives = [thumbnail(id), preview(id), textPreview(id)];
    for await (const [name] of this.files.entries("previews"))
      if (name.startsWith(id + "-p")) derivatives.push("previews/" + name);
    await Promise.all(derivatives.map((path) => this.files.remove(path)));
  }

  async finishDelete(job) {
    if (job.phase === "intent") {
      const file = await this.files.file(job.source);
      job.original = file ? [file.size, file.lastModified] : null;
      job.phase = "cleanup";
      await this.saveJob({ ...job });
    }
    const current = await this.files.file(job.source);
    if (
      current &&
      (current.size !== job.original?.[0] ||
        current.lastModified !== job.original?.[1])
    )
      throw new Problem(409, "The source changed. Confirm deletion again.");
    if (current) await this.files.remove(job.source);
    await this.removeRow(job.resource);
  }

  async finishFolder(job) {
    const { folder, target, inventory } = job;
    const change = (path) =>
      target && inside(path, folder)
        ? target + path.slice(folder.length)
        : path;
    if (target) {
      for (const directory of inventory.directories)
        await this.files.directory("files/" + change(directory.slice(6)), true);
    }
    for (const entry of inventory.entries) {
      const current = await this.files.file(entry.path);
      const path = target ? "files/" + change(entry.path.slice(6)) : null;
      if (
        current &&
        (current.size !== entry.bytes ||
          current.lastModified !== entry.modified)
      )
        throw new Problem(
          409,
          "A file in the folder changed. Review the folder again.",
        );
      if (target && current) {
        const copy = await this.files.file(path);
        if (!copy) await this.files.write(path, current, { fresh: true });
        if (!(await equalBytes(current, await this.files.file(path))))
          throw new Problem(409, "The destination contains a different file.");
      }
      const row = [...this.rows.values()].find(
        (item) => item.path === entry.path,
      );
      if (row && target) {
        await this.saveRow({ ...row, path, revision: row.revision + 1 });
        this.locations.set(row.id, path);
      } else if (row) await this.removeRow(row.id);
      if (current) await this.files.remove(entry.path);
    }
    for (const path of inventory.directories.slice().reverse()) {
      await this.files.remove(path);
      this.folders.delete(path.slice(6));
      if (target) this.folders.add(change(path.slice(6)));
    }
    const config = this.rewriteSettings(
      this.config,
      "folder",
      change,
      target ? undefined : (path) => inside(path, folder),
    );
    if (inside(config.captureFolder, folder)) {
      if (target) config.captureFolder = change(config.captureFolder);
      else delete config.captureFolder;
    }
    config.folderOrder = (config.folderOrder ?? [])
      .filter((path) => target || !inside(path, folder))
      .map(change);
    await this.saveSettings(config);
  }

  async readMarkdown(id) {
    const row = this.row(id);
    const file = await this.original(id);
    if (!isMarkdown(row.originalName) || file.size > markdownLimit)
      throw new Problem(415, "This Markdown file cannot be edited.");
    const bytes = await file.arrayBuffer();
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Problem(415, "The file is not UTF-8 Markdown.");
    }
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return {
      text,
      version:
        '"' +
        Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("") +
        '"',
    };
  }

  async saveMarkdown(id, expected, text) {
    const { version } = await this.readMarkdown(id);
    if (expected !== version)
      throw new Problem(409, "The original changed. Reload before saving.");
    const data = new Blob([text], { type: "text/markdown" });
    if (data.size > markdownLimit)
      throw new Problem(413, "Markdown is limited to 1 MiB.");
    const row = this.row(id);
    const receipt = crypto.randomUUID();
    const source = "staging/" + receipt + ".part";
    await this.files.write(source, data, { fresh: true });
    const job = await this.start({
      id: receipt,
      kind: "markdown",
      name: row.title,
      resource: id,
      source,
      previous: row.contentRevision,
      expectedVersion: expected,
    });
    if (job.error) throw new Problem(409, job.error);
    return (await this.readMarkdown(id)).version;
  }

  async finishMarkdown(job) {
    const row = this.row(job.resource);
    const replacement = await this.files.file(job.source);
    if (row.contentRevision > job.previous) {
      await this.files.remove(job.source);
      return;
    }
    if (!replacement) throw new Problem(404, "The staged edit is missing.");
    const original = await this.original(row.id);
    const current = await this.readMarkdown(row.id);
    const history = "revisions/" + row.id + "-" + job.previous + ".original";
    const saved = await this.files.file(history);
    if (current.version === job.expectedVersion) {
      if (!saved) await this.files.write(history, original, { fresh: true });
      else if (!(await equalBytes(original, saved)))
        throw new Problem(409, "The revision path is occupied.");
      await this.files.write(row.path, replacement);
    } else if (!saved || !(await equalBytes(original, replacement))) {
      throw new Problem(409, "The original changed. The draft was kept.");
    }
    await this.saveRow({
      ...row,
      size: replacement.size,
      contentRevision: row.contentRevision + 1,
    });
    await this.files.remove(job.source);
  }

  generate(id, rebuild = false) {
    if (!this.locations.has(id)) return Promise.resolve();
    const pending = this.previewJobs.get(id);
    if (
      pending &&
      !rebuild &&
      pending.revision === this.row(id).contentRevision
    )
      return pending.task;
    if (!this.previewTokens) this.previewTokens = new Map();
    const revision = this.row(id).contentRevision;
    const task = this.previewQueue
      .then(async () => {
        const row = this.rows.get(id);
        if (!row || row.contentRevision !== revision) return;
        const result = await makeDerivatives(
          await this.original(id),
          row.originalName,
        );
        await this.write(async () => {
          if (this.rows.get(id)?.contentRevision !== revision) return;
          const prior = await this.files.json(textPreview(id), {});
          if (prior.pages > 1) {
            for await (const [name] of this.files.entries("previews"))
              if (name.startsWith(id + "-p"))
                await this.files.remove("previews/" + name);
          }
          await this.files.write(preview(id), result.image);
          await this.files.write(thumbnail(id), result.thumbnail);
          await this.files.writeJSON(textPreview(id), {
            ...result.text,
            pages: result.pages,
            revision,
          });
          this.ready.add(id);
          this.previewFailures.delete(id);
          this.previewTokens.set(id, (this.previewTokens.get(id) ?? 0) + 1);
        });
      })
      .catch((error) => {
        if (this.rows.has(id)) this.previewFailures.add(id);
        console.warn("Preview generation failed:", error);
      });
    this.previewQueue = task;
    this.previewJobs.set(id, { task, revision });
    void task.then(() => {
      if (this.previewJobs.get(id)?.task === task) this.previewJobs.delete(id);
    });
    return task;
  }

  async media(id, kind, page = 1) {
    const row = this.row(id);
    if (["image", "media", "download"].includes(kind)) return this.original(id);
    if (kind === "thumbnail") return this.files.file(thumbnail(id));
    let info = await this.files.json(textPreview(id), {});
    const pending = this.previewJobs.get(id);
    if (
      pending &&
      (info.revision !== row.contentRevision || !this.ready.has(id))
    ) {
      await pending.task;
      info = await this.files.json(textPreview(id), {});
    }
    if (kind === "text-preview") return info;
    if (!Number.isSafeInteger(page) || page < 1 || page > (info.pages ?? 1))
      throw new Problem(404, "Preview page unavailable.");
    const path =
      page === 1
        ? preview(id)
        : "previews/" + id + "-p" + String(page).padStart(4, "0") + ".webp";
    let result = await this.files.file(path);
    if (page > 1 && (!result || info.revision !== row.contentRevision)) {
      const derivatives = await makeDerivatives(
        await this.original(id),
        row.originalName,
        page,
      );
      await this.write(async () => {
        if (this.row(id).contentRevision !== row.contentRevision)
          throw new Problem(409, "The PDF changed. Reopen the preview.");
        await this.files.write(path, derivatives.image);
      });
      result = await this.files.file(path);
    }
    return { result, pages: info.pages ?? 1 };
  }
}
