import MarkdownIt from "markdown-it";
import highlight from "highlight.js/lib/common";

const markdown = new MarkdownIt({
  html: false,
  highlight: (text, language) => highlighted(text, language),
});
markdown.renderer.rules.image = (tokens, index) =>
  markdown.utils.escapeHtml(tokens[index].content);

function highlighted(text, language) {
  return language && highlight.getLanguage(language)
    ? highlight.highlight(text, { language, ignoreIllegals: true }).value
    : "";
}

export function textPreview(
  text,
  { markdown: isMarkdown, extension },
  { source = false } = {},
) {
  isMarkdown &&= !source;
  const node = document.createElement(isMarkdown ? "article" : "pre");
  node.className = isMarkdown ? "rendered-markdown" : "markdown-source";
  if (isMarkdown) node.innerHTML = markdown.render(text);
  else {
    const code = source ? "" : highlighted(text, extension);
    if (code) node.innerHTML = code;
    else node.textContent = text;
  }
  return node;
}
