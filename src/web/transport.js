import { libraryFor } from "../local/libraries.js";
import { Problem } from "../local/files.js";
import { appBase } from "../local/app-location.js";

function command(path) {
  const url = new URL(path, location.origin);
  const [area, domain, library, ...parts] = url.pathname
    .split("/")
    .slice(1)
    .map(decodeURIComponent);
  if (area !== "local" || domain !== "libraries")
    throw new Problem(404, "Unknown library operation.");
  return {
    library: libraryFor(library),
    parts,
    query: Object.fromEntries(url.searchParams),
  };
}

export async function request(
  path,
  { method = "GET", body, rawBody, headers, signal } = {},
) {
  signal?.throwIfAborted();
  const {
    library,
    parts: [area, id, action, subaction],
    query,
  } = command(path);
  const mutate = (operation) => library.write(operation);
  let result;
  let responseHeaders;
  if (!area) result = library.settings();
  else if (area === "browse") result = await library.browse(query);
  else if (area === "activity") result = library.activity(query.ids);
  else if (area === "settings")
    result = await mutate(() => library.changeSettings(body));
  else if (area === "view-settings")
    result = await mutate(() => library.view("preset", null, body));
  else if (area === "views")
    result = await mutate(() =>
      library.view(method === "DELETE" ? "remove" : "save", id, body),
    );
  else if (area === "folders") {
    if (id === "inspect") result = await library.inspectFolder(query.folder);
    else if (method === "POST")
      await mutate(() => library.createFolder(body.parent, body.name));
    else await mutate(() => library.changeFolder(body));
  } else if (area === "tags") {
    result =
      id === "selection"
        ? library.selectionTags(body.ids)
        : await mutate(() => library.bulkTags(body));
  } else if (area === "tag-branch") await mutate(() => library.changeTag(body));
  else if (area === "inbox")
    result = await mutate(() => library.importInbox(body.name, body.folder));
  else if (area === "operations") {
    if (method === "GET") result = library.job(id);
    else if (!id) result = await mutate(() => library.batch(body));
    else if (id === "cancel") result = await mutate(() => library.cancelAll());
    else if (action === "cancel")
      result = await mutate(() => library.cancel(id));
    else if (action === "retry")
      result = await mutate(() => library.execute(library.job(id)));
  } else if (area === "resources") {
    if (action === "markdown") {
      if (method === "GET") {
        const { text, version } = await library.readMarkdown(id);
        result = { text };
        responseHeaders = { ETag: version };
      } else {
        const version = await mutate(() =>
          library.saveMarkdown(
            id,
            new Headers(headers).get("If-Match"),
            rawBody,
          ),
        );
        return new Response(null, { status: 204, headers: { ETag: version } });
      }
    } else if (action === "relink")
      result =
        method === "GET"
          ? library.relinkCandidates(id)
          : await mutate(() => library.relink(id, body.target));
    else if (action === "preview" && subaction === "rebuild")
      void library.generate(id, true);
    else if (action) {
      const data = await library.media(id, action, Number(query.page ?? 1));
      if (action === "text-preview") result = data;
      else {
        const blob = action === "preview" ? data.result : data;
        if (!blob) throw new Problem(404, "The preview is still unavailable.");
        signal?.throwIfAborted();
        return new Response(blob, {
          headers:
            action === "preview"
              ? { "X-Sourcebook-Pages": String(data.pages) }
              : {},
        });
      }
    } else if (method === "PATCH")
      result = await mutate(() => library.edit(id, body));
  } else throw new Problem(404, "Unknown library operation.");
  signal?.throwIfAborted();
  return result === undefined
    ? new Response(null, { status: 204 })
    : Response.json(result, { headers: responseHeaders });
}

export async function json(path, options) {
  return (await request(path, options)).json();
}

export function upload(path, file, onProgress) {
  const {
    library,
    parts: [, receipt],
    query,
  } = command(path);
  return library.write(() => library.upload(receipt, query, file, onProgress));
}

export function prepareUploads(id, drafts) {
  const library = libraryFor(id);
  return library.write(() => library.prepareUploads(drafts));
}

export function originalFile(path) {
  const {
    library,
    parts: [, id],
  } = command(path);
  const row = library.row(id);
  return library
    .original(id)
    .then((blob) => new File([blob], row.originalName, { type: blob.type }));
}

export async function downloadOriginal(path) {
  const file = await originalFile(path);
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function fileLink(path) {
  const {
    library,
    parts: [, id],
  } = command(path);
  const url = new URL(appBase, location.origin);
  url.searchParams.set("library", library.info.id);
  url.searchParams.set("file", id);
  return url.href;
}
