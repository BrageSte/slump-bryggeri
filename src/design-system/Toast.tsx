import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { cx } from "./cx.ts";
import { Icon } from "./Icon.tsx";

interface ToastItem {
  id: number;
  message: string;
  tone: "success" | "error";
}

const ToastContext = createContext<(message: string, tone?: ToastItem["tone"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const show = useCallback((message: string, tone: ToastItem["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), tone === "error" ? 6000 : 3000);
  }, []);
  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-50 flex flex-col items-center gap-2 px-4 md:top-auto md:bottom-6"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            className={cx(
              "pointer-events-auto flex max-w-md items-center gap-2 rounded-md px-4 py-3 font-semibold shadow-lg",
              toast.tone === "success" ? "bg-text text-bg" : "bg-danger text-surface",
            )}
          >
            <Icon name={toast.tone === "success" ? "check" : "alert"} size={20} />
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
