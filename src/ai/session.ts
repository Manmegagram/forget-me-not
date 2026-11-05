/** Chat session state: building API turns, applying model output to the draft, persistence. */
import type { BetaContentBlockParam, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { db, uid } from '../db/schema';
import type { ChatDraft, ChatImage, ChatMessage, ChatSession, DraftCard, Language, NoteType } from '../db/types';
import { parseImport, type ParsedImport } from '../db/import';
import { buildUserText, describeDraft, type AiOutput } from './prompt';

export function emptyDraft(): ChatDraft {
  return { deck: '', tags: [], cards: [] };
}

export function newSession(now = Date.now()): ChatSession {
  return { id: uid(), title: '', messages: [], draft: emptyDraft(), draftSeen: describeDraft(emptyDraft()), pendingNotice: '', createdAt: now, updatedAt: now };
}

export function blankCard(type: NoteType = 'basic'): DraftCard {
  return { id: uid(), type, front: '', back: '', note: '', text: '', extra: '', reverse: false };
}

/** Applies one model response to the draft. */
export function applyOutput(draft: ChatDraft, out: AiOutput): ChatDraft {
  if (out.action === 'none') return { ...draft, deck: draft.deck || out.deck, tags: draft.tags.length ? draft.tags : out.tags };
  const cards: DraftCard[] = out.cards.map((c) => ({ id: uid(), ...c }));
  return {
    deck: out.deck || draft.deck,
    tags: out.tags.length ? out.tags : draft.tags,
    cards: out.action === 'append' ? [...draft.cards, ...cards] : cards,
  };
}

/** Builds the next user message. The draft is described only when it changed since the model last saw it. */
export function makeUserMessage(
  session: ChatSession,
  input: { text: string; images: ChatImage[]; language: Language; deckNames: string[] },
): { message: ChatMessage; draftSeen: string } {
  const desc = describeDraft(session.draft);
  const firstTurn = !session.messages.some((m) => m.role === 'user');
  const changed = desc !== session.draftSeen;
  const apiText = buildUserText({
    text: input.text,
    language: input.language,
    decks: firstTurn ? input.deckNames : [],
    draft: changed || firstTurn ? desc : null,
    notice: session.pendingNotice || undefined,
  });
  return {
    message: { id: uid(), role: 'user', text: input.text.trim(), images: input.images.length ? input.images : undefined, apiText, createdAt: Date.now() },
    draftSeen: desc,
  };
}

/** Converts stored messages into API turns. Notices are local only. */
export function toApiMessages(messages: ChatMessage[]): BetaMessageParam[] {
  const out: BetaMessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      const content: BetaContentBlockParam[] = [
        ...(m.images ?? []).map((img) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: img.mediaType, data: img.data } })),
        { type: 'text' as const, text: m.apiText ?? m.text },
      ];
      out.push({ role: 'user', content });
    } else if (m.role === 'assistant' && m.content) {
      out.push({ role: 'assistant', content: m.content as BetaContentBlockParam[] });
    }
  }
  return out;
}

export function sessionTitle(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > 48 ? `${line.slice(0, 48)}…` : line;
}

/** Draft -> the import pipeline's parsed form (validation, checksums, card counts). */
export function draftToParsed(draft: ChatDraft): ParsedImport {
  const parsed = parseImport(
    JSON.stringify({
      deck: draft.deck || 'AI',
      tags: draft.tags,
      cards: draft.cards.map(({ type, front, back, note, text, extra, reverse }) => ({ type, front, back, note, text, extra, reverse })),
    }),
  );
  return { ...parsed, errors: draft.cards.length ? parsed.errors : [] };
}

export async function saveSession(s: ChatSession): Promise<void> {
  await db.chatSessions.put({ ...s, updatedAt: Date.now() });
}

export async function deleteSession(id: string): Promise<void> {
  await db.chatSessions.delete(id);
}

export async function latestSession(): Promise<ChatSession | undefined> {
  return db.chatSessions.orderBy('updatedAt').last();
}

/** Reads an image file, downsizes it (long side <= 1568 px) and returns base64 JPEG. */
export async function fileToChatImage(file: File, maxSide = 1568): Promise<ChatImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image_decode'));
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { mediaType: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
