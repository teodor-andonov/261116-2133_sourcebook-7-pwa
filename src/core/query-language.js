const fields = new Set([
  "text",
  "name",
  "title",
  "notes",
  "tag",
  "type",
  "folder",
  "source",
  "status",
  "id",
  "membership",
]);
const cache = new Map();
export function parseQuery(text = "") {
  if (cache.has(text)) return cache.get(text);
  const tokens = [];
  let at = 0;
  const pattern =
    /\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|!=|!~|[()\[\]=~]|[^\s()\[\]=~!"']+)/gy;
  while (at < text.length && text.slice(at).trim()) {
    pattern.lastIndex = at;
    const match = pattern.exec(text);
    if (!match)
      throw Error(`Unexpected character at ${at + 1}. Use =, !=, ~ or !~.`);
    const raw = match[1] === "[" ? "(" : match[1] === "]" ? ")" : match[1],
      quoted = /^["']/.test(raw);
    let value = raw;
    if (quoted) {
      try {
        value =
          raw[0] === '"'
            ? JSON.parse(raw)
            : raw.slice(1, -1).replace(/\\'/g, "'");
      } catch {
        throw Error("Unfinished quoted value");
      }
    }
    tokens.push({ value, quoted });
    at = pattern.lastIndex;
  }
  let i = 0;
  const peek = (word) =>
    !tokens[i]?.quoted && tokens[i]?.value.toUpperCase() === word;
  const atom = () => {
    if (peek("NOT")) {
      i++;
      return { not: atom() };
    }
    if (peek("(")) {
      i++;
      const result = or();
      if (!peek(")")) throw Error("Missing closing parenthesis");
      i++;
      return result;
    }
    const first = tokens[i++];
    if (
      !first ||
      ([")", "AND", "OR"].includes(first.value.toUpperCase()) && !first.quoted)
    )
      throw Error("Expected a filter or search word");
    const op = tokens[i]?.value.toLowerCase();
    if (["=", "!=", "~", "!~", "contains"].includes(op)) {
      i++;
      const field = first.value.toLowerCase();
      if (!fields.has(field)) throw Error(`Unknown property: ${first.value}`);
      const value = tokens[i++];
      if (
        !value ||
        (!value.quoted &&
          ["AND", "OR", "(", ")"].includes(value.value.toUpperCase()))
      )
        throw Error(`Enter a value after ${field} ${op}`);
      return { field, op: op === "contains" ? "~" : op, value: value.value };
    }
    return { field: "text", op: "~", value: first.value };
  };
  const and = () => {
    let result = atom();
    while (i < tokens.length && !peek(")") && !peek("OR")) {
      if (peek("AND")) i++;
      result = { and: [result, atom()] };
    }
    return result;
  };
  const or = () => {
    let result = and();
    while (peek("OR")) {
      i++;
      result = { or: [result, and()] };
    }
    return result;
  };
  const result = tokens.length ? or() : null;
  if (i !== tokens.length) throw Error("Unexpected closing parenthesis");
  cache.set(text, result);
  if (cache.size > 32) cache.delete(cache.keys().next().value);
  return result;
}
export function formatQuery(node) {
  if (!node) return "";
  if (node.and || node.or)
    return `(${(node.and || node.or).map(formatQuery).join(node.and ? " AND " : " OR ")})`;
  if (node.not) return `NOT (${formatQuery(node.not)})`;
  if (node.field === "text" && node.op === "~")
    return JSON.stringify(node.value);
  return `${node.field} ${node.op} ${JSON.stringify(node.value)}`;
}
export function queryClauses(node) {
  return node?.and ? node.and.flatMap(queryClauses) : node ? [node] : [];
}
export function setQueryClause(text, field, op, value) {
  const remove = (node) => {
    if (node?.field === field) return null;
    if (node?.and) {
      const items = node.and.map(remove).filter(Boolean);
      return items.length > 1 ? { and: items } : items[0] || null;
    }
    return node;
  };
  const base = remove(parseQuery(text)),
    next = value ? { field, op, value } : null;
  return formatQuery(base && next ? { and: [base, next] } : base || next);
}
export function toggleQueryClause(text, field, op, value) {
  let found = false;
  const remove = (node) => {
    if (
      node?.field === field &&
      node.op === op &&
      node.value.toLowerCase() === value.toLowerCase()
    ) {
      found = true;
      return null;
    }
    if (node?.and) {
      const parts = node.and.map(remove).filter(Boolean);
      return parts.length > 1 ? { and: parts } : parts[0] || null;
    }
    return node;
  };
  const base = remove(parseQuery(text)),
    clause = { field, op, value };
  return formatQuery(found ? base : base ? { and: [base, clause] } : clause);
}
export function matchQuery(row, node) {
  if (!node) return true;
  if (node.and) return node.and.every((n) => matchQuery(row, n));
  if (node.or) return node.or.some((n) => matchQuery(row, n));
  if (node.not) return !matchQuery(row, node.not);
  const normalize = (value) =>
    String(value ?? "")
      .toLowerCase()
      .split("/")
      .map((s) => s.trim())
      .join("/");
  const value = normalize(node.value),
    contains = node.op.includes("~");
  let candidates;
  switch (node.field) {
    case "text":
      candidates = [
        `${row.title} ${row.name} ${row.notes || ""} ${(row.tags || []).join(" ")}`,
      ];
      break;
    case "tag":
      candidates = row.tags || [];
      break;
    case "folder":
      candidates = [
        row.sourceName + (row.folder ? "/" + row.folder : ""),
        row.folder || "",
      ];
      break;
    case "source":
      candidates = [row.sourceName, row.source];
      break;
    case "type":
      candidates = [row.type, row.name?.split(".").at(-1)];
      break;
    case "status":
      candidates = [
        row.stale ? "cached" : row.available ? "available" : "unavailable",
      ];
      break;
    case "membership":
      candidates = [row.object ? "cataloged" : "uncataloged"];
      break;
    default:
      candidates = [row[node.field]];
  }
  const matched = candidates.some((candidate) => {
    const actual = normalize(candidate);
    if (node.field === "tag")
      return actual === value || actual.startsWith(value + "/");
    if (node.field === "folder" && contains)
      return actual === value || actual.startsWith(value + "/");
    return contains ? actual.includes(value) : actual === value;
  });
  return node.op.startsWith("!") ? !matched : matched;
}

export function rewriteQueryPath(text, field, rewrite) {
  function visit(node) {
    if (!node) return node;
    if (node.and) return { and: node.and.map(visit) };
    if (node.or) return { or: node.or.map(visit) };
    if (node.not) return { not: visit(node.not) };
    return node.field === field
      ? { ...node, value: rewrite(node.value) }
      : node;
  }
  return formatQuery(visit(parseQuery(text)));
}
