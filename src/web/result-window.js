import { thumbnailRatio } from "../core/view-options.js";
export function resultWindow(host, state, before = 0) {
  if (state.data.count < 120) return null;
  const style = getComputedStyle(host);
  const width =
    host.clientWidth -
    parseFloat(style.paddingLeft) -
    parseFloat(style.paddingRight);
  const gallery = state.mode === "gallery";
  const ratio = thumbnailRatio(state.shape);
  const gap = 7;
  const columns = gallery
    ? Math.max(1, Math.floor((width + gap) / (state.size + gap)))
    : 1;
  const thumbnailWidth = gallery
    ? (width - (columns - 1) * gap) / columns
    : Math.max(26, Math.min(76, state.size / 4));
  const caption = Math.max(36, state.properties.length * 20 + 12);
  const height = gallery
    ? Math.ceil(thumbnailWidth / ratio + caption + 2)
    : Math.ceil(
        Math.max(
          38,
          thumbnailWidth / ratio + 8,
          state.mode === "list" ? caption : 38,
        ),
      );
  const step = height + gap;
  const startY = host.scrollTop;
  const endY = startY + host.clientHeight;
  let position = before;
  return {
    columns,
    height,
    slice(name, rows) {
      if (name) position += 30;
      const top = position;
      const count = Math.ceil(rows.length / columns);
      const first = Math.max(
        0,
        Math.min(count, Math.floor((startY - top) / step) - 3),
      );
      const last = Math.max(
        first,
        Math.min(count, Math.ceil((endY - top) / step) + 3),
      );
      position += count * step - gap + 12;
      const spacer = (id, size) =>
        size > 0
          ? `<div class="result-spacer" data-id="${id}" style="height:${size}px" aria-hidden="true"></div>`
          : "";
      const leading = first * step - gap;
      const trailing = (count - last) * step - gap;
      return {
        rows: rows.slice(first * columns, last * columns),
        top: spacer(
          "virtual-before",
          first === last ? count * step - gap : leading,
        ),
        bottom: first === last ? "" : spacer("virtual-after", trailing),
        offset: top,
        step,
      };
    },
  };
}
