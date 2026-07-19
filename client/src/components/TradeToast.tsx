import { useEffect, useState } from "react";

export interface TradeNotification {
  id: string;
  type: "entry" | "profit" | "loss";
  message: string;
  timestamp: number;
}

// Global notification queue
let listeners: ((n: TradeNotification) => void)[] = [];

export function pushTradeNotification(n: Omit<TradeNotification, "id" | "timestamp">) {
  const notification: TradeNotification = {
    ...n,
    id: Math.random().toString(36).slice(2),
    timestamp: Date.now(),
  };
  listeners.forEach(fn => fn(notification));
}

export function TradeToastContainer() {
  const [toasts, setToasts] = useState<TradeNotification[]>([]);

  useEffect(() => {
    const handler = (n: TradeNotification) => {
      setToasts(prev => [...prev, n]);
      // Auto-dismiss after 5 seconds
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== n.id));
      }, 5000);
    };
    listeners.push(handler);
    return () => { listeners = listeners.filter(l => l !== handler); };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => {
        const emoji = toast.type === "entry" ? "🟢" : toast.type === "profit" ? "💰" : "🔴";
        const borderColor = toast.type === "entry" 
          ? "border-emerald-500/50" 
          : toast.type === "profit" 
            ? "border-amber-500/50" 
            : "border-red-500/50";
        const bgColor = toast.type === "entry"
          ? "bg-emerald-950/90"
          : toast.type === "profit"
            ? "bg-amber-950/90"
            : "bg-red-950/90";

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto ${bgColor} backdrop-blur-sm border ${borderColor} rounded-xl px-4 py-3 shadow-2xl animate-in slide-in-from-right-5 fade-in duration-300 max-w-sm`}
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">{emoji}</span>
              <span className="text-sm text-white/90 font-medium">{toast.message}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
