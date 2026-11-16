export function formatBytes(n) {
  if (n < 1024) return n + " B";
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < 3);
  return (
    n.toLocaleString(undefined, { maximumFractionDigits: 1 }) + " " + units[i]
  );
}
export function formatDate(value) {
  const d = new Date(value);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "";
}
