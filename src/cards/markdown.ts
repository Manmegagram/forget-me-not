/**
 * Small, safe Markdown renderer for card content.
 * All input is HTML-escaped first; only the constructs below produce markup.
 * Supports: headings, bold, italic, strike, inline code, code blocks, lists,
 * blockquotes, links, images (http/https/data URLs), line breaks and KaTeX math
 * ($inline$, $$display$$, \( \), \[ \]).
 */
import katex from 'katex';

const PH = (i: number) => `\u0000${i}\u0000`;
const PH_RE = /\u0000(\d+)\u0000/g;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(url: string, allowData: boolean): string | null {
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (allowData && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(u)) return u;
  return null;
}

function renderMath(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'htmlAndMathml' });
  } catch {
    return `<code>${escapeHtml(tex)}</code>`;
  }
}

export interface RenderOptions {
  /** Pre-rendered HTML fragments that the caller already placed as \u0000n\u0000 tokens. */
  fragments?: string[];
}

/** Renders inline markdown (no block structure). */
function inline(text: string, store: string[]): string {
  let s = text;
  // images ![alt](url)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, url: string) => {
    const safe = safeUrl(decodeEntities(url), true);
    if (!safe) return _m;
    store.push(`<img src="${escapeHtml(safe)}" alt="${alt}" loading="lazy" decoding="async">`);
    return PH(store.length - 1);
  });
  // links [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    const safe = safeUrl(decodeEntities(url), false);
    if (!safe) return _m;
    return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  // inline code
  s = s.replace(/`([^`]+)`/g, (_m, code: string) => {
    store.push(`<code>${code}</code>`);
    return PH(store.length - 1);
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[\s(])_([^_\s][^_]*)_/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return s;
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

export function renderMarkdown(source: string, opts: RenderOptions = {}): string {
  const store: string[] = [...(opts.fragments ?? [])];
  let text = source.replace(/\r\n?/g, '\n');

  // Pull out code blocks and math before escaping so their contents stay intact.
  text = text.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_m, code: string) => {
    store.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`);
    return `\n${PH(store.length - 1)}\n`;
  });
  text = text.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (_m, a?: string, b?: string) => {
    store.push(`<div class="math-display">${renderMath((a ?? b ?? '').trim(), true)}</div>`);
    return PH(store.length - 1);
  });
  text = text.replace(/\\\(([\s\S]+?)\\\)|(?<![\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\w$])/g, (_m, a?: string, b?: string) => {
    store.push(renderMath((a ?? b ?? '').trim(), false));
    return PH(store.length - 1);
  });

  // Allow a tiny whitelist of HTML from Anki-style content: <br>, <b>, <i>, <u>, <sub>, <sup>.
  text = escapeHtml(text).replace(/&lt;(\/?)(br|b|i|u|sub|sup)\s*\/?&gt;/gi, '<$1$2>');

  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length + 2; // h3..h5 inside a card
      out.push(`<h${level}>${inline(heading[2], store)}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*[-*•]\s+/, ''), store)}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*\d+[.)]\s+/, ''), store)}</li>`);
        i++;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }
    if (/^&gt;\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i])) {
        quote.push(inline(lines[i].replace(/^&gt;\s?/, ''), store));
        i++;
      }
      out.push(`<blockquote>${quote.join('<br>')}</blockquote>`);
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]) &&
      !/^&gt;/.test(lines[i])
    ) {
      para.push(inline(lines[i], store));
      i++;
    }
    out.push(`<p>${para.join('<br>')}</p>`);
  }

  let html = out.join('');
  // Restore placeholders (fragments may contain further placeholders).
  for (let pass = 0; pass < 3 && html.includes('\u0000'); pass++) {
    html = html.replace(PH_RE, (_m, n: string) => store[Number(n)] ?? '');
  }
  // A paragraph that only wraps a block placeholder should not be a <p>.
  return html.replace(/<p>(<(?:pre|div)[\s\S]*?<\/(?:pre|div)>)<\/p>/g, '$1');
}

/** Plain text (for TTS, previews and search). */
export function toPlainText(source: string): string {
  return source
    .replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`~#>]/g, '')
    .replace(/\$\$?([^$]+)\$\$?/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
