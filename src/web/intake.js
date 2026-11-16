import { $, escape as e, field, modal, toast } from "./dom.js";
import { json, prepareUploads, request, upload } from "./transport.js";

const storageModule = "/intake-store.js";
const storage = () => import(/* @vite-ignore */ storageModule);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const inField = (element) =>
  element.closest("input, textarea, select, [contenteditable], dialog");

export function intakeController({ state, browse, status }) {
  const active = new Map();
  const base = (catalog) => "/local/libraries/" + encodeURIComponent(catalog);

  async function getJob(catalog, id) {
    try {
      return await json(base(catalog) + "/operations/" + id);
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  function send(draft) {
    if (active.has(draft.id)) return active.get(draft.id);
    const operation = deliver(draft).finally(() => active.delete(draft.id));
    active.set(draft.id, operation);
    return operation;
  }

  async function deliver(draft) {
    const { putDraft, deleteDraft } = await storage();
    draft.catalog ??= state.catalog?.id;
    if (!draft.catalog) return false;
    await putDraft(draft);
    try {
      let job = await getJob(draft.catalog, draft.id);
      if (!job || job.phase === "awaiting-upload") {
        const query = new URLSearchParams({ name: draft.file.name });
        if (draft.managed === false) query.set("folder", draft.folder);
        else query.set("capture", "1");
        if (draft.unnamedNote) query.set("note", "1");
        job = await upload(
          base(draft.catalog) + "/uploads/" + draft.id + "?" + query,
          draft.file,
          (percent) =>
            status("Importing " + draft.file.name + " · " + percent + "%"),
        );
      } else if (
        job.error &&
        job.phase !== "cancelled" &&
        job.phase !== "done"
      ) {
        job = await json(
          base(draft.catalog) + "/operations/" + draft.id + "/retry",
          { method: "POST" },
        );
      }
      for (
        let i = 0;
        i < 50 &&
        job.phase !== "done" &&
        job.phase !== "cancelled" &&
        !job.error;
        i++
      ) {
        await delay(200);
        job = await getJob(draft.catalog, draft.id);
        if (!job)
          throw new Error(
            "The upload receipt is unavailable. Retry the draft.",
          );
      }
      if (job.phase !== "done" || job.error)
        throw new Error(
          job.error || "Sourcebook is still processing this file.",
        );
      await deleteDraft(draft.id);
      return true;
    } catch (error) {
      await putDraft({ ...draft, error: error.message });
      return false;
    }
  }

  async function queue(files, options = {}) {
    const { makeDraft, putDraft } = await storage();
    const drafts = [];
    for (const file of files) {
      const draft = { ...makeDraft(file, state.catalog?.id), ...options };
      await putDraft(draft);
      drafts.push(draft);
    }
    if (state.catalog && drafts.length > 1) {
      try {
        await prepareUploads(state.catalog.id, drafts);
      } catch {
        /* Each retained draft can still be attempted separately. */
      }
    }
    let completed = 0;
    for (const draft of drafts) if (await send(draft)) completed++;
    if (state.catalog) await browse();
    if (drafts.length)
      toast(
        completed === drafts.length
          ? completed + " saved."
          : "Capture kept in Needs attention.",
      );
  }

  async function capture(input) {
    const { captureEntries } = await storage();
    return queue(captureEntries(input));
  }

  async function onOpen() {
    const { readDrafts } = await storage();
    let changed = false;
    for (const draft of await readDrafts()) {
      if (
        draft.kind === "composer" ||
        draft.error ||
        (draft.catalog && draft.catalog !== state.catalog?.id)
      )
        continue;
      await send(draft);
      changed = true;
    }
    if (changed) await browse();
  }

  async function discard(draft) {
    const { deleteDraft } = await storage();
    if (active.has(draft.id))
      throw new Error("Wait for the active upload to finish.");
    if (draft.catalog && draft.kind !== "composer") {
      const job = await getJob(draft.catalog, draft.id);
      if (job && !["done", "cancelled"].includes(job.phase))
        await request(
          base(draft.catalog) + "/operations/" + draft.id + "/cancel",
          { method: "POST" },
        );
    }
    await deleteDraft(draft.id);
  }

  async function composer(existing) {
    const { putDraft, deleteDraft, makeDraft, captureEntries } =
      await storage();
    const draft = existing ?? {
      ...makeDraft(undefined, state.catalog?.id),
      kind: "composer",
      text: "",
      title: "",
      files: [],
    };
    const dialog = modal(
      "Capture",
      `${field("Name", "title", draft.title, 'maxlength="120"')}<label class="field">URL or text<textarea name="text" rows="5">${e(draft.text)}</textarea></label><label class="field">Attachments<input name="files" type="file" multiple></label><p data-attachments>${e(draft.files.map(({ name }) => name).join(" · "))}</p>`,
      {
        onSubmit: async () => {
          await pending;
          const files = captureEntries({
            text: draft.text,
            files: draft.files,
            title: draft.title,
          });
          if (!files.length)
            throw new Error("Enter a link or text, or attach a file.");
          const staged = files.map((file) =>
            makeDraft(file, state.catalog?.id),
          );
          for (const item of staged) await putDraft(item);
          await deleteDraft(draft.id);
          let completed = 0;
          for (const item of staged) if (await send(item)) completed++;
          await browse();
          toast(
            completed === staged.length
              ? completed + " saved."
              : "Capture kept in Needs attention.",
          );
        },
      },
    );
    let pending = Promise.resolve();
    const persist = () => {
      if (!draft.title && !draft.text && !draft.files.length) return;
      pending = pending.catch(() => {}).then(() => putDraft(draft));
      void pending.catch((error) => {
        $(".dialog-error", dialog).textContent = error.message;
      });
    };
    dialog.addEventListener("input", (event) => {
      if (event.target.name === "title") draft.title = event.target.value;
      if (event.target.name === "text") draft.text = event.target.value;
      persist();
    });
    dialog.addEventListener("change", (event) => {
      if (event.target.name !== "files") return;
      draft.files.push(...event.target.files);
      $("[data-attachments]", dialog).textContent = draft.files
        .map(({ name }) => name)
        .join(" · ");
      persist();
    });
  }

  async function attention(missing) {
    const { readDrafts } = await storage();
    const drafts = (await readDrafts()).filter(
      ({ catalog }) => !catalog || catalog === state.catalog.id,
    );
    const jobs = state.data?.jobs ?? [];
    const dialog = modal(
      "Needs attention",
      `
      <div class="catalog-list"><button type="button" data-missing>Missing files (${state.data?.missing ?? 0})</button>
      ${drafts
        .map(
          (
            draft,
          ) => `<div class="intake-item"><span>${e(draft.file?.name ?? (draft.title || draft.text || "Capture draft"))}<small>${e(draft.error || "Kept on this device")}</small></span>
        <button type="button" data-resume="${draft.id}">${draft.kind === "composer" ? "Open" : "Retry"}</button>
        <button type="button" data-discard="${draft.id}">Discard</button></div>`,
        )
        .join("")}
      ${jobs.length ? '<button type="button" data-jobs>Library operations</button>' : ""}
      </div>`,
    );
    const work = (fn) => (event) =>
      void fn(event).catch((error) => {
        $(".dialog-error", dialog).textContent = error.message;
      });
    $("[data-missing]", dialog).onclick = () => {
      dialog.close();
      missing();
    };
    const libraryJobs = $("[data-jobs]", dialog);
    if (libraryJobs)
      libraryJobs.onclick = () => {
        dialog.close();
        document.querySelector('[data-nav="inbox"]')?.click();
      };
    for (const button of dialog.querySelectorAll("[data-resume]")) {
      button.onclick = work(async () => {
        const draft = drafts.find(({ id }) => id === button.dataset.resume);
        if (draft.kind === "composer") {
          dialog.close();
          await composer(draft);
        } else {
          const complete = await send(draft);
          await browse();
          toast(
            complete ? "Capture saved." : "Capture kept in Needs attention.",
          );
          dialog.close();
          if (!complete) await attention(missing);
        }
      });
    }
    for (const button of dialog.querySelectorAll("[data-discard]")) {
      button.onclick = work(async () => {
        await discard(drafts.find(({ id }) => id === button.dataset.discard));
        button.closest(".intake-item").remove();
        await browse();
      });
    }
  }

  function connect(root, run) {
    document.addEventListener("paste", (event) => {
      if (!state.catalog || inField(event.target)) return;
      const data = event.clipboardData;
      if (
        !data ||
        !data.types.some((type) =>
          ["Files", "text/plain", "text/uri-list"].includes(type),
        )
      )
        return;
      event.preventDefault();
      void run(() =>
        capture({
          text: data.getData("text/plain"),
          uriList: data.getData("text/uri-list"),
          files: [...data.files],
        }),
      );
    });
    root.addEventListener("dragover", (event) => {
      if (
        !state.catalog ||
        inField(event.target) ||
        event.dataTransfer.types.includes("application/x-sourcebook-files")
      )
        return;
      if (
        event.dataTransfer.types.some((type) =>
          ["Files", "text/plain", "text/uri-list"].includes(type),
        )
      )
        event.preventDefault();
    });
    root.addEventListener("drop", (event) => {
      if (
        !state.catalog ||
        inField(event.target) ||
        event.dataTransfer.types.includes("application/x-sourcebook-files")
      )
        return;
      event.preventDefault();
      const data = event.dataTransfer;
      void run(() =>
        capture({
          text: data.getData("text/plain"),
          uriList: data.getData("text/uri-list"),
          files: [...data.files],
        }),
      );
    });
    globalThis.launchQueue?.setConsumer(({ files }) => {
      if (files?.length)
        void run(async () =>
          queue(await Promise.all(files.map((handle) => handle.getFile()))),
        );
    });
    if (new URLSearchParams(location.search).has("share-error"))
      toast("The browser could not retain the shared items. Share them again.");
  }

  return { attention, composer, connect, onOpen, queue };
}
