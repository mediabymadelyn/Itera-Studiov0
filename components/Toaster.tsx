"use client";

import { ReactNode, useEffect, useSyncExternalStore } from "react";

// One small note at a time in the bottom corner ("Removed … · Undo",
// "Couldn't save this image"), so saving never pushes the page around.

type Toast = { id: number; message: ReactNode; action?: { label: string; run: () => void } };

const TOAST_MS = 6000;
let current: Toast | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function emit(toast: Toast | null) {
  current = toast;
  listeners.forEach((listener) => listener());
}

export function showToast(message: ReactNode, action?: Toast["action"]) {
  emit({ id: nextId++, message, action });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export default function Toaster() {
  const toast = useSyncExternalStore(subscribe, () => current, () => null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => current?.id === toast.id && emit(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <div className="toaster" role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className="toast">
          <span>{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                toast.action?.run();
                emit(null);
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
