import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { MAX_CLONES, createGrant, spend, type CreditKind, type Grant } from "./credits";
import { findPackage, signupBonus } from "./packages";

export type PaymentMethod = "card" | "crypto" | "bank";

export interface Account {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface Order {
  id: string;
  packageId: string;
  kind: CreditKind;
  credits: number;
  days: number;
  amountUsd: number;
  method: PaymentMethod;
  createdAt: string;
  expiresAt: string;
  status: "paid";
}

export interface Generation {
  id: string;
  type: "tts" | "image" | "video";
  text: string;
  voiceId?: string | undefined;
  style?: string | undefined;
  images?: number[] | undefined;
  cost: number;
  createdAt: string;
}

export interface ClonedVoice {
  id: string;
  name: string;
  createdAt: string;
}

export interface UserData {
  grants: Grant[];
  orders: Order[];
  generations: Generation[];
  clones: ClonedVoice[];
}

interface Persisted {
  accounts: Account[];
  data: Record<string, UserData>;
  sessionId: string | null;
}

const KEY = "traipro:v1";
const empty: Persisted = { accounts: [], data: {}, sessionId: null };
const emptyData = (): UserData => ({ grants: [], orders: [], generations: [], clones: [] });

/** "Şimdi" tek yerden alınır. */
export const clock = () => new Date();

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const normEmail = (e: string) => e.trim().toLocaleLowerCase("en-US");

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty;
    const p = JSON.parse(raw) as Persisted;
    return { accounts: p.accounts ?? [], data: p.data ?? {}, sessionId: p.sessionId ?? null };
  } catch {
    return empty;
  }
}

interface Store {
  hydrated: boolean;
  user: Account | null;
  data: UserData;
  signUp: (input: {
    name: string;
    email: string;
  }) => { ok: true } | { ok: false; error: "emailTaken" };
  signIn: (email: string) => { ok: true } | { ok: false; error: "accountMissing" };
  signOut: () => void;
  purchase: (packageId: string, method: PaymentMethod) => Order | null;
  generate: (
    gen: Omit<Generation, "id" | "createdAt" | "cost">,
    kind: CreditKind,
    cost: number,
  ) => { ok: true; generation: Generation } | { ok: false; error: "insufficient" };
  deleteGeneration: (id: string) => void;
  addClone: (name: string) => { ok: true; clone: ClonedVoice } | { ok: false; error: "limit" };
}

const Ctx = createContext<Store | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Persisted>(empty);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(load());
    setHydrated(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setState(load());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* depolama doluysa ya da kapalıysa oturum bellekte sürer */
    }
  }, [state, hydrated]);

  const user = state.accounts.find((a) => a.id === state.sessionId) ?? null;
  const data = (user && state.data[user.id]) || emptyData();

  const updateData = useCallback((fn: (d: UserData) => UserData) => {
    setState((s) => {
      if (!s.sessionId) return s;
      return { ...s, data: { ...s.data, [s.sessionId]: fn(s.data[s.sessionId] ?? emptyData()) } };
    });
  }, []);

  const store = useMemo<Store>(
    () => ({
      hydrated,
      user,
      data,
      signUp: ({ name, email }) => {
        if (state.accounts.some((a) => a.email === normEmail(email)))
          return { ok: false, error: "emailTaken" };
        const now = clock();
        const account: Account = {
          id: uid(),
          name: name.trim(),
          email: normEmail(email),
          createdAt: now.toISOString(),
        };
        const bonus = createGrant({ id: uid(), packageId: "signup-bonus", ...signupBonus }, now);
        setState((s) => ({
          accounts: [...s.accounts, account],
          data: { ...s.data, [account.id]: { ...emptyData(), grants: [bonus] } },
          sessionId: account.id,
        }));
        return { ok: true };
      },
      signIn: (email) => {
        const account = state.accounts.find((a) => a.email === normEmail(email));
        if (!account) return { ok: false, error: "accountMissing" };
        setState((s) => ({ ...s, sessionId: account.id }));
        return { ok: true };
      },
      signOut: () => setState((s) => ({ ...s, sessionId: null })),
      purchase: (packageId, method) => {
        const pkg = findPackage(packageId);
        if (!pkg || !user) return null;
        const now = clock();
        const grant = createGrant(
          { id: uid(), kind: pkg.kind, packageId: pkg.id, credits: pkg.credits, days: pkg.days },
          now,
        );
        const order: Order = {
          id: grant.id,
          packageId: pkg.id,
          kind: pkg.kind,
          credits: pkg.credits,
          days: pkg.days,
          amountUsd: pkg.priceUsd,
          method,
          createdAt: grant.grantedAt,
          expiresAt: grant.expiresAt,
          status: "paid",
        };
        updateData((d) => ({ ...d, grants: [...d.grants, grant], orders: [order, ...d.orders] }));
        return order;
      },
      generate: (gen, kind, cost) => {
        const now = clock();
        const next = spend(data.grants, kind, cost, now);
        if (!next) return { ok: false, error: "insufficient" };
        const generation: Generation = { ...gen, id: uid(), cost, createdAt: now.toISOString() };
        updateData((d) => ({ ...d, grants: next, generations: [generation, ...d.generations] }));
        return { ok: true, generation };
      },
      deleteGeneration: (id) =>
        updateData((d) => ({ ...d, generations: d.generations.filter((g) => g.id !== id) })),
      addClone: (name) => {
        if (data.clones.length >= MAX_CLONES) return { ok: false, error: "limit" };
        const clone: ClonedVoice = {
          id: `clone-${uid()}`,
          name: name.trim(),
          createdAt: clock().toISOString(),
        };
        updateData((d) => ({ ...d, clones: [...d.clones, clone] }));
        return { ok: true, clone };
      },
    }),
    [hydrated, user, data, state.accounts, updateData],
  );

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp outside AppProvider");
  return c;
}
