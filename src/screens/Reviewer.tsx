import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../db/schema';
import type { Card, Deck, Flag, Note } from '../db/types';
import { gatherQueue, pickNext, requeue, restoreToQueue, type QueueLists } from '../db/queue';
import { answerCard, buryCards, deleteNote, getSettings, resetCards, setFlag, setSuspended, undoAnswer } from '../db/repo';
import { renderCard } from '../cards/render';
import {
  addStudyDays,
  defaultDeckConfig,
  formatDelay,
  getScheduler,
  normalizeConfig,
  type DeckConfig,
  type Rating,
} from '../srs';
import { useT } from '../i18n';
import { ConfirmSheet, Menu, PressButton, spring, useToast } from '../ui/components';
import { FLAG_COLORS, FlowerMark, IconClose, IconEdit, IconMoon, IconMore, IconPause, IconReset, IconTrash, IconUndo } from '../ui/icons';
import { FaceContent } from './CardFace';
import { NoteEditor } from './NoteEditor';

interface UndoEntry {
  logId: string;
  card: Card;
  wasNew: boolean;
}

interface Ctx {
  decks: Map<string, Deck>;
  configs: Map<string, DeckConfig>;
  dayStartHour: number;
}

export function Reviewer({ deckId, onExit }: { deckId: string | null; onExit: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const reduce = useReducedMotion();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [queue, setQueue] = useState<QueueLists | null>(null);
  const [notes, setNotes] = useState<Map<string, Note>>(new Map());
  const [flipped, setFlipped] = useState(false);
  const [typed, setTyped] = useState('');
  const [now, setNow] = useState(Date.now());
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [done, setDone] = useState({ count: 0, ms: 0, newCount: 0, reviewCount: 0 });
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);
  const [editing, setEditing] = useState<Note | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const shownAt = useRef(Date.now());
  const initialTotal = useRef(0);
  const typeRef = useRef<HTMLInputElement>(null);

  // ----- load -----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const settings = await getSettings();
      const [decks, configs, gathered] = await Promise.all([
        db.decks.toArray(),
        db.configs.toArray(),
        gatherQueue({ now: Date.now(), dayStartHour: settings.dayStartHour, rootDeckId: deckId }),
      ]);
      const q = gathered.queue;
      const noteIds = [...new Set([...q.learning, ...q.review, ...q.new].map((c) => c.noteId))];
      const loaded = await db.notes.bulkGet(noteIds);
      if (cancelled) return;
      setNotes(new Map(loaded.filter((n): n is Note => !!n).map((n) => [n.id, n])));
      setCtx({
        decks: new Map(decks.map((d) => [d.id, d])),
        configs: new Map(configs.map((c) => [c.id, normalizeConfig(c)])),
        dayStartHour: settings.dayStartHour,
      });
      initialTotal.current = q.learning.length + q.review.length + q.new.length;
      setQueue(q);
    })();
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  const configFor = useCallback(
    (card: Card): DeckConfig => {
      const deck = ctx?.decks.get(card.deckId);
      return (deck && ctx?.configs.get(deck.configId)) ?? ctx?.configs.get('default') ?? defaultDeckConfig();
    },
    [ctx],
  );

  const rootConfig = useMemo(() => {
    if (!ctx) return defaultDeckConfig();
    const deck = deckId ? ctx.decks.get(deckId) : undefined;
    return (deck && ctx.configs.get(deck.configId)) ?? ctx.configs.get('default') ?? defaultDeckConfig();
  }, [ctx, deckId]);

  const pick = useMemo(() => {
    if (!queue) return null;
    return pickNext(queue, now, {
      learnAheadMinutes: rootConfig.learnAheadMinutes,
      order: rootConfig.newReviewOrder,
      learningFirst: rootConfig.learningFirst,
      reviewedNew: done.newCount,
      reviewedReview: done.reviewCount,
    });
  }, [queue, now, rootConfig, done.newCount, done.reviewCount]);

  const card = pick?.card ?? null;
  const note = card ? notes.get(card.noteId) : undefined;
  const rendered = useMemo(() => (card && note ? renderCard(note, card.ord) : null), [card, note]);

  // Wake up when a learning card becomes due.
  useEffect(() => {
    if (!pick || pick.card || !pick.nextLearningDue) return;
    const wait = Math.max(1000, pick.nextLearningDue - Date.now() - rootConfig.learnAheadMinutes * 60_000);
    const id = window.setTimeout(() => setNow(Date.now()), Math.min(wait, 60_000));
    return () => window.clearTimeout(id);
  }, [pick, rootConfig.learnAheadMinutes]);

  // Reset per-card state when the card changes.
  const cardKey = card ? `${card.id}:${card.reps}` : '';
  useEffect(() => {
    setFlipped(false);
    setTyped('');
    shownAt.current = Date.now();
    if (rendered?.typeAnswer !== undefined) setTimeout(() => typeRef.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardKey]);

  const previews = useMemo(() => {
    if (!card || !ctx) return null;
    const p = getScheduler().preview(card, configFor(card), { now: Date.now(), dayStartHour: ctx.dayStartHour, fuzzSeed: card.id });
    return { 1: formatDelay(p[1]), 2: formatDelay(p[2]), 3: formatDelay(p[3]), 4: formatDelay(p[4]) } as Record<Rating, string>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardKey, ctx, configFor]);

  // ----- actions -----
  const flip = useCallback(() => {
    if (!card) return;
    setFlipped(true);
  }, [card]);

  const answer = useCallback(
    async (rating: Rating) => {
      if (!card || !ctx || !queue || busy || !flipped) return;
      setBusy(true);
      try {
        const cfg = configFor(card);
        const took = Date.now() - shownAt.current;
        const { card: updated, log } = await answerCard({ card, rating, timeTakenMs: took, config: cfg, dayStartHour: ctx.dayStartHour });
        const tomorrow = addStudyDays(Date.now(), 1, ctx.dayStartHour);
        let next = requeue(queue, updated, tomorrow);
        if (log.buriedSiblings.length) {
          const b = new Set(log.buriedSiblings);
          next = { learning: next.learning.filter((c) => !b.has(c.id)), review: next.review.filter((c) => !b.has(c.id)), new: next.new.filter((c) => !b.has(c.id)) };
        }
        if (updated.suspended) next = { ...next, learning: next.learning.filter((c) => c.id !== updated.id) };
        setUndoStack((s) => [...s.slice(-49), { logId: log.id, card, wasNew: card.state === 'new' }]);
        setDone((d) => ({
          count: d.count + 1,
          ms: d.ms + Math.min(took, 300_000),
          newCount: d.newCount + (card.state === 'new' ? 1 : 0),
          reviewCount: d.reviewCount + (card.state === 'review' ? 1 : 0),
        }));
        if (log.leechAdded || (updated.leech && !card.leech)) toast(t('leechNotice', { count: updated.lapses }));
        setNow(Date.now());
        setQueue(next);
      } finally {
        setBusy(false);
      }
    },
    [card, ctx, queue, busy, flipped, configFor, toast, t],
  );

  const undo = useCallback(async () => {
    const last = undoStack[undoStack.length - 1];
    if (!last || !queue || busy) return;
    setBusy(true);
    try {
      const restored = await undoAnswer(last.logId);
      if (restored) {
        const reloaded = (await db.cards.get(restored.id)) ?? restored;
        // Siblings buried by that answer are un-buried in the database and return on the next session.
        setQueue((q) => (q ? restoreToQueue(q, reloaded) : q));
        setUndoStack((s) => s.slice(0, -1));
        setDone((d) => ({
          ...d,
          count: Math.max(0, d.count - 1),
          newCount: Math.max(0, d.newCount - (last.wasNew ? 1 : 0)),
          reviewCount: Math.max(0, d.reviewCount - (last.card.state === 'review' ? 1 : 0)),
        }));
        setNow(Date.now());
        toast(t('undone'));
      }
    } finally {
      setBusy(false);
    }
  }, [undoStack, queue, busy, toast, t]);

  const removeCurrent = (q: QueueLists, id: string): QueueLists => ({
    learning: q.learning.filter((c) => c.id !== id),
    review: q.review.filter((c) => c.id !== id),
    new: q.new.filter((c) => c.id !== id),
  });

  const doSuspend = async () => {
    if (!card || !queue) return;
    setMenuRect(null);
    await setSuspended([card.id], true);
    setQueue(removeCurrent(queue, card.id));
    toast(t('suspended'), { label: t('undo'), run: async () => { await setSuspended([card.id], false); setQueue((q) => (q ? restoreToQueue(q, card) : q)); } });
  };
  const doBury = async () => {
    if (!card || !queue || !ctx) return;
    setMenuRect(null);
    await buryCards([card.id], ctx.dayStartHour);
    setQueue(removeCurrent(queue, card.id));
    toast(t('buried'));
  };
  const doReset = async () => {
    if (!card || !queue) return;
    setMenuRect(null);
    await resetCards([card.id]);
    setQueue(removeCurrent(queue, card.id));
    toast(t('resetDone'));
  };
  const doFlag = async (flag: Flag) => {
    if (!card || !queue) return;
    await setFlag([card.id], flag);
    const upd = (list: Card[]) => list.map((c) => (c.id === card.id ? { ...c, flag } : c));
    setQueue({ learning: upd(queue.learning), review: upd(queue.review), new: upd(queue.new) });
    setMenuRect(null);
  };
  const doDelete = async () => {
    if (!card || !queue) return;
    setConfirmDelete(false);
    const noteId = card.noteId;
    await deleteNote(noteId);
    const keep = (list: Card[]) => list.filter((c) => c.noteId !== noteId);
    setQueue({ learning: keep(queue.learning), review: keep(queue.review), new: keep(queue.new) });
    toast(t('noteDeleted'));
  };
  const openEditor = () => {
    setMenuRect(null);
    if (note) setEditing(note);
  };
  const onEdited = async () => {
    if (!card) return;
    const fresh = await db.notes.get(card.noteId);
    if (fresh) setNotes((m) => new Map(m).set(fresh.id, fresh));
    // A note edit can add/remove cards (e.g. cloze); drop cards that no longer exist.
    const ids = new Set(await db.cards.where('noteId').equals(card.noteId).primaryKeys());
    setQueue((q) => {
      if (!q) return q;
      const keep = (list: Card[]) => list.filter((c) => c.noteId !== card.noteId || ids.has(c.id));
      return { learning: keep(q.learning), review: keep(q.review), new: keep(q.new) };
    });
  };

  // ----- keyboard -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing || confirmDelete || menuRect) return;
      const target = e.target as HTMLElement;
      const inField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      if (inField) {
        if (e.key === 'Enter' && !flipped) {
          e.preventDefault();
          flip();
        }
        return;
      }
      if (e.key === 'Escape') return onExit();
      if ((e.key === 'z' || e.key === 'Z') && !e.altKey) {
        e.preventDefault();
        return void undo();
      }
      if (!card) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!flipped) flip();
        else void answer(3);
        return;
      }
      if (flipped && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        return void answer(Number(e.key) as Rating);
      }
      if (e.key === 'e' || e.key === 'E') return openEditor();
      if (e.key === '@') return void doBury();
      if (e.key === '!') return void doSuspend();
      if (e.ctrlKey && /^[1-7]$/.test(e.key)) {
        e.preventDefault();
        return void doFlag(Number(e.key) as Flag);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ----- swipe -----
  const x = useMotionValue(0);
  const rotateZ = useTransform(x, [-200, 200], [-8, 8]);
  const againOpacity = useTransform(x, [-140, -40], [1, 0]);
  const goodOpacity = useTransform(x, [40, 140], [0, 1]);
  const onDragEnd = (_: unknown, info: { offset: { x: number }; velocity: { x: number } }) => {
    const dx = info.offset.x + info.velocity.x * 0.2;
    if (flipped && dx < -120) void answer(1);
    else if (flipped && dx > 120) void answer(3);
    animate(x, 0, spring);
  };

  // ----- render -----
  const remaining = queue ? queue.learning.length + queue.review.length + queue.new.length : 0;
  const progress = done.count + remaining > 0 ? done.count / (done.count + remaining) : 0;
  const activeList = card ? (card.state === 'new' ? 'new' : card.state === 'review' ? 'review' : 'learn') : '';
  const minutes = (ms: number) => {
    const m = Math.round(ms / 60000);
    return m < 1 ? `${Math.round(ms / 1000)}s` : `${m}m`;
  };

  return (
    <motion.div
      className="study"
      role="dialog"
      aria-modal="true"
      aria-label={t('tabStudy')}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: 40 }}
      transition={spring}
    >
      <div className="backdrop"><span /></div>
      <div className="study-top">
        <button className="icon-btn" onClick={onExit} aria-label={t('exitStudy')}><IconClose /></button>
        <div className="study-progress" aria-live="polite">
          <span className={`c-new ${activeList === 'new' ? 'active' : ''}`} title={t('new')}>{queue?.new.length ?? 0}</span>
          <span className={`c-learn ${activeList === 'learn' ? 'active' : ''}`} title={t('learning')}>{queue?.learning.length ?? 0}</span>
          <span className={`c-review ${activeList === 'review' ? 'active' : ''}`} title={t('review')}>{queue?.review.length ?? 0}</span>
        </div>
        <button className="icon-btn" onClick={() => void undo()} disabled={!undoStack.length} aria-label={t('undo')} style={{ opacity: undoStack.length ? 1 : 0.35 }}>
          <IconUndo />
        </button>
        <button
          className="icon-btn"
          disabled={!card}
          aria-label={t('cardMenu')}
          aria-haspopup="menu"
          onClick={(e) => setMenuRect(e.currentTarget.getBoundingClientRect())}
        >
          <IconMore />
        </button>
      </div>
      <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <div style={{ width: `${progress * 100}%` }} />
      </div>

      {queue && !card ? (
        <div className="card-stage">
          <div className="empty glass" style={{ width: '100%' }}>
            <FlowerMark className="art" />
            <h2 className="title-2">{t('congratsTitle')}</h2>
            <p className="body secondary">
              {pick?.nextLearningDue
                ? t('comeBackIn', { count: queue.learning.length, time: formatDelay(Math.max(0, pick.nextLearningDue - Date.now())) })
                : t('congratsBody')}
            </p>
            {done.count > 0 && <p className="subhead secondary">{t('reviewedSummary', { count: done.count, time: minutes(done.ms) })}</p>}
            <button className="btn primary" onClick={onExit}>{t('backHome')}</button>
          </div>
        </div>
      ) : (
        <div className="card-stage">
          {card && rendered && (
            <motion.div
              key={card.id}
              className="flashcard"
              style={{ x, rotateZ }}
              drag={flipped ? 'x' : false}
              dragElastic={0.6}
              dragConstraints={{ left: 0, right: 0 }}
              onDragEnd={onDragEnd}
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={spring}
            >
              <motion.div
                style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d' }}
                animate={reduce ? undefined : { rotateY: flipped ? 180 : 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                onClick={() => !flipped && rendered.typeAnswer === undefined && flip()}
              >
                <motion.div
                  className="face glass strong"
                  aria-hidden={flipped}
                  animate={reduce ? { opacity: flipped ? 0 : 1 } : undefined}
                  style={reduce ? { backfaceVisibility: 'visible' } : undefined}
                >
                  {card.flag > 0 && <span className="flag-dot" style={{ background: FLAG_COLORS[card.flag] }} />}
                  <span className="card-meta">{ctx?.decks.get(card.deckId)?.name}</span>
                  <div className="face-inner">
                    <FaceContent rendered={rendered} side="front" />
                    {rendered.typeAnswer !== undefined && (
                      <form onSubmit={(e) => { e.preventDefault(); flip(); }}>
                        <input
                          ref={typeRef}
                          className="input type-input"
                          value={typed}
                          onChange={(e) => setTyped(e.target.value)}
                          placeholder={t('typeAnswer')}
                          aria-label={t('typeAnswer')}
                          autoCapitalize="off"
                          autoCorrect="off"
                          spellCheck={false}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </form>
                    )}
                    {rendered.typeAnswer === undefined && <p className="tap-hint">{t('tapToFlip')}</p>}
                  </div>
                </motion.div>
                <motion.div
                  className="face back glass strong"
                  aria-hidden={!flipped}
                  animate={reduce ? { opacity: flipped ? 1 : 0 } : undefined}
                  style={reduce ? { transform: 'none', backfaceVisibility: 'visible' } : undefined}
                >
                  {card.flag > 0 && <span className="flag-dot" style={{ background: FLAG_COLORS[card.flag] }} />}
                  <div className="face-inner">
                    {flipped && <FaceContent rendered={rendered} side="back" typed={typed} />}
                  </div>
                </motion.div>
              </motion.div>
              {flipped && (
                <>
                  <motion.span className="swipe-label" style={{ left: 20, background: 'var(--red)', opacity: againOpacity }}>{t('again')}</motion.span>
                  <motion.span className="swipe-label" style={{ right: 20, background: 'var(--green)', opacity: goodOpacity }}>{t('good')}</motion.span>
                </>
              )}
            </motion.div>
          )}
        </div>
      )}

      {card && (
        <div>
          {!flipped ? (
            <div className="answer-bar single glass">
              <PressButton className="show-btn" onClick={flip}>{t('showAnswer')}</PressButton>
            </div>
          ) : (
            <div className="answer-bar glass" role="group" aria-label="Rating">
              {([1, 2, 3, 4] as Rating[]).map((r) => (
                <PressButton key={r} className={`rate-btn rate-${r}`} onClick={() => void answer(r)} disabled={busy} aria-keyshortcuts={String(r)}>
                  <small>{previews?.[r]}</small>
                  {t(r === 1 ? 'again' : r === 2 ? 'hard' : r === 3 ? 'good' : 'easy')}
                </PressButton>
              ))}
            </div>
          )}
          <p className="kbd-hint">{flipped ? t('swipeHint') + ' · ' : ''}{t('shortcuts')}</p>
        </div>
      )}

      <Menu anchor={menuRect} onClose={() => setMenuRect(null)} label={t('cardMenu')}>
        <button role="menuitem" onClick={openEditor}><IconEdit size={20} /> {t('editCard')}</button>
        <div className="flag-row" role="group" aria-label={t('flag')}>
          {FLAG_COLORS.map((c, i) => (
            <button
              key={i}
              className="flag-swatch"
              style={{ background: i === 0 ? 'var(--fill)' : c, width: 30, minHeight: 30, padding: 0 }}
              aria-pressed={card?.flag === i}
              aria-label={i === 0 ? t('noFlag') : `${t('flag')} ${i}`}
              onClick={() => void doFlag(i as Flag)}
            />
          ))}
        </div>
        <button role="menuitem" onClick={() => void doBury()}><IconMoon size={20} /> {t('buryCard')}</button>
        <button role="menuitem" onClick={() => void doSuspend()}><IconPause size={20} /> {t('suspendCard')}</button>
        <button role="menuitem" onClick={() => void doReset()}><IconReset size={20} /> {t('resetCard')}</button>
        <hr />
        <button role="menuitem" className="danger" onClick={() => { setMenuRect(null); setConfirmDelete(true); }}><IconTrash size={20} /> {t('deleteNote')}</button>
      </Menu>

      <NoteEditor note={editing} onClose={() => setEditing(null)} onSaved={onEdited} />
      <ConfirmSheet
        open={confirmDelete}
        title={t('deleteNote')}
        message={t('deleteNoteConfirm')}
        confirmLabel={t('delete')}
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void doDelete()}
      />
    </motion.div>
  );
}
