"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

const KEY = "gtm_token";
type Ctx = { token: string | null; ready: boolean; setToken: (t: string | null) => void };
const SessionCtx = createContext<Ctx>({ token: null, ready: false, setToken: () => {} });

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [token, set] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try { set(localStorage.getItem(KEY)); } catch { /* storage blocked */ }
    setReady(true);
  }, []);
  const setToken = useCallback((t: string | null) => {
    set(t);
    try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* ignore */ }
  }, []);
  return <SessionCtx.Provider value={{ token, ready, setToken }}>{children}</SessionCtx.Provider>;
}

export const useSession = () => useContext(SessionCtx);

/** Token for Convex calls inside the authenticated shell (always set there). */
export const useToken = () => useContext(SessionCtx).token ?? "";
