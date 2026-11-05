import type { Note } from '../db/types';
import { escapeHtml, renderMarkdown, toPlainText } from './markdown';
import { CLOZE_RE, parseMasks } from './noteTypes';

export interface RenderedCard {
  question: string;
  answer: string;
  /** For type-in cards: the expected answer in plain text. */
  typeAnswer?: string;
  /** Plain text for text-to-speech. */
  speakFront: string;
  speakBack: string;
  /** Image occlusion data, rendered by a dedicated component. */
  occlusion?: { image: string; masks: ReturnType<typeof parseMasks>; active: number };
}

function noteBlock(text: string | undefined): string {
  if (!text?.trim()) return '';
  return `<div class="card-note">${renderMarkdown(text)}</div>`;
}

function renderCloze(text: string, activeOrd: number, reveal: boolean): string {
  const fragments: string[] = [];
  const active = activeOrd + 1;
  const replaced = text.replace(CLOZE_RE, (_m, num: string, body: string, hint?: string) => {
    const n = Number(num);
    let html: string;
    if (n !== active) html = renderMarkdown(body).replace(/^<p>|<\/p>$/g, '');
    else if (reveal) html = `<span class="cloze cloze-revealed">${renderMarkdown(body).replace(/^<p>|<\/p>$/g, '')}</span>`;
    else html = `<span class="cloze">[${hint ? escapeHtml(hint) : '…'}]</span>`;
    fragments.push(html);
    return `\u0000${fragments.length - 1}\u0000`;
  });
  return renderMarkdown(replaced, { fragments });
}

export function renderCard(note: Note, ord: number): RenderedCard {
  const f = note.fields;
  switch (note.type) {
    case 'basic':
    case 'typein':
    case 'reverse':
    case 'optionalReverse': {
      const reversed = ord === 1 && note.type !== 'basic' && note.type !== 'typein';
      const q = reversed ? f.back : f.front;
      const a = reversed ? f.front : f.back;
      const question = renderMarkdown(q ?? '');
      return {
        question,
        answer: `${question}<hr class="answer-divider">${renderMarkdown(a ?? '')}${noteBlock(f.note)}`,
        typeAnswer: note.type === 'typein' ? toPlainText(a ?? '') : undefined,
        speakFront: toPlainText(q ?? ''),
        speakBack: toPlainText(a ?? ''),
      };
    }
    case 'cloze': {
      const text = f.text ?? '';
      const answerText = (() => {
        const active = ord + 1;
        const parts: string[] = [];
        for (const m of text.matchAll(CLOZE_RE)) if (Number(m[1]) === active) parts.push(m[2]);
        return parts.join(', ');
      })();
      return {
        question: renderCloze(text, ord, false),
        answer: `${renderCloze(text, ord, true)}${noteBlock(f.extra)}`,
        speakFront: toPlainText(text.replace(CLOZE_RE, (_m, n: string, b: string) => (Number(n) === ord + 1 ? '...' : b))),
        speakBack: toPlainText(answerText),
      };
    }
    case 'imageOcclusion': {
      const masks = parseMasks(f.masks);
      const header = f.header ? renderMarkdown(f.header) : '';
      return {
        question: header,
        answer: `${header}${noteBlock(f.extra)}`,
        speakFront: toPlainText(f.header ?? ''),
        speakBack: toPlainText(masks[ord]?.label ?? ''),
        occlusion: { image: f.image ?? '', masks, active: ord },
      };
    }
  }
}

/** Character-level comparison for type-in answers (Anki style). */
export function compareTyped(typed: string, expected: string): Array<{ text: string; kind: 'ok' | 'bad' | 'missing' }> {
  const a = typed.trim();
  const b = expected.trim();
  const n = a.length;
  const m = b.length;
  // LCS table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i].toLowerCase() === b[j].toLowerCase() ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: Array<{ text: string; kind: 'ok' | 'bad' | 'missing' }> = [];
  const push = (text: string, kind: 'ok' | 'bad' | 'missing') => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ text, kind });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].toLowerCase() === b[j].toLowerCase()) {
      push(b[j], 'ok');
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push(a[i], 'bad');
      i++;
    } else {
      push(b[j], 'missing');
      j++;
    }
  }
  while (i < n) push(a[i++], 'bad');
  while (j < m) push(b[j++], 'missing');
  return out;
}
