import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

type ToastFn = (message: string, ms?: number) => void;

const ToastContext = createContext<ToastFn>(() => undefined);

export const useToast = (): ToastFn => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const toast = useCallback<ToastFn>((msg, ms = 3400) => {
    clearTimeout(timer.current);
    setMessage(msg);
    setVisible(true);
    timer.current = setTimeout(() => setVisible(false), ms);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);
  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={visible ? 'toast show' : 'toast'} role="status" aria-live="polite">
        {message}
      </div>
    </ToastContext.Provider>
  );
}
