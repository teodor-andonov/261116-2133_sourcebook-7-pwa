import { $, escape as e, field, modal, toast } from "./dom.js";
import { writeResources } from "./resource-writes.js";
import {
  downloadOriginal,
  fileLink,
  json,
  originalFile,
  request,
} from "./transport.js";

const later = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function fileActions({
  state,
  catalogPath,
  resource,
  selected,
  browse,
  chooseFolder,
  onTagSaved,
  openView,
}) {
  let clipboard;
  let dragged;

  async function finalStatus(base, job) {
    for (
      let attempt = 0;
      attempt < 50 && job.phase !== "done" && !job.error;
      attempt++
    ) {
      await later(200);
      job = await json(base + "/operations/" + job.id);
    }
    return job;
  }

  async function transfer(kind, folder, ids = [...state.selectedIds]) {
    if (!ids.length) return [];

    const base = catalogPath();
    const items = ids.map((id) => ({ id, receipt: crypto.randomUUID() }));
    const results = [];
    for (let offset = 0; offset < items.length; offset += 100) {
      const batch = items.slice(offset, offset + 100);
      const send = () =>
        json(base + "/operations", {
          method: "POST",
          body: { kind, folder, items: batch },
        });
      try {
        results.push(...(await send()));
      } catch (error) {
        try {
          if (!(error instanceof TypeError)) throw error;
          results.push(...(await send()));
        } catch (failure) {
          results.push(
            ...batch.map(({ id }) => ({ id, error: failure.message })),
          );
        }
      }
    }
    const settled = await Promise.all(
      results.map(async (item) => {
        if (!item.job) return item;
        try {
          const job = await finalStatus(base, item.job);
          return {
            id: item.id,
            error: job.error,
            done: job.phase === "done" && !job.error,
          };
        } catch (error) {
          return { id: item.id, error: error.message };
        }
      }),
    );
    const done = settled.filter((item) => item.done).map(({ id }) => id);
    const errors = settled
      .filter(({ error }) => error)
      .map(({ error }) => error);
    const pending = settled.length - done.length - errors.length;
    toast(
      [
        done.length + " complete",
        pending ? pending + " pending" : "",
        ...new Set(errors),
      ]
        .filter(Boolean)
        .join(" · "),
    );
    if (catalogPath() === base) await browse();
    return done;
  }

  async function tags(
    add,
    remove = [],
    ids = [...state.selectedIds],
    base = catalogPath(),
  ) {
    if (!ids.length) return [];
    const results = [];
    const failures = [];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = ids.slice(offset, offset + 100);
      const result = await writeResources(
        batch.map((id) => base + ":" + id),
        async () => {
          try {
            const items = await json(base + "/tags", {
              method: "PATCH",
              body: { ids: batch, add, remove },
            });
            for (const item of items)
              if (item.row) onTagSaved(base, item.previousRevision, item.row);
            return items;
          } catch (error) {
            return batch.map((id) => ({ id, error: error.message }));
          }
        },
      );
      results.push(...result);
      for (const item of result) if (item.error) failures.push(item.error);
    }
    if (failures.length) toast(failures.length + " failed · " + failures[0]);
    if (catalogPath() === base) await browse();
    return results;
  }

  async function tagDialog() {
    const ids = [...state.selectedIds];
    if (!ids.length) return;
    const base = catalogPath();
    const rows = new Map();
    for (let offset = 0; offset < ids.length; offset += 100) {
      const items = await json(base + "/tags/selection", {
        method: "POST",
        body: { ids: ids.slice(offset, offset + 100) },
      });
      for (const item of items) rows.set(item.id, item.tags);
    }
    if (catalogPath() !== base) return;
    const dialog = modal(
      "Tag files",
      `<p>${ids.length} selected</p>
      ${field("Add a tag", "tag", "", 'maxlength="240" list="batch-tag-suggestions"')}
      <datalist id="batch-tag-suggestions">${state.data.tags.map(({ path }) => `<option value="${e(path)}"></option>`).join("")}</datalist>
      <div class="tag-chips"></div><small role="status"></small>`,
    );
    const input = dialog.querySelector("[name=tag]");
    const pills = dialog.querySelector(".tag-chips");
    const status = dialog.querySelector("[role=status]");
    function draw() {
      const counts = new Map();
      for (const tags of rows.values())
        for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      pills.innerHTML = [...counts]
        .map(
          ([tag, count]) =>
            `<button type="button" data-tag="${e(tag)}" aria-label="Remove ${e(tag)}">${e(tag)} ${count < ids.length ? `(${count}/${ids.length})` : ""} ×</button>`,
        )
        .join("");
    }
    async function apply(add, remove) {
      input.disabled = pills.inert = true;
      status.textContent = ids.length + " pending…";
      try {
        const results = await tags(add, remove, ids, base);
        for (const { id, row } of results) if (row) rows.set(id, row.tags);
        draw();
        const failures = results.filter(({ error }) => error);
        status.textContent = failures.length
          ? failures.length + " failed · " + failures[0].error
          : "Tags updated.";
        if (add.length && results.every(({ row }) => row)) input.value = "";
      } catch (error) {
        status.textContent = error.message;
      } finally {
        input.disabled = pills.inert = false;
        if (dialog.open) input.focus();
      }
    }
    dialog.querySelector("form").onsubmit = (event) => {
      event.preventDefault();
      const tag = input.value.trim();
      if (tag && !input.disabled) void apply([tag], []);
    };
    input.onkeydown = (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        event.target.form.requestSubmit();
      }
    };
    pills.onclick = (event) => {
      const tag = event.target.closest("[data-tag]")?.dataset.tag;
      if (tag && !input.disabled) void apply([], [tag]);
    };
    draw();
  }

  const commands = {
    move: () => {
      if (state.selectedIds.size)
        chooseFolder("Move", (folder) => transfer("move", folder));
    },
    copy: () => {
      if (state.selectedIds.size)
        chooseFolder("Copy", (folder) => transfer("copy", folder));
    },
    delete: () => {
      if (!state.selectedIds.size) return;
      const ids = [...state.selectedIds];
      modal(
        "Delete files",
        `<p>Delete ${ids.length} selected ${ids.length === 1 ? "file" : "files"} from this catalog?</p>`,
        {
          submit: "Delete",
          onSubmit: () => transfer("delete", "", ids),
        },
      );
    },
    "tag-files": tagDialog,
    "pin-tag": async ({ path }) => {
      await request(catalogPath() + "/tag-branch", {
        method: "PATCH",
        body: { path, pinned: !state.data.pinnedTags.includes(path) },
      });
      await browse({ background: true });
    },
    "rename-tag": ({ path }) => {
      modal(
        "Rename tag branch",
        field("Tag", "tag", path, 'maxlength="240" required'),
        {
          onSubmit: async (data) => {
            await request(catalogPath() + "/tag-branch", {
              method: "PATCH",
              body: { path, rename: data.get("tag") },
            });
            await browse();
          },
        },
      );
    },
    "copy-link": async () => {
      const row = selected();
      if (!row) return;
      await navigator.clipboard.writeText(fileLink(resource(row.id)));
      toast("Library link copied. Open this library to use it.");
    },
    "share-link": async () => {
      const row = selected();
      if (!row) return;
      const path = resource(row.id);
      const share = { files: [await originalFile(path)], title: row.title };
      if (navigator.canShare?.(share)) await navigator.share(share);
      else await downloadOriginal(path);
    },
  };

  const skip = (target) =>
    target.closest("input, textarea, select, [contenteditable], dialog");

  function keydown(event, run) {
    if (skip(event.target) || !state.catalog) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && ["c", "x", "v"].includes(key)) {
      if (key === "v") {
        if (!clipboard || clipboard.catalog !== state.catalog.id) return;
        event.preventDefault();
        const current = clipboard;
        const paste = async (folder) => {
          const done = await transfer(current.kind, folder, current.ids);
          if (current.kind === "move" && clipboard === current) {
            current.ids = current.ids.filter((id) => !done.includes(id));
            if (!current.ids.length) clipboard = null;
          }
        };
        if (state.where.scope === "folder")
          void run(() => paste(state.where.folder));
        else chooseFolder("Paste", paste);
      } else if (state.selectedIds.size) {
        event.preventDefault();
        clipboard = {
          catalog: state.catalog.id,
          kind: key === "x" ? "move" : "copy",
          ids: [...state.selectedIds],
        };
        toast(key === "x" ? "Files cut." : "Files copied.");
      }
    } else if (key === "delete") {
      event.preventDefault();
      commands.delete();
    } else if (key === "f2" && selected()) {
      event.preventDefault();
      $("#properties [name=name]")?.select();
    }
  }

  function dragstart(event) {
    const item = event.target.closest(".file-item");
    if (!item) return;
    const id = item.dataset.id;
    dragged = {
      catalog: state.catalog.id,
      ids: state.selectedIds.has(id) ? [...state.selectedIds] : [id],
    };
    event.dataTransfer.setData("application/x-sourcebook-files", "internal");
    event.dataTransfer.effectAllowed = "copyMove";
  }

  const dropTarget = (event) =>
    event.target.closest(
      '[data-nav="folder"], [data-nav="tag"], [data-nav="view"]',
    );
  function dragover(event) {
    const target = dropTarget(event);
    if (!dragged || dragged.catalog !== state.catalog?.id || !target) {
      $(".resource-drop")?.classList.remove("resource-drop");
      return;
    }
    event.preventDefault();
    if (!target.classList.contains("resource-drop")) {
      $(".resource-drop")?.classList.remove("resource-drop");
      target.classList.add("resource-drop");
    }
    event.dataTransfer.dropEffect =
      target.dataset.nav === "tag" || event.ctrlKey || event.metaKey
        ? "copy"
        : "move";
  }

  function drop(event, run) {
    const target = dropTarget(event);
    if (!target || !dragged || dragged.catalog !== state.catalog?.id) return;
    event.preventDefault();
    event.stopPropagation();
    $(".resource-drop")?.classList.remove("resource-drop");
    const { ids } = dragged;
    dragged = null;
    const { nav, path } = target.dataset;
    if (nav === "tag") void run(() => tags([path], [], ids));
    else if (nav === "view") openView(path);
    else
      void run(() =>
        transfer(event.ctrlKey || event.metaKey ? "copy" : "move", path, ids),
      );
  }

  return {
    commands,
    tags,
    keydown,
    dragstart,
    dragover,
    drop,
    dragend: () => {
      dragged = null;
      $(".resource-drop")?.classList.remove("resource-drop");
    },
  };
}
