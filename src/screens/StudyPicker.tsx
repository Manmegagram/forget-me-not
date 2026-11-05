import type { Deck } from '../db/types';
import type { DeckCounts } from '../db/queue';
import { useT } from '../i18n';
import { EmptyState } from '../ui/components';
import { FlowerMark } from '../ui/icons';
import { Counts, DeckTree } from './DeckTree';

export function StudyScreen({
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
  return (
    <div className="screen">
      <header className="screen-header">
        <h1 className="large-title">{t('tabStudy')}</h1>
      </header>
      {decks && decks.length === 0 ? (
        <EmptyState art={<FlowerMark />} title={t('emptyDecksTitle')} body={t('emptyDecksBody')} />
      ) : (
        <div className="stack">
          <p className="section-title" style={{ paddingTop: 0 }}>{t('chooseDeck')}</p>
          <div className="glass list">
            <div className="deck-row">
              <span style={{ width: 32 }} />
              <button className="deck-name" onClick={() => onStudy(null)}>{t('allDecks')}</button>
              <Counts c={total} />
            </div>
          </div>
          {decks && <DeckTree decks={decks} counts={counts} onOpen={(d) => onStudy(d.id)} />}
          <p className="footnote tertiary" style={{ textAlign: 'center' }}>{t('shortcuts')}</p>
        </div>
      )}
    </div>
  );
}
