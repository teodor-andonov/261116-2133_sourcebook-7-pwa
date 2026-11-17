function syncChildren(host, next, key, update) {
  const existing = new Map(
    [...host.children].map((element) => [key(element), element]),
  );
  let position = 0;
  for (const child of [...next.children]) {
    const id = key(child);
    const previous = existing.get(id);
    const element = previous && update(previous, child) ? previous : child;
    const anchor = host.children[position++] ?? null;
    if (element !== anchor) host.insertBefore(element, anchor);
    if (previous !== element) previous?.remove();
    existing.delete(id);
  }
  for (const element of existing.values()) element.remove();
}

export function reconcileResults(host, markup) {
  const next = document.createElement("template");
  next.innerHTML = markup;
  syncChildren(
    host,
    next.content,
    (element) => element.dataset.group ?? element.className,
    (before, after) => {
      const oldItems = before.querySelector(".server-items");
      const newItems = after.querySelector(".server-items");
      if (!oldItems || !newItems) return before.isEqualNode(after);
      before.dataset.offset = after.dataset.offset;
      before.dataset.step = after.dataset.step;
      syncChildren(
        oldItems,
        newItems,
        (item) => item.dataset.id,
        (oldItem, newItem) => {
          if (oldItem.isEqualNode(newItem)) return true;
          if (oldItem.classList.contains("result-spacer")) {
            oldItem.style.height = newItem.style.height;
            return true;
          }
          const oldImage = oldItem.querySelector(
            ".thumbnail img[data-thumbnail]",
          );
          const newImage = newItem.querySelector(
            ".thumbnail img[data-thumbnail]",
          );
          if (
            oldImage &&
            newImage?.dataset.thumbnail === oldImage.dataset.thumbnail
          )
            newImage.replaceWith(oldImage);
          const previousButton = oldItem.querySelector(".file-item");
          const nextButton = newItem.querySelector(".file-item");
          previousButton.className = nextButton.className;
          previousButton.setAttribute(
            "aria-pressed",
            nextButton.getAttribute("aria-pressed"),
          );
          previousButton.setAttribute(
            "aria-label",
            nextButton.getAttribute("aria-label"),
          );
          previousButton.replaceChildren(...nextButton.children);
          const previousCheck = oldItem.querySelector(".selection-check");
          const nextCheck = newItem.querySelector(".selection-check");
          previousCheck.checked = nextCheck.checked;
          previousCheck.setAttribute(
            "aria-label",
            nextCheck.getAttribute("aria-label"),
          );
          return true;
        },
      );
      return true;
    },
  );
}
