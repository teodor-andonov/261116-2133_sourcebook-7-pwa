// The single extension registry used by filters, viewers and file symbols.
const groups = [
  [
    "image",
    "image",
    "hsl(300 50% 50%)",
    "jpg jpeg png webp gif avif bmp svg ico",
  ],
  ["pdf", "file-text", "hsl(0 50% 50%)", "pdf"],
  ["video", "video", "hsl(270 50% 50%)", "mp4 webm mov m4v mkv avi"],
  ["audio", "audio", "hsl(180 50% 50%)", "mp3 wav ogg opus flac m4a aac"],
  ["link", "link", "hsl(210 50% 50%)", "url sblink"],
  ["text", "file-text", "hsl(150 50% 50%)", "md markdown txt log csv tsv"],
  [
    "code",
    "code",
    "hsl(60 50% 50%)",
    "js mjs cjs ts tsx jsx json jsonl css scss xml yaml yml toml ini py rs go java c cpp h hpp sh ps1 sql rb",
  ],
  ["html", "code", "hsl(25 50% 50%)", "html htm"],
  ["archive", "archive", "hsl(30 50% 50%)", "zip rar 7z tar gz bz2 xz zst tgz"],
  ["file", "file-text", "hsl(240 50% 50%)", "doc docx odt"],
  ["file", "table", "hsl(120 50% 50%)", "xls xlsx ods"],
  ["file", "file-text", "hsl(330 50% 50%)", "ppt pptx odp"],
  [
    "file",
    "box",
    "hsl(90 50% 50%)",
    "3dm glb gltf obj stl fbx dwg dxf ifc rvt rfa skp blend",
  ],
];
const extensions = new Map();
for (const [type, icon, color, names] of groups)
  for (const ext of names.split(" "))
    extensions.set(ext, { type, icon, color });
export function describeFile(name = "", kind = "file") {
  if (kind === "directory")
    return {
      type: "folder",
      icon: "folder",
      color: "hsl(30 50% 50%)",
      label: "Folder",
      ext: "",
    };
  const ext = /\.([^.]+)$/.exec(name)?.[1].toLowerCase() || "";
  return {
    ...(extensions.get(ext) || {
      type: "file",
      icon: "file",
      color: "hsl(210 50% 50%)",
    }),
    ext,
    label: ext.toUpperCase().slice(0, 5) || "FILE",
  };
}
export const fileTypes = [
  "image",
  "pdf",
  "video",
  "audio",
  "link",
  "text",
  "code",
  "html",
  "archive",
  "file",
];
