import { useState } from 'react';
import type { Deck } from '../db/types';
import type { DeckCounts } from '../db/queue';
import { createDeck, deckFullName, deleteDeck, descendantDeckIds, moveDeck, renameDeck } from '../db/repo';
import { db } from '../db/schema';
import { useT } from '../i18n';
import { ConfirmSheet, EmptyState, Menu, PressButton, Sheet, useToast } from '../ui/components';
import { FlowerMark, IconFolder, IconImport, IconMore, IconPlus, IconSettings, IconStudy, IconTrash, IconEdit } from '../ui/icons';
import { DeckTree } from './DeckTree';
import { ImportSheet } from './ImportSheet';
import { DeckOptionsSheet } from './DeckOptions';

export function HomeScreen({
  decks,
  counts,
  total,
  onStudy,
}: {
  decks?: Deck[];
  counts?: Map<string, DeckCounts>;
  total: DeckCounts;
  onStudy: (deckId: string | null) => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const [menu, setMenu] = useState<{ deck: Deck; rect: DOMRect } | null>(null);
  const [nameSheet, setNameSheet] = useState<{ mode: 'create' | 'rename' | 'sub'; deck?: Deck } | null>(null);
  const [name, setName] = useState('');
  const [moving, setMoving] = useState<Deck | null>(null);
  const [deleting, setDeleting] = useState<{ deck: Deck; count: number } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [optionsFor, setOptionsFor] = useState<Deck | null>(null);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('greetingMorning') : hour < 17 ? t('greetingAfternoon') : t('greetingEvening');
  const due = total.new + total.learn + total.review;

  const openName = (mode: 'create' | 'rename' | 'sub', deck?: Deck) => {
    setName(mode === 'rename' ? deck?.name ?? '' : '');
    setNameSheet({ mode, deck });
    setMenu(null);
  };
  const submitName = async () => {
    if (!nameSheet || !name.trim()) return;
    if (nameSheet.mode === 'rename' && nameSheet.deck) await renameDeck(nameSheet.deck.id, name);
    else await createDeck(name, nameSheet.mode === 'sub' ? nameSheet.deck?.id ?? null : null);
    setNameSheet(null);
  };
  const askDelete = async (deck: Deck) => {
    setMenu(null);
    const ids = await descendantDeckIds(deck.id);
    const count = await db.cards.where('deckId').anyOf(ids).count();
    setDeleting({ deck, count });
  };

  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <p className="subhead secondary" style={{ margin: 0 }}>{greeting}</p>
          <h1 className="large-title">{t('appName')}</h1>
        </div>
        <button className="icon-btn" onClick={() => setImportOpen(true)} aria-label={t('importJson')}>
          <IconImport />
        </button>
      </header>

      {decks && decks.length > 0 && (
        <section className="glass hero" aria-label={t('dueToday')}>
          <div className="row">
            <h2 className="headline">{t('dueToday')}</h2>
          </div>
          <div className="hero-counts">
            <div className="stat-tile"><div className="num c-new">{total.new}</div><div className="lbl">{t('new')}</div></div>
            <div className="stat-tile"><div className="num c-learn">{total.learn}</div><div className="lbl">{t('learning')}</div></div>
            <div className="stat-tile"><div className="num c-review">{total.review}</div><div className="lbl">{t('review')}</div></div>
          </div>
          {due > 0 ? (
            <PressButton className="btn primary block" onClick={() => onStudy(null)}>
              <IconStudy size={20} /> {t('studyNow')}
            </PressButton>
          ) : (
            <p className="subhead secondary" style={{ margin: 0 }}>✓ {t('allDone')}</p>
          )}
        </section>
      )}

      <div className="row" style={{ padding: '20px 8px 8px' }}>
        <h2 className="section-title" style={{ padding: 0, flex: 1 }}>{t('decks')}</h2>
        <button className="btn small" onClick={() => openName('create')}>
          <IconPlus size={18} /> {t('newDeck')}
        </button>
      </div>

      {decks === undefined ? null : decks.length === 0 ? (
        <EmptyState art={<FlowerMark />} title={t('emptyDecksTitle')} body={t('emptyDecksBody')}>
          <button className="btn primary" onClick={() => setImportOpen(true)}>
            <IconImport size={20} /> {t('importJson')}
          </button>
        </EmptyState>
      ) : (
        <DeckTree
          decks={decks}
          counts={counts}
          onOpen={(d) => onStudy(d.id)}
          trailing={(d) => (
            <button
              className="icon-btn"
              style={{ background: 'none' }}
              aria-label={`${t('options')}: ${d.name}`}
              aria-haspopup="menu"
              onClick={(e) => setMenu({ deck: d, rect: e.currentTarget.getBoundingClientRect() })}
            >
              <IconMore />
            </button>
          )}
        />
      )}

      <Menu anchor={menu?.rect ?? null} onClose={() => setMenu(null)} label={t('options')}>
        {menu && (
          <>
            <button role="menuitem" onClick={() => { onStudy(menu.deck.id); setMenu(null); }}><IconStudy size={20} /> {t('study')}</button>
            <button role="menuitem" onClick={() => openName('rename', menu.deck)}><IconEdit size={20} /> {t('rename')}</button>
            <button role="menuitem" onClick={() => openName('sub', menu.deck)}><IconPlus size={20} /> {t('newSubdeck')}</button>
            <button role="menuitem" onClick={() => { setMoving(menu.deck); setMenu(null); }}><IconFolder size={20} /> {t('moveTo')}</button>
            <button role="menuitem" onClick={() => { setOptionsFor(menu.deck); setMenu(null); }}><IconSettings size={20} /> {t('deckOptions')}</button>
            <hr />
            <button role="menuitem" className="danger" onClick={() => askDelete(menu.deck)}><IconTrash size={20} /> {t('delete')}</button>
          </>
        )}
      </Menu>

      <Sheet
        open={!!nameSheet}
        onClose={() => setNameSheet(null)}
        title={nameSheet?.mode === 'rename' ? t('rename') : nameSheet?.mode === 'sub' ? t('newSubdeck') : t('newDeck')}
      >
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void submitName(); }}>
          <label className="field">
            <span>{t('deckName')}</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <button className="btn primary block" type="submit" disabled={!name.trim()}>
            {nameSheet?.mode === 'rename' ? t('save') : t('create')}
          </button>
        </form>
      </Sheet>

      <Sheet open={!!moving} onClose={() => setMoving(null)} title={t('moveTo')}>
        {moving && decks && (
          <div className="glass list">
            <button className="list-item button" onClick={async () => { await moveDeck(moving.id, null); setMoving(null); }}>
              <span className="label">{t('topLevel')}</span>
            </button>
            {decks
              .filter((d) => d.id !== moving.id && !isDescendant(d.id, moving.id, decks))
              .map((d) => ({ d, full: deckFullName(d.id, decks) }))
              .sort((a, b) => a.full.localeCompare(b.full))
              .map(({ d, full }) => (
                <button key={d.id} className="list-item button" onClick={async () => { await moveDeck(moving.id, d.id); setMoving(null); }}>
                  <span className="label">{full}</span>
                </button>
              ))}
          </div>
        )}
      </Sheet>

      <ConfirmSheet
        open={!!deleting}
        title={t('delete')}
        message={deleting ? t('deleteDeckConfirm', { name: deleting.deck.name, count: deleting.count }) : ''}
        confirmLabel={t('delete')}
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) await deleteDeck(deleting.deck.id);
          setDeleting(null);
          toast(t('delete'));
        }}
      />

      <ImportSheet open={importOpen} onClose={() => setImportOpen(false)} decks={decks ?? []} />
      <DeckOptionsSheet deck={optionsFor} onClose={() => setOptionsFor(null)} decks={decks ?? []} />
    </div>
  );
}

function isDescendant(id: string, ancestorId: string, decks: Deck[]): boolean {
  const byId = new Map(decks.map((d) => [d.id, d]));
  let cur = byId.get(id);
  let guard = 0;
  while (cur?.parentId && guard++ < 50) {
    if (cur.parentId === ancestorId) return true;
    cur = byId.get(cur.parentId);
  }
  return false;
}
