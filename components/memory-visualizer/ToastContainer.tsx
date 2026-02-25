'use client';

import type { ToastItem } from '@/hooks/useToast';

interface ToastContainerProps {
  toasts: ToastItem[];
  dismissToast: (id: number) => void;
}

export function ToastContainer({ toasts, dismissToast }: ToastContainerProps) {
  return (
    <div
      id="toast-container"
      className="toast-container"
      aria-live="polite"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast ${toast.isExiting ? 'toast--out' : ''}`}
          onClick={() => dismissToast(toast.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') dismissToast(toast.id);
          }}
          role="button"
          tabIndex={0}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
