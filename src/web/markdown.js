import { $, modal } from "./dom.js";
import { request } from "./transport.js";

const sessions = new Map();

async function readMarkdown(endpoint) {
  const response = await request(endpoint);
  return {
    text: (await response.json()).text,
    version: response.headers.get("ETag"),
  };
}

function remember(key, draft) {
  try {
    if (draft) localStorage.setItem(key, JSON.stringify(draft));
    else localStorage.removeItem(key);
  } catch {}
}

export async function editMarkdown(row, endpoint, onSaved) {
  endpoint += "/markdown";
  const key = "sourcebook:markdown:" + endpoint;
  let session = sessions.get(key);
  if (session?.dialog?.open) return;
  if (!session) {
    const saved = await readMarkdown(endpoint);
    session = sessions.get(key);
    if (session?.dialog?.open) return;
    if (!session) {
      let draft;
      try {
        draft = JSON.parse(localStorage.getItem(key));
      } catch {}
      session = {
        saved,
        draft,
        status: draft ? "Recovered unsaved draft." : "",
      };
      sessions.set(key, session);
    }
  }

  const dialog = modal(
    row.title,
    `<label class="field">Markdown<textarea name="markdown" spellcheck="false" autofocus></textarea></label>
    <small role="status"></small><button type="button" data-retry hidden>Retry</button>
    <details data-saved-version hidden><summary>Compare saved Markdown</summary><pre></pre></details>`,
    {
      className: "markdown-editor",
      onClose: () => {
        if (session.dialog !== dialog) return;
        session.dialog = null;
        session.render = null;
        if (!session.failed) void save();
        release();
      },
    },
  );
  session.dialog = dialog;
  const field = $("textarea", dialog);
  const retry = $("[data-retry]", dialog);
  const comparison = $("[data-saved-version]", dialog);
  field.value = session.draft?.text ?? session.saved.text;
  session.render = () => {
    $('[role="status"]', dialog).textContent = session.status;
    retry.hidden = session.saving || !session.draft;
    comparison.hidden = !session.conflict;
    if (session.conflict) $("pre", comparison).textContent = session.saved.text;
  };
  session.conflict ||=
    !!session.draft &&
    session.draft.version !== session.saved.version &&
    !session.saving;
  session.render();

  function release() {
    if (!session.dialog && !session.draft && !session.saving)
      sessions.delete(key);
  }

  async function save() {
    clearTimeout(session.timer);
    if (session.saving || !session.draft) return;
    session.saving = true;
    session.failed = false;
    const submitted = session.draft;
    session.status = "Saving…";
    session.render?.();
    try {
      const response = await request(endpoint, {
        method: "PUT",
        rawBody: submitted.text,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "If-Match": submitted.version,
        },
      });
      const version = response.headers.get("ETag");
      session.saved = { text: submitted.text, version };
      session.draft =
        session.draft === submitted ? undefined : { ...session.draft, version };
      remember(key, session.draft);
      session.conflict = false;
      session.status = "Markdown saved.";
    } catch (error) {
      session.failed = true;
      session.status = error.message;
      if (error.status === 409 || error.status === 412) {
        try {
          session.saved = await readMarkdown(endpoint);
          if (session.saved.text === submitted.text) {
            session.draft =
              session.draft === submitted
                ? undefined
                : { ...session.draft, version: session.saved.version };
            remember(key, session.draft);
            session.failed = session.conflict = false;
            session.status = "Markdown saved.";
          } else session.conflict = true;
        } catch {}
      }
    } finally {
      session.saving = false;
      session.render?.();
      release();
    }
    if (session.failed) return;
    if (session.draft) void save();
    else await onSaved();
  }

  retry.onclick = () => void save();
  field.oninput = () => {
    session.draft = {
      text: field.value,
      version: session.draft?.version ?? session.saved.version,
    };
    remember(key, session.draft);
    session.status = "Unsaved changes";
    session.render();
    clearTimeout(session.timer);
    session.timer = setTimeout(() => void save(), 650);
  };
}
