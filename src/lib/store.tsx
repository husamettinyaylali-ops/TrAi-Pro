import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import * as api from "@/api/functions";

import type {
  Account,
  ActionErrorCode,
  AuthErrorCode,
  GenerateInput,
  Generation,
  Order,
  PaymentMethod,
  SessionPayload,
  UserData,
} from "./types";

export type { ClonedVoice, Generation, Order, PaymentMethod, UserData } from "./types";

/** Sunucuya ulaşılamadığında istemcinin ürettiği hata. */
export type NetworkError = "network";

type Outcome<T, E extends string> = ({ ok: true } & T) | { ok: false; error: E | NetworkError };

interface Store {
  hydrated: boolean;
  user: Account | null;
  data: UserData;
  signUp: (input: {
    name: string;
    email: string;
    password: string;
  }) => Promise<Outcome<object, AuthErrorCode>>;
  signIn: (input: { email: string; password: string }) => Promise<Outcome<object, AuthErrorCode>>;
  signOut: () => Promise<void>;
  purchase: (
    packageId: string,
    method: PaymentMethod,
  ) => Promise<Outcome<{ order: Order }, ActionErrorCode>>;
  generate: (input: GenerateInput) => Promise<Outcome<{ generation: Generation }, ActionErrorCode>>;
  deleteGeneration: (id: string) => Promise<void>;
  addClone: (name: string) => Promise<Outcome<object, ActionErrorCode>>;
}

const SESSION_KEY = ["session"] as const;
const emptyData: UserData = { grants: [], orders: [], generations: [], clones: [] };

const Ctx = createContext<Store | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const session = useQuery({
    queryKey: SESSION_KEY,
    queryFn: () => api.getSession(),
    staleTime: 30_000,
    retry: 1,
  });

  const store = useMemo<Store>(() => {
    const put = (next: SessionPayload | null) => qc.setQueryData(SESSION_KEY, next);

    /** Sunucu çağrısını sarar: oturum düştüyse önbelleği temizler, ağ hatasını sonuca çevirir. */
    async function call<R extends { ok: boolean; error?: string; session?: SessionPayload }>(
      fn: () => Promise<R>,
    ): Promise<R | { ok: false; error: NetworkError }> {
      try {
        const res = await fn();
        if (res.session) put(res.session);
        if (!res.ok && res.error === "unauthorized") put(null);
        return res;
      } catch {
        return { ok: false, error: "network" };
      }
    }

    return {
      hydrated: !session.isPending,
      user: session.data?.user ?? null,
      data: session.data?.data ?? emptyData,
      signUp: (input) => call(() => api.signUp({ data: input })),
      signIn: (input) => call(() => api.signIn({ data: input })),
      signOut: async () => {
        await call(() => api.signOut());
        put(null);
      },
      purchase: (packageId, method) => call(() => api.purchase({ data: { packageId, method } })),
      generate: (input) => call(() => api.generate({ data: input })),
      deleteGeneration: async (id) => {
        await call(() => api.deleteGeneration({ data: { id } }));
      },
      addClone: (name) => call(() => api.addClone({ data: { name } })),
    };
  }, [qc, session.isPending, session.data]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp outside AppProvider");
  return c;
}
