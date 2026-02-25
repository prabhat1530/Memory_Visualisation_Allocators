'use client';

import { useCallback, useState } from 'react';

export interface ToastItem {
  id: number;
  message: string;
  isExiting?: boolean;
}

export function useToast(durationMs = 4500) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [idCounter, setIdCounter] = useState(0);

  const showToast = useCallback(
    (message: string, customDuration?: number) => {
      const id = idCounter;
      setIdCounter((c) => c + 1);
      const duration = customDuration ?? durationMs;

      setToasts((prev) => [...prev, { id, message }]);

      const timer = setTimeout(() => {
        setToasts((prev) =>
          prev.map((t) => (t.id === id ? { ...t, isExiting: true } : t))
        );
        const removeTimer = setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 250);
        return () => clearTimeout(removeTimer);
      }, duration);
      return () => clearTimeout(timer);
    },
    [durationMs, idCounter]
  );

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isExiting: true } : t))
    );
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 250);
  }, []);

  return { toasts, showToast, dismissToast };
}
