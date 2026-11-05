import { motion } from 'framer-motion';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatDraft, ChatImage, ChatMessage, ChatSession, Deck, DraftCard, NoteType } from '../db/types';
import { db } from '../db/schema';
import { deckFullName, getSettings, updateSettings } from '../db/repo';
import { useSettings } from '../state';
import { useT, type StringKey } from '../i18n';
import { ConfirmSheet, Menu, Sheet, spring, useToast } from '../ui/components';
import { IconClose, IconImport, IconMore, IconPlus, IconReset, IconSettings, IconSpark, IconTrash, IconEdit, IconImage, IconSend, IconStop, IconCopy, IconHistory } from '../ui/icons';
import { AI_CARD_TYPES, describeDraft, externalPrompt } from '../ai/prompt';
import { formatUsd, getAiModel } from '../ai/models';
import {
  applyOutput,
  blankCard,
  deleteSession,
  draftToParsed,
  emptyDraft,
  fileToChatImage,
  latestSession,
  makeUserMessage,
  newSession,
  saveSession,
  sessionTitle,
  toApiMessages,
} from '../ai/session';
import { uid } from '../db/schema';
import { ImportReview, type ImportOutcome } from './ImportReview';
import { ImportSheet } from './ImportSheet';
import { AiKeySheet } from './AiKeySheet';
import { CardFieldsForm } from './CardFieldsForm';

const MAX_IMAGES = 4;

interface Busy {
  controller: AbortController;
  cards: number;
  reply: string;
  startedAt: number;
}

