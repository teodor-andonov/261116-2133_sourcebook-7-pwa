import { captureEntries, makeDraft, putDraft } from "./intake-store.js";

export async function receiveShare(request, scope) {
  const origin = request.headers.get("Origin");
  if (
    (origin && origin !== self.location.origin) ||
    request.headers.get("Sec-Fetch-Site") === "cross-site"
  )
    return new Response("Share request did not come from this app.", {
      status: 403,
    });
  try {
    const data = await request.formData();
    const files = data
      .getAll("files")
      .filter((file) => file instanceof File && file.name);
    const text = String(data.get("text") ?? "");
    const url = String(data.get("url") ?? "");
    const title = String(data.get("title") ?? "");
    const entries = captureEntries({
      text: text || url || (!files.length ? title : ""),
      uriList: url,
      files,
      title,
    });
    for (const file of entries) await putDraft(makeDraft(file));
    return Response.redirect(new URL("?shared=1", scope), 303);
  } catch {
    return Response.redirect(new URL("?share-error=1", scope), 303);
  }
}
