import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import * as api from "@/api/functions";

import type { Lang } from "./i18n";
import type {
  Account,
  AccountErrorCode,
  ActionErrorCode,
  AuthErrorCode,
  EmailErrorCode,
  GenerateInput,
  Generation,
  Order,
  PaymentMethod,
  RateLimited,
  SessionPayload,
  TokenErrorCode,
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
    lang?: Lang | undefined;
  }) => Promise<Outcome<object, AuthErrorCode> | RateLimited>;
  signIn: (input: {
    email: string;
    password: string;
  }) => Promise<Outcome<object, AuthErrorCode> | RateLimited>;
  signOut: () => Promise<void>;
  purchase: (
    packageId: string,
    method: PaymentMethod,
  ) => Promise<Outcome<{ order: Order }, ActionErrorCode>>;
  generate: (
    input: GenerateInput,
  ) => Promise<Outcome<{ generation: Generation }, ActionErrorCode> | RateLimited>;
  deleteGeneration: (id: string) => Promise<void>;
  /** Demo klon (yalnız ad). */
  addClone: (name: string) => Promise<Outcome<object, ActionErrorCode>>;
  /** Gerçek klon: FormData içinde name, consent ("true") ve file. */
  uploadClone: (form: FormData) => Promise<Outcome<object, ActionErrorCode> | RateLimited>;
  deleteClone: (id: string) => Promise<Outcome<object, ActionErrorCode>>;
  updateName: (name: string) => Promise<Outcome<object, AccountErrorCode>>;
  changePassword: (input: {
    current?: string | undefined;
    next: string;
    lang?: Lang | undefined;
  }) => Promise<Outcome<object, AccountErrorCode> | RateLimited>;
  signOutOthers: () => Promise<Outcome<object, AccountErrorCode>>;
  unlinkGoogle: () => Promise<Outcome<object, AccountErrorCode>>;
  /** Başarıda oturum önbelleği temizlenmez; çağıran önce sayfadan çıkıp `forget()` çağırır. */
  deleteAccount: (input: {
    confirmEmail: string;
    password?: string | undefined;
  }) => Promise<Outcome<object, AccountErrorCode> | RateLimited>;
  /** Yerel oturum bilgisini siler (sunucu çağrısı yapmaz). */
  forget: () => void;
  resendVerification: (
    lang: Lang,
  ) => Promise<Outcome<object, EmailErrorCode | AccountErrorCode> | RateLimited>;
  verifyEmail: (token: string) => Promise<Outcome<object, TokenErrorCode>>;
  requestPasswordReset: (
    email: string,
    lang: Lang,
  ) => Promise<Outcome<object, never> | RateLimited>;
  /** Başarıda tüm oturumlar kapanır; yerel oturum da silinir. */
  resetPassword: (
    token: string,
    password: string,
    lang: Lang,
  ) => Promise<Outcome<object, TokenErrorCode | "invalidInput">>;
}

const SESSION_KEY = ["session"] as const;
const emptyData: UserData = {
  grants: [],
  orders: [],
  generations: [],
  clones: [],
  security: { hasPassword: false, googleLinked: false, emailVerified: false },
};

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
      uploadClone: (form) => call(() => api.uploadClone({ data: form })),
      deleteClone: (id) => call(() => api.deleteClone({ data: { id } })),
      updateName: (name) => call(() => api.updateProfile({ data: { name } })),
      changePassword: (input) => call(() => api.changePassword({ data: input })),
      signOutOthers: () => call(() => api.signOutOthers()),
      unlinkGoogle: () => call(() => api.unlinkGoogle()),
      deleteAccount: (input) => call(() => api.deleteAccount({ data: input })),
      forget: () => put(null),
      resendVerification: (lang) => call(() => api.resendVerification({ data: { lang } })),
      verifyEmail: (token) => call(() => api.verifyEmail({ data: { token } })),
      requestPasswordReset: (email, lang) =>
        call(() => api.requestPasswordReset({ data: { email, lang } })),
      resetPassword: async (token, password, lang) => {
        const res = await call(() => api.resetPassword({ data: { token, password, lang } }));
        if (res.ok) put(null);
        return res;
      },
    };
  }, [qc, session.isPending, session.data]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp outside AppProvider");
  return c;
}
