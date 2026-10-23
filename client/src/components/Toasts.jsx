import { createContext, useCallback, useContext, useState } from 'react';

const ToastContext = createContext(() => {});

// Lets any component call useToast()("message") to show a small popup that disappears after 4s.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((text, kind = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-3), { id, text, kind }]); // keep at most 4 on screen
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
