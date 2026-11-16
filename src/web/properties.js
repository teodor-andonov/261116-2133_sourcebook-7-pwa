import { $ } from "./dom.js";
import { writeResources } from "./resource-writes.js";
import { json } from "./transport.js";

function fields(form) {
  return {
    name: form.elements.name.value,
    notes: form.elements.notes.value,
  };
}

export function propertiesEditor({
  catalogPath,
  selected,
  resource,
  browse,
  toast,
}) {
  const drafts = new Map();
  const timers = new Map();
  const keyOf = (id) => catalogPath() + ":" + id;
  const read = (key) => {
    if (drafts.has(key)) return drafts.get(key);
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  };
  const keep = (key, draft) => {
    drafts.set(key, draft);
    try {
      if (draft) localStorage.setItem(key, JSON.stringify(draft));
      else localStorage.removeItem(key);
    } catch {}
  };
  const visible = (form, text) => {
    const status = form.querySelector("[data-save-status]");
    if (status) status.textContent = text;
  };
  function remember(form, row) {
    const key = keyOf(row.id);
    keep(key, { ...fields(form), revision: Number(form.dataset.revision) });
    return key;
  }
  function restore(row) {
    if (!row) return;
    const form = $("#properties");
    const draft = read(keyOf(row.id));
    if (!form || !draft) return;
    form.elements.name.value = draft.name;
    form.elements.notes.value = draft.notes;
    form.dataset.revision = draft.revision;
    form.querySelector('[type="submit"]').hidden = false;
    const comparison = form.querySelector("[data-property-conflict]");
    if (draft.revision !== row.revision && comparison) {
      comparison.hidden = false;
      comparison.querySelector("pre").textContent =
        row.name + "\n\n" + row.notes;
    }
    visible(
      form,
      draft.revision === row.revision
        ? "Unsaved changes"
        : "The saved file changed. Your draft is still here.",
    );
  }
  async function save(form, row, key, url, explicit = false) {
    clearTimeout(timers.get(key));
    timers.delete(key);
    await writeResources([key], async () => {
      const draft = read(key);
      if (!draft || !form.checkValidity()) return;
      const submit = form.querySelector('[type="submit"]');
      submit.hidden = true;
      visible(form, "Saving…");
      try {
        const saved = await json(url, {
          method: "PATCH",
          body: draft,
        });
        const newer = read(key);
        if (newer === draft) keep(key, null);
        else if (newer) keep(key, { ...newer, revision: saved.revision });
        const active = key === keyOf(selected()?.id) && $("#properties");
        if (active) {
          active.dataset.revision = saved.revision;
          visible(active, newer === draft ? "Saved." : "Unsaved changes");
          await browse({ background: true });
        }
        if (explicit) toast("Saved.");
      } catch (error) {
        const active = key === keyOf(selected()?.id) && $("#properties");
        if (active) {
          visible(active, error.message);
          active.querySelector('[type="submit"]').hidden = false;
          if (error.status === 409) await browse();
        }
        if (explicit) toast(error.message);
      } finally {
        submit.hidden = !read(key);
      }
    });
  }
  function schedule(form, row, key, url) {
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => void save(form, row, key, url), 650),
    );
  }
  function input(event) {
    const form = event.target.closest("#properties");
    const row = selected();
    if (!form || !row || !["name", "notes"].includes(event.target.name)) return;
    const key = remember(form, row);
    visible(form, "Unsaved changes");
    schedule(form, row, key, resource(row.id));
  }
  function submit(event) {
    const form = event.target;
    if (form.id !== "properties") return;
    event.preventDefault();
    const row = selected();
    if (row) void save(form, row, keyOf(row.id), resource(row.id), true);
  }
  function acceptTagResult(base, before, saved) {
    const key = base + ":" + saved.id;
    const draft = read(key);
    if (draft?.revision === before)
      keep(key, { ...draft, revision: saved.revision });
    const form = $("#properties");
    if (
      key === keyOf(selected()?.id) &&
      Number(form?.dataset.revision) === before
    )
      form.dataset.revision = saved.revision;
  }
  return { restore, input, submit, acceptTagResult };
}
