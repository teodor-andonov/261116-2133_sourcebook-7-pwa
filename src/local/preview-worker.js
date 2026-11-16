import { renderDerivatives } from "./preview-render.js";

self.onmessage = async ({ data: { id, file, name, page, frame } }) => {
  try {
    const result = await renderDerivatives(file, name, page, frame);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
