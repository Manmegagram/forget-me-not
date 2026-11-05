import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconClose } from './icons';
import { useT } from '../i18n';

export const spring = { type: 'spring', stiffness: 420, damping: 34 } as const;

// ---------- Sheet (iOS-style bottom sheet / centered modal on desktop) ----------

export function Sheet({
  open,
  onClose,
  title,
  children,
  actions,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  labelledBy?: string;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useT();
  const id = labelledBy ?? `sheet-${title.replace(/\W+/g, '-')}`;

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    setTimeout(() => ref.current?.querySelector<HTMLElement>('input, textarea, select, button:not([data-close])')?.focus(), 60);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="sheet-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={id}
            className="sheet glass strong"
            initial={reduce ? { opacity: 0 } : { y: '100%' }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: '100%' }}
            transition={spring}
          >
            <div className="sheet-grabber" />
            <div className="sheet-header">
              <h2 id={id} className="title-3">{title}</h2>
              {actions}
              <button data-close className="icon-btn" onClick={onClose} aria-label={t('close')}>
                <IconClose size={20} />
              </button>
            </div>
            <div className="sheet-body">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ---------- Confirm ----------

export function ConfirmSheet({
  open,
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  return (
    <Sheet open={open} onClose={onCancel} title={title}>
      <p className="body secondary" style={{ margin: 0 }}>{message}</p>
      <div className="row">
        <button className="btn block" onClick={onCancel}>{t('cancel')}</button>
        <button className={`btn block ${danger ? 'danger filled' : 'primary'}`} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Sheet>
  );
}

// ---------- Popover menu ----------

export function Menu({
  anchor,
  onClose,
  children,
  label,
}: {
  anchor: DOMRect | null;
  onClose: () => void;
  children: ReactNode;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('touchstart', onDown);
    setTimeout(() => ref.current?.querySelector('button')?.focus(), 30);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('touchstart', onDown);
    };
  }, [anchor, onClose]);

  const style = anchor
    ? (() => {
        const width = 250;
        const left = Math.min(Math.max(12, anchor.right - width), window.innerWidth - width - 12);
        const below = anchor.bottom + 8;
        const fitsBelow = below + 320 < window.innerHeight;
        return fitsBelow ? { left, top: below, width } : { left, bottom: window.innerHeight - anchor.top + 8, width };
      })()
    : undefined;

  return createPortal(
    <AnimatePresence>
      {anchor && (
        <motion.div
          ref={ref}
          role="menu"
          aria-label={label}
          className="menu glass strong"
          style={style}
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.92 }}
          transition={spring}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ---------- Toast ----------

interface ToastItem {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}
const ToastContext = createContext<(text: string, action?: ToastItem['action']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const timer = useRef<number>();
  const show = useCallback((text: string, action?: ToastItem['action']) => {
    window.clearTimeout(timer.current);
    setToast({ id: Date.now(), text, action });
    timer.current = window.setTimeout(() => setToast(null), action ? 5000 : 2600);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {createPortal(
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast.id}
              className="toast glass strong"
              role="status"
              aria-live="polite"
              initial={{ opacity: 0, y: 20, x: '-50%' }}
              animate={{ opacity: 1, y: 0, x: '-50%' }}
              exit={{ opacity: 0, y: 20, x: '-50%' }}
              transition={spring}
            >
              <span>{toast.text}</span>
              {toast.action && (
                <button
                  className="btn small plain"
                  onClick={() => {
                    toast.action!.run();
                    setToast(null);
                  }}
                >
                  {toast.action.label}
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ---------- Small controls ----------

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span className="track"><span className="thumb" /></span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ art, title, body, children }: { art: ReactNode; title: string; body: string; children?: ReactNode }) {
  return (
    <div className="empty glass">
      <div className="art">{art}</div>
      <h2 className="title-3">{title}</h2>
      <p className="subhead secondary">{body}</p>
      {children}
    </div>
  );
}

/** Button that gently shrinks when pressed (spring). */
export function PressButton(props: React.ComponentProps<typeof motion.button>) {
  const reduce = useReducedMotion();
  return <motion.button whileTap={reduce ? undefined : { scale: 0.94 }} transition={spring} {...props} />;
}
