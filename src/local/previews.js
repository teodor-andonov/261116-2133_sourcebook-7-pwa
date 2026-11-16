import { describeFile } from "../core/file-types.js";

let worker;
let sequence = 0;
const pending = new Map();

function renderer() {
  if (worker) return worker;
  worker = new Worker(new URL("./preview-worker.js", import.meta.url), {
    type: "module",
  });
  worker.onmessage = ({ data: { id, result, error } }) => {
    const task = pending.get(id);
    if (!task) return;
    pending.delete(id);
    if (error) task.reject(new Error(error));
    else task.resolve(result);
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || "The preview worker stopped.");
    for (const task of pending.values()) task.reject(error);
    pending.clear();
    worker.terminate();
    worker = undefined;
  };
  return worker;
}

async function videoFrame(file) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Video preview timed out.")),
        3000,
      );
      video.onloadeddata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(video.error);
      };
      video.src = url;
    });
    return await createImageBitmap(video);
  } catch {
    return undefined;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function makeDerivatives(file, name, page = 1) {
  const frame =
    describeFile(name).type === "video" ? await videoFrame(file) : undefined;
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    try {
      renderer().postMessage(
        { id, file, name, page, frame },
        frame ? [frame] : [],
      );
    } catch (error) {
      pending.delete(id);
      frame?.close();
      reject(error);
    }
  });
}
