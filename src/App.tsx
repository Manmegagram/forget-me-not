import { AnimatePresence, LayoutGroup, motion, MotionConfig } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { I18nProvider, useT } from './i18n';
import { applyTheme, setAppBadge, useDeckCounts, useDecks, useSettings } from './state';
import { ToastProvider } from './ui/components';
import { IconHome, IconSettings, IconStats, IconStudy } from './ui/icons';
import { HomeScreen } from './screens/Home';
import { StudyScreen } from './screens/StudyPicker';
import { StatsScreen } from './screens/Stats';
import { SettingsScreen } from './screens/Settings';
import { Reviewer } from './screens/Reviewer';
import { totalCounts } from './db/queue';
import { requestPersistentStorage } from './db/schema';

export type Tab = 'home' | 'study' | 'stats' | 'settings';

export interface StudyRequest {
  deckId: string | null;
}

export default function App() {
  const settings = useSettings();
  useEffect(() => applyTheme(settings.theme), [settings.theme]);
  useEffect(() => {
    void requestPersistentStorage();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme(settings.theme);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [settings.theme]);
  useEffect(() => {
    document.documentElement.lang = settings.language;
  }, [settings.language]);

  return (
    <I18nProvider lang={settings.language}>
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          <Shell dayStartHour={settings.dayStartHour} />
        </ToastProvider>
      </MotionConfig>
    </I18nProvider>
  );
}

function Shell({ dayStartHour }: { dayStartHour: number }) {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>('home');
  const [study, setStudy] = useState<StudyRequest | null>(null);
  const decks = useDecks();
  const counts = useDeckCounts(dayStartHour);
  const topIds = useMemo(() => (decks ?? []).filter((d) => !d.parentId).map((d) => d.id), [decks]);
  const total = counts ? totalCounts(counts, topIds) : { new: 0, learn: 0, review: 0 };
  const due = total.new + total.learn + total.review;

  useEffect(() => setAppBadge(total.learn + total.review), [total.learn, total.review]);

  const tabs: Array<{ id: Tab; label: string; icon: JSX.Element }> = [
    { id: 'home', label: t('tabHome'), icon: <IconHome /> },
    { id: 'study', label: t('tabStudy'), icon: <IconStudy /> },
    { id: 'stats', label: t('tabStats'), icon: <IconStats /> },
    { id: 'settings', label: t('tabSettings'), icon: <IconSettings /> },
  ];

  const startStudy = (deckId: string | null) => setStudy({ deckId });

  return (
    <div className="app">
      <div className="backdrop"><span /></div>
      <AnimatePresence mode="wait">
        <motion.main
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
        >
          {tab === 'home' && <HomeScreen decks={decks} counts={counts} total={total} onStudy={startStudy} />}
          {tab === 'study' && <StudyScreen decks={decks} counts={counts} total={total} onStudy={startStudy} />}
          {tab === 'stats' && <StatsScreen dayStartHour={dayStartHour} />}
          {tab === 'settings' && <SettingsScreen />}
        </motion.main>
      </AnimatePresence>

      <nav className="tabbar glass strong" aria-label="Main">
        <LayoutGroup>
          {tabs.map((tb) => (
            <button key={tb.id} aria-current={tab === tb.id ? 'page' : undefined} onClick={() => setTab(tb.id)}>
              {tab === tb.id && <motion.span layoutId="tab-pill" className="tab-pill" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
              {tb.icon}
              <span>{tb.label}</span>
              {tb.id === 'study' && due > 0 && <span className="tab-badge" aria-label={`${due}`}>{due > 999 ? '999+' : due}</span>}
            </button>
          ))}
        </LayoutGroup>
      </nav>

      {study && <Reviewer key={study.deckId ?? 'all'} deckId={study.deckId} onExit={() => setStudy(null)} />}
    </div>
  );
}
