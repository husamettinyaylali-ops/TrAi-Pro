import { useEffect, useState } from "react";

/** Talebin bitişine kalan süre (ms); saniyede bir güncellenir. */
export function useRemaining(expiresAt: string): number {
  const [left, setLeft] = useState(() => Date.parse(expiresAt) - Date.now());
  useEffect(() => {
    const tick = () => setLeft(Date.parse(expiresAt) - Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);
  return left;
}