/** Full-screen chat for creating cards with Claude: chat -> draft -> review -> import. */
export function ChatScreen({ decks, onExit }: { decks: Deck[]; onExit: () => void }) {
  const { t, lang } = useT();
  const toast = useToast();
  const settings = useSettings();
  const [session, setSession] = useState<ChatSession | null>(null);
  const [text, setText] = useState('');
  const [images, setImages] = useState<ChatImage[]>([]);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<{ code: string; detail?: string } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [editing, setEditing] = useState<DraftCard | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [clearDraft, setClearDraft] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void latestSession().then((s) => setSession(s ?? newSession()));
  }, []);

  // Keep the newest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (el && (session?.messages.length || busy || error)) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [session?.messages.length, busy?.reply, busy?.cards, error]);

  // Abort an in-flight request when leaving the screen.
  useEffect(() => () => busy?.controller.abort(), [busy]);

  const hasKey = !!settings.apiKey;
  const model = getAiModel(settings.aiModel);
  const draft = session?.draft ?? emptyDraft();
  const parsed = useMemo(() => draftToParsed(draft), [draft]);
  const lastAssistant = [...(session?.messages ?? [])].reverse().find((m) => m.role === 'assistant');
  const deckNames = useMemo(() => decks.map((d) => deckFullName(d.id, decks)).sort(), [decks]);

  const commit = (next: ChatSession) => {
    setSession(next);
    if (next.messages.length || next.draft.cards.length) void saveSession(next);
  };

  const send = async (
    raw: string,
    imgs: ChatImage[],
    opts: { base?: ChatSession | null; reuse?: ChatMessage; rollback?: ChatSession } = {},
  ) => {
    const base = opts.base ?? session;
    if (!base || busy) return;
    if (!raw.trim() && !imgs.length) return;
    if (!hasKey) {
      setKeyOpen(true);
      return;
    }
    setError(null);
    // Regenerate resends the original turn byte-for-byte; otherwise build a new one.
    const { message, draftSeen } = opts.reuse
      ? { message: opts.reuse, draftSeen: describeDraft(base.draft) }
      : makeUserMessage(base, { text: raw, images: imgs, language: lang, deckNames });
    const pending: ChatSession = {
      ...base,
      title: base.title || sessionTitle(raw || t('aiPhotoTitle')),
      messages: [...base.messages, message],
      draftSeen,
      pendingNotice: '',
    };
    setSession(pending);
    setText('');
    setImages([]);

    const controller = new AbortController();
    setBusy({ controller, cards: 0, reply: '', startedAt: Date.now() });
    try {
      const { runTurn } = await import('../ai/client');
      const res = await runTurn({
        apiKey: settings.apiKey,
        model: model.id,
        messages: toApiMessages(pending.messages),
        signal: controller.signal,
        onProgress: (p) => setBusy((b) => (b ? { ...b, cards: p.cards, reply: p.reply } : b)),
      });
      const nextDraft = applyOutput(pending.draft, res.output);
      const reply: ChatMessage = {
        id: uid(),
        role: 'assistant',
        text: res.output.reply,
        content: res.content,
        action: res.output.action,
        cardCount: res.output.cards.length,
        suggestions: res.output.suggestions,
        usage: res.usage,
        prevDraft: pending.draft,
        createdAt: Date.now(),
      };
      commit({ ...pending, messages: [...pending.messages, reply], draft: nextDraft, draftSeen: describeDraft(nextDraft) });
      void addSpend(res.usage.costUsd);
    } catch (e) {
      const err = e as { code?: string; message?: string; usage?: { costUsd: number } };
      if (err.usage) void addSpend(err.usage.costUsd);
      // Roll back the unanswered turn so the history stays valid; the text goes back to the composer.
      if (opts.rollback) {
        setSession(opts.rollback);
      } else {
        setSession(base);
        setText(raw);
        setImages(imgs);
      }
      if (err.code !== 'aborted') setError({ code: err.code ?? 'api', detail: err.message });
    } finally {
      setBusy(null);
    }
  };

  const regenerate = () => {
    if (!session || !lastAssistant || busy) return;
    const idx = session.messages.lastIndexOf(lastAssistant);
    const userMsg = session.messages[idx - 1];
    if (!userMsg || userMsg.role !== 'user') return;
    // Drop the last exchange, restore the draft as it was before it, and ask again.
    const base: ChatSession = { ...session, messages: session.messages.slice(0, idx - 1), draft: lastAssistant.prevDraft ?? session.draft };
    void send(userMsg.text, userMsg.images ?? [], { base, reuse: userMsg, rollback: session });
  };

  const setDraft = (next: ChatDraft) => session && commit({ ...session, draft: next });

  const onImported = (r: ImportOutcome) => {
    if (!session) return;
    const notice: ChatMessage = {
      id: uid(),
      role: 'notice',
      text: t('aiImportedNotice', { count: r.added + r.updated, cards: r.cards, deck: r.deckName }),
      createdAt: Date.now(),
    };
    commit({
      ...session,
      messages: [...session.messages, notice],
      draft: { ...emptyDraft(), deck: session.draft.deck, tags: session.draft.tags },
      pendingNotice: `note: the learner imported the previous draft (${r.added + r.updated} notes) into deck "${r.deckName}". The draft is now empty; keep the same deck unless asked.`,
    });
    setReviewOpen(false);
  };

  const startNew = () => {
    busy?.controller.abort();
    setSession(newSession());
    setError(null);
    setText('');
    setImages([]);
    setHistoryOpen(false);
  };

  const addImages = async (files: FileList | null) => {
    if (!files) return;
    const room = MAX_IMAGES - images.length;
    const picked = Array.from(files).slice(0, room);
    if (files.length > room) toast(t('aiMaxImages', { count: MAX_IMAGES }));
    try {
      const out = await Promise.all(picked.map((f) => fileToChatImage(f)));
      setImages((prev) => [...prev, ...out].slice(0, MAX_IMAGES));
    } catch {
      toast(t('aiImageError'));
    }
  };

  const examples = [t('aiExample1'), t('aiExample2'), t('aiExample3'), t('aiExample4')];
  const suggestions = !busy && lastAssistant?.suggestions?.length && session?.messages.at(-1) === lastAssistant ? lastAssistant.suggestions : [];

  return (
    <motion.div className="study chat" initial={{ y: '100%' }} animate={{ y: 0 }} transition={spring} role="dialog" aria-modal="true" aria-label={t('aiTitle')}>
      <div className="backdrop"><span /></div>
      <div className="study-top">
        <button className="icon-btn" onClick={onExit} aria-label={t('close')}><IconClose /></button>
        <div className="chat-title">
          <span className="headline">{t('aiTitle')}</span>
          <button className="footnote secondary chat-model" onClick={() => setKeyOpen(true)}>{model.label}</button>
        </div>
        <button className="icon-btn" aria-label={t('aiHistory')} onClick={() => setHistoryOpen(true)}><IconHistory /></button>
        <button className="icon-btn" aria-label={t('options')} aria-haspopup="menu" onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}><IconMore /></button>
      </div>

      <div className="chat-list" ref={listRef} aria-live="polite">
        {session && session.messages.length === 0 && !busy && (
          <div className="chat-intro">
            <div className="chat-intro-mark"><IconSpark size={34} /></div>
            <h2 className="title-2">{t('aiIntroTitle')}</h2>
            <p className="subhead secondary">{t('aiIntroBody')}</p>
            <div className="chip-col">
              {examples.map((ex) => (
                <button key={ex} className="chip" onClick={() => (hasKey ? void send(ex, []) : (setText(ex), setKeyOpen(true)))}>
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {session?.messages.map((m) =>
          m.role === 'notice' ? (
            <div key={m.id} className="chat-notice footnote">✓ {m.text}</div>
          ) : m.role === 'user' ? (
            <div key={m.id} className="bubble user">
              {m.images?.length ? (
                <div className="bubble-images">
                  {m.images.map((img, i) => (
                    <img key={i} src={`data:${img.mediaType};base64,${img.data}`} alt="" />
                  ))}
                </div>
              ) : null}
              {m.text && <p>{m.text}</p>}
            </div>
          ) : (
            <div key={m.id} className="bubble assistant">
              <p>{m.text}</p>
              {m.action && m.action !== 'none' && (
                <button className="draft-chip" onClick={() => setReviewOpen(true)}>
                  {m.action === 'append' ? t('aiAppended', { count: m.cardCount ?? 0 }) : t('aiReplaced', { count: m.cardCount ?? 0 })}
                </button>
              )}
              <div className="bubble-meta footnote tertiary">
                {m.usage && <span>{getAiModel(m.usage.model).label.replace('Claude ', '')} · {formatUsd(m.usage.costUsd)}</span>}
                {m === lastAssistant && session.messages.at(-1) === m && (
                  <button className="btn plain small" onClick={regenerate} disabled={!!busy}>
                    <IconReset size={16} /> {t('aiRegenerate')}
                  </button>
                )}
              </div>
            </div>
          ),
        )}

        {busy && (
          <div className="bubble assistant pending">
            {busy.reply ? <p>{busy.reply}</p> : <p className="secondary"><span className="dots" aria-hidden="true"><i /><i /><i /></span> {t('aiThinking')}</p>}
            {busy.cards > 0 && <p className="footnote secondary">{t('aiWriting', { count: busy.cards })}</p>}
          </div>
        )}

        {error && (
          <div className="chat-error" role="alert">
            <p className="subhead">{t(`aiErr_${error.code}` as StringKey)}</p>
            {error.code === 'auth' || error.code === 'no_key' || error.code === 'billing' || error.code === 'permission' ? (
              <button className="btn small" onClick={() => setKeyOpen(true)}>{t('aiKeyTitle')}</button>
            ) : (
              <button className="btn small" disabled={!text.trim() && !images.length} onClick={() => void send(text, images)}>{t('aiRetry')}</button>
            )}
          </div>
        )}
      </div>

      <div className="chat-bottom">
        {draft.cards.length > 0 && (
          <motion.div layout className="glass draft-bar" transition={spring}>
            <div className="draft-bar-text">
              <span className="headline">{t('aiDraftCount', { count: draft.cards.length })}</span>
              <span className="footnote secondary">{draft.deck || '—'}</span>
            </div>
            <button className="btn small primary" onClick={() => setReviewOpen(true)}>{t('aiReview')}</button>
          </motion.div>
        )}

        {suggestions.length > 0 && (
          <div className="chip-row" role="list">
            {suggestions.map((s) => (
              <button key={s} role="listitem" className="chip" onClick={() => void send(s, [])}>{s}</button>
            ))}
          </div>
        )}

        {!hasKey ? (
          <div className="glass card-pad key-cta">
            <p className="subhead" style={{ margin: 0 }}>{t('aiNoKeyBody')}</p>
            <div className="row">
              <button className="btn primary block" onClick={() => setKeyOpen(true)}>{t('aiSetKey')}</button>
              <button className="btn block" onClick={() => setPromptOpen(true)}>{t('aiUseClaudeApp')}</button>
            </div>
          </div>
        ) : (
          <form
            className="glass strong composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send(text, images);
            }}
          >
            {images.length > 0 && (
              <div className="composer-images">
                {images.map((img, i) => (
                  <div key={i} className="thumb">
                    <img src={`data:${img.mediaType};base64,${img.data}`} alt="" />
                    <button type="button" aria-label={t('delete')} onClick={() => setImages((p) => p.filter((_, j) => j !== i))}><IconClose size={14} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="composer-row">
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void addImages(e.target.files); e.target.value = ''; }} />
              <button type="button" className="icon-btn" aria-label={t('aiAttach')} onClick={() => fileRef.current?.click()} disabled={!!busy || images.length >= MAX_IMAGES}>
                <IconImage />
              </button>
              <textarea
                ref={inputRef}
                className="composer-input"
                rows={1}
                value={text}
                placeholder={t('aiPlaceholder')}
                aria-label={t('aiPlaceholder')}
                onChange={(e) => {
                  setText(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) {
                    e.preventDefault();
                    void send(text, images);
                  }
                }}
              />
              {busy ? (
                <button type="button" className="icon-btn send" aria-label={t('aiStop')} onClick={() => busy.controller.abort()}><IconStop /></button>
              ) : (
                <button type="submit" className="icon-btn send" aria-label={t('aiSend')} disabled={!text.trim() && !images.length}><IconSend /></button>
              )}
            </div>
          </form>
        )}
      </div>

      <Menu anchor={menu} onClose={() => setMenu(null)} label={t('options')}>
        <button role="menuitem" onClick={() => { startNew(); setMenu(null); }}><IconPlus size={20} /> {t('aiNewChat')}</button>
        <button role="menuitem" onClick={() => { setPromptOpen(true); setMenu(null); }}><IconCopy size={20} /> {t('aiCopyPrompt')}</button>
        <button role="menuitem" onClick={() => { setImportOpen(true); setMenu(null); }}><IconImport size={20} /> {t('importJson')}</button>
        <button role="menuitem" onClick={() => { setKeyOpen(true); setMenu(null); }}><IconSettings size={20} /> {t('aiKeyTitle')}</button>
        {draft.cards.length > 0 && (
          <>
            <hr />
            <button role="menuitem" className="danger" onClick={() => { setClearDraft(true); setMenu(null); }}><IconTrash size={20} /> {t('aiClearDraft')}</button>
          </>
        )}
      </Menu>

      <Sheet open={reviewOpen} onClose={() => setReviewOpen(false)} title={t('aiReviewTitle')}>
        {draft.cards.length === 0 ? (
          <p className="subhead secondary">{t('aiDraftEmpty')}</p>
        ) : (
          <ImportReview
            parsed={parsed}
            decks={decks}
            cancelLabel={t('aiBackToChat')}
            onCancel={() => setReviewOpen(false)}
            onImported={onImported}
            rowActions={(i) => (
              <div className="stack" style={{ gap: 6 }}>
                <button className="icon-btn small" aria-label={`${t('edit')} ${i + 1}`} onClick={() => setEditing(draft.cards[i])}><IconEdit size={18} /></button>
                <button
                  className="icon-btn small danger"
                  aria-label={`${t('delete')} ${i + 1}`}
                  onClick={() => setDraft({ ...draft, cards: draft.cards.filter((_, j) => j !== i) })}
                >
                  <IconTrash size={18} />
                </button>
              </div>
            )}
            afterTable={
              <button className="btn block" onClick={() => setEditing(blankCard())}>
                <IconPlus size={18} /> {t('aiAddCard')}
              </button>
            }
          />
        )}
      </Sheet>

      <DraftCardEditor
        card={editing}
        onClose={() => setEditing(null)}
        onSave={(c) => {
          const exists = draft.cards.some((x) => x.id === c.id);
          setDraft({ ...draft, cards: exists ? draft.cards.map((x) => (x.id === c.id ? c : x)) : [...draft.cards, c] });
          setEditing(null);
        }}
      />

      <HistorySheet open={historyOpen} onClose={() => setHistoryOpen(false)} currentId={session?.id} onOpen={(s) => { busy?.controller.abort(); setSession(s); setError(null); setHistoryOpen(false); }} onNew={startNew} />
      <AiKeySheet open={keyOpen} onClose={() => setKeyOpen(false)} />
      <CopyPromptSheet open={promptOpen} onClose={() => setPromptOpen(false)} initial={text} onPasteJson={() => { setPromptOpen(false); setImportOpen(true); }} />
      <ImportSheet open={importOpen} onClose={() => setImportOpen(false)} decks={decks} />
      <ConfirmSheet
        open={clearDraft}
        title={t('aiClearDraft')}
        message={t('aiClearDraftConfirm', { count: draft.cards.length })}
        confirmLabel={t('delete')}
        danger
        onCancel={() => setClearDraft(false)}
        onConfirm={() => {
          setDraft({ ...draft, cards: [] });
          setClearDraft(false);
        }}
      />
    </motion.div>
  );
}

async function addSpend(usd: number) {
  if (!usd) return;
  const s = await getSettings();
  await updateSettings({ aiSpentUsd: (s.aiSpentUsd ?? 0) + usd });
}

const toFields = (c: DraftCard): Record<string, string> => ({
  front: c.front,
  back: c.back,
  note: c.note,
  text: c.text,
  extra: c.extra,
  addReverse: c.reverse ? 'y' : '',
});

function DraftCardEditor({ card, onClose, onSave }: { card: DraftCard | null; onClose: () => void; onSave: (c: DraftCard) => void }) {
  const { t } = useT();
  const [type, setType] = useState<NoteType>('basic');
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!card) return;
    setType(card.type);
    setFields(toFields(card));
  }, [card]);

  const save = () => {
    if (!card) return;
    onSave({
      ...card,
      type,
      front: fields.front ?? '',
      back: fields.back ?? '',
      note: fields.note ?? '',
      text: fields.text ?? '',
      extra: fields.extra ?? '',
      reverse: /^(y|yes|true|1)$/i.test(fields.addReverse ?? ''),
    });
  };

  return (
    <Sheet open={!!card} onClose={onClose} title={t('editCard')} actions={<button className="btn small primary" onClick={save}>{t('save')}</button>}>
      {card && <CardFieldsForm type={type} onType={setType} fields={fields} onFields={setFields} types={AI_CARD_TYPES} />}
    </Sheet>
  );
}

function HistorySheet({
  open,
  onClose,
  currentId,
  onOpen,
  onNew,
}: {
  open: boolean;
  onClose: () => void;
  currentId?: string;
  onOpen: (s: ChatSession) => void;
  onNew: () => void;
}) {
  const { t, lang } = useT();
  const sessions = useLiveQuery(() => db.chatSessions.orderBy('updatedAt').reverse().toArray(), []);
  const fmt = new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Sheet open={open} onClose={onClose} title={t('aiHistory')}>
      <button className="btn primary block" onClick={onNew}><IconPlus size={18} /> {t('aiNewChat')}</button>
      {sessions && sessions.length === 0 && <p className="subhead secondary">{t('aiHistoryEmpty')}</p>}
      {sessions && sessions.length > 0 && (
        <div className="glass list">
          {sessions.map((s) => (
            <div key={s.id} className="list-item">
              <button className="label history-open" onClick={() => onOpen(s)} aria-current={s.id === currentId ? 'true' : undefined}>
                <span className="headline">{s.title || t('aiUntitled')}</span>
                <span className="footnote secondary">
                  {fmt.format(s.updatedAt)}
                  {s.draft.cards.length > 0 && ` · ${t('aiDraftCount', { count: s.draft.cards.length })}`}
                </span>
              </button>
              <button className="icon-btn small danger" aria-label={`${t('delete')}: ${s.title}`} onClick={() => void deleteSession(s.id)}>
                <IconTrash size={18} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

/** Fallback without an API key: copy a ready-made prompt into the Claude app, then paste the JSON back. */
function CopyPromptSheet({ open, onClose, initial, onPasteJson }: { open: boolean; onClose: () => void; initial: string; onPasteJson: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const [request, setRequest] = useState('');
  useEffect(() => {
    if (open) setRequest(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const copy = async () => {
    const prompt = externalPrompt(request);
    try {
      await navigator.clipboard.writeText(prompt);
      toast(t('copied'));
    } catch {
      // Clipboard blocked: select a hidden textarea so the learner can copy manually.
      const ta = document.createElement('textarea');
      ta.value = prompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast(t('copied'));
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('aiCopyPrompt')}>
      <p className="subhead secondary" style={{ margin: 0 }}>{t('aiCopyPromptBody')}</p>
      <label className="field">
        <span>{t('aiWhatToLearn')}</span>
        <textarea className="textarea" rows={4} value={request} onChange={(e) => setRequest(e.target.value)} placeholder={t('aiExample1')} />
      </label>
      <ol className="steps">
        <li>{t('aiCopyStep1')}</li>
        <li>{t('aiCopyStep2')}</li>
        <li>{t('aiCopyStep3')}</li>
      </ol>
      <div className="row">
        <button className="btn primary block" disabled={!request.trim()} onClick={() => void copy()}><IconCopy size={18} /> {t('aiCopy')}</button>
        <button className="btn block" onClick={onPasteJson}><IconImport size={18} /> {t('aiPasteJson')}</button>
      </div>
    </Sheet>
  );
}
