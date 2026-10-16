import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import * as api from "@/api/functions";

import { useI18n, type Lang } from "./i18n";
import type {
  Account,
  AccountErrorCode,
  ActionErrorCode,
  AuthErrorCode,
  ClaimErrorCode,
  EmailErrorCode,
  GenerateInput,
  Generation,
  GenerationPage,
  GenerationType,
  Order,
  Project,
  ProjectErrorCode,
  RateLimited,
  SessionPayload,
  TokenErrorCode,
  TopUpErrorCode,
  TopUpIntent,
  TopUpMethod,
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
  /** Yönetim menüsünü göstermek için; yetki sunucuda denetlenir. */
  admin: boolean;
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
  /** USDT (BEP20) ödemesini işlem kimliğiyle doğrulayıp bakiyeye yazar. */
  claimUsdt: (
    txHash: string,
  ) => Promise<Outcome<{ intent: TopUpIntent }, ClaimErrorCode> | RateLimited>;
  /** Binance Pay ödemesini kontrol edip bakiyeye yazar (bekleyen benzersiz tutarla). */
  claimBinance: () => Promise<Outcome<{ intent: TopUpIntent }, ClaimErrorCode> | RateLimited>;
  /** PayPal düğmesi için sipariş açar. */
  startPaypal: (
    intentId: string,
  ) => Promise<
    | Outcome<
        { orderId: string },
        "unauthorized" | "noPending" | "providerFailed" | "methodDisabled"
      >
    | RateLimited
  >;
  /** Onaylanan PayPal siparişini tahsil edip bakiyeye yazar. */
  capturePaypal: (
    orderId: string,
  ) => Promise<Outcome<{ intent: TopUpIntent }, ClaimErrorCode> | RateLimited>;
  /** Paketi USD bakiyeden alır. */
  purchase: (packageId: string) => Promise<Outcome<{ order: Order }, ActionErrorCode>>;
  /** Bakiye yükleme talebi; demo yöntemi hemen tamamlanır. */
  topUp: (
    method: TopUpMethod,
    amountCents: number,
  ) => Promise<Outcome<{ intent: TopUpIntent }, TopUpErrorCode> | RateLimited>;
  generate: (
    input: GenerateInput,
  ) => Promise<Outcome<{ generation: Generation }, ActionErrorCode> | RateLimited>;
  deleteGeneration: (id: string) => Promise<void>;
  /** Hazırlanan videonun durumunu yeniler. */
  checkVideo: (id: string) => Promise<void>;
  /** Tek üretim (stüdyoda düzenlemeye açmak için). */
  getGeneration: (id: string) => Promise<Outcome<{ generation: Generation }, ProjectErrorCode>>;
  /** Üretime ad verir; boş ad adı kaldırır. */
  renameGeneration: (
    id: string,
    title: string,
  ) => Promise<Outcome<{ generation: Generation }, ProjectErrorCode>>;
  /** Üretimi projeye taşır ya da projeden çıkarır (null). */
  moveGeneration: (
    id: string,
    projectId: string | null,
  ) => Promise<Outcome<{ generation: Generation }, ProjectErrorCode>>;
  createProject: (input: {
    name: string;
    notes?: string | undefined;
  }) => Promise<Outcome<{ project: Project }, ProjectErrorCode>>;
  updateProject: (
    id: string,
    changes: { name?: string | undefined; notes?: string | undefined },
  ) => Promise<Outcome<{ project: Project }, ProjectErrorCode>>;
  /** Projeyi siler; üretimleri projesiz kalır. */
  deleteProject: (id: string) => Promise<Outcome<object, ProjectErrorCode>>;
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
  clones: [],
  security: { hasPassword: false, googleLinked: false, emailVerified: false },
  wallet: { balanceCents: 0, entries: [], pending: [] },
};

const Ctx = createContext<Store | null>(null);

// ---------------------------------------------------------------- stüdyo geçmişi

const HISTORY = "generations";
const PROJECTS = "projects";
/** Geçmiş anahtarı: kullanıcı, tür ve proje süzgeci ("all" = süzgeçsiz). */
const historyKey = (userId: string, type?: GenerationType, projectId?: string) =>
  [HISTORY, userId, type ?? "all", projectId ?? "all"] as const;
type HistoryData = InfiniteData<GenerationPage, string | undefined>;

/** Üretim bu geçmiş listesine girer mi (tür ve proje süzgeci). */
const belongs = (key: readonly unknown[], g: Generation) =>
  (key[2] === "all" || key[2] === g.type) && (key[3] === "all" || key[3] === g.projectId);

/**
 * Üretimi önbellekteki geçmişlerde günceller: artık ait olmadığı listeden
 * çıkar (ör. başka projeye taşındı); `prepend` ise ait olduğu listelerin başına eklenir.
 */
function upsertHistory(qc: QueryClient, userId: string, g: Generation, prepend: boolean) {
  for (const [key, d] of qc.getQueriesData<HistoryData>({ queryKey: [HISTORY, userId] })) {
    if (!d) continue;
    const fits = belongs(key, g);
    const present = d.pages.some((p) => p.items.some((x) => x.id === g.id));
    let pages = d.pages;
    if (present) {
      pages = d.pages.map((p) => ({
        ...p,
        items: fits
          ? p.items.map((x) => (x.id === g.id ? g : x))
          : p.items.filter((x) => x.id !== g.id),
      }));
    } else if (prepend && fits && d.pages[0]) {
      const [first, ...rest] = d.pages;
      pages = [{ ...first, items: [g, ...first.items] }, ...rest];
    }
    if (pages !== d.pages) qc.setQueryData<HistoryData>(key, { ...d, pages });
  }
}

function dropFromHistory(qc: QueryClient, userId: string, id: string) {
  qc.setQueriesData<HistoryData>({ queryKey: [HISTORY, userId] }, (d) =>
    d
      ? { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.filter((x) => x.id !== id) })) }
      : d,
  );
}

export function AppProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  // Makbuz e-postaları kullanıcının o anki dilinde gider.
  const { lang } = useI18n();
  const session = useQuery({
    queryKey: SESSION_KEY,
    queryFn: () => api.getSession(),
    staleTime: 30_000,
    retry: 1,
  });

  const store = useMemo<Store>(() => {
    const userId = session.data?.user.id;
    const put = (next: SessionPayload | null) => {
      qc.setQueryData(SESSION_KEY, next);
      if (!next) {
        qc.removeQueries({ queryKey: [HISTORY] });
        qc.removeQueries({ queryKey: [PROJECTS] });
      }
    };

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
      admin: session.data?.admin ?? false,
      signUp: (input) => call(() => api.signUp({ data: input })),
      signIn: (input) => call(() => api.signIn({ data: input })),
      signOut: async () => {
        await call(() => api.signOut());
        put(null);
      },
      purchase: (packageId) => call(() => api.purchase({ data: { packageId, lang } })),
      topUp: (method, amountCents) =>
        call(() => api.topUp({ data: { method, amountCents, lang } })),
      claimUsdt: (txHash) => call(() => api.claimUsdt({ data: { txHash } })),
      claimBinance: () => call(() => api.claimBinance()),
      startPaypal: (intentId) => call(() => api.startPaypal({ data: { intentId } })),
      capturePaypal: (orderId) => call(() => api.capturePaypal({ data: { orderId } })),
      generate: async (input) => {
        const res = await call(() => api.generate({ data: input }));
        if (res.ok && userId) {
          upsertHistory(qc, userId, res.generation, true);
          if (res.generation.projectId) void qc.invalidateQueries({ queryKey: [PROJECTS] });
        }
        return res;
      },
      checkVideo: async (id) => {
        const res = await call(() => api.checkVideo({ data: { id } }));
        if (res.ok && userId) upsertHistory(qc, userId, res.generation, false);
      },
      deleteGeneration: async (id) => {
        const res = await call(() => api.deleteGeneration({ data: { id } }));
        if (res.ok && userId) {
          dropFromHistory(qc, userId, id);
          void qc.invalidateQueries({ queryKey: [PROJECTS] });
        }
      },
      getGeneration: (id) => call(() => api.getGeneration({ data: { id } })),
      renameGeneration: async (id, title) => {
        const res = await call(() => api.renameGeneration({ data: { id, title } }));
        if (res.ok && userId) upsertHistory(qc, userId, res.generation, false);
        return res;
      },
      moveGeneration: async (id, projectId) => {
        const res = await call(() => api.moveGeneration({ data: { id, projectId } }));
        if (res.ok && userId) {
          // Eski listeden hemen çıkar; hedef listenin sırası sunucudan yeniden gelir.
          upsertHistory(qc, userId, res.generation, false);
          void qc.invalidateQueries({ queryKey: [HISTORY, userId] });
          void qc.invalidateQueries({ queryKey: [PROJECTS] });
        }
        return res;
      },
      createProject: async (input) => {
        const res = await call(() => api.createProject({ data: input }));
        if (res.ok) {
          // Yeni proje hemen seçilebilsin diye listeye eklenir; ardından sunucudan yenilenir.
          qc.setQueryData<Project[]>([PROJECTS, userId ?? ""], (list) =>
            list ? [res.project, ...list] : list,
          );
          void qc.invalidateQueries({ queryKey: [PROJECTS] });
        }
        return res;
      },
      updateProject: async (id, changes) => {
        const res = await call(() => api.updateProject({ data: { id, ...changes } }));
        if (res.ok) void qc.invalidateQueries({ queryKey: [PROJECTS] });
        return res;
      },
      deleteProject: async (id) => {
        const res = await call(() => api.deleteProject({ data: { id } }));
        if (res.ok) {
          void qc.invalidateQueries({ queryKey: [PROJECTS] });
          void qc.invalidateQueries({ queryKey: [HISTORY] });
        }
        return res;
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
  }, [qc, session.isPending, session.data, lang]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp outside AppProvider");
  return c;
}

export interface History {
  items: Generation[];
  /** İlk sayfa yükleniyor. */
  loading: boolean;
  error: boolean;
  retry: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
}

/**
 * Stüdyo sekmesinin ya da projenin geçmişi: ilk sayfa açılınca, sonrakiler
 * "daha fazla" ile gelir. Tür ve proje verilmezse süzgeç yoktur. Üretme,
 * silme, taşıma, adlandırma ve video kontrolü önbelleği günceller.
 */
export function useHistory(type?: GenerationType, projectId?: string): History {
  const qc = useQueryClient();
  const { user } = useApp();
  const q = useInfiniteQuery({
    queryKey: historyKey(user?.id ?? "", type, projectId),
    queryFn: async ({ pageParam }): Promise<GenerationPage> => {
      const res = await api.listGenerations({ data: { type, projectId, cursor: pageParam } });
      if (!res.ok) {
        // Oturum düşmüş: oturum yeniden sorulur, giriş yoksa geçmiş kapanır.
        void qc.invalidateQueries({ queryKey: SESSION_KEY });
        throw new Error(res.error);
      }
      return { items: res.items, next: res.next };
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: Boolean(user),
    staleTime: 30_000,
  });
  const pages = q.data?.pages;
  const items = useMemo(() => pages?.flatMap((p) => p.items) ?? [], [pages]);
  return {
    items,
    loading: Boolean(user) && q.isPending,
    error: q.isError,
    retry: () => void q.refetch(),
    hasMore: q.hasNextPage,
    loadingMore: q.isFetchingNextPage,
    loadMore: () => void q.fetchNextPage(),
  };
}

/** Kullanıcının projeleri (son etkinliğe göre); proje işlemleri bu listeyi yeniler. */
export function useProjects() {
  const { user } = useApp();
  return useQuery({
    queryKey: [PROJECTS, user?.id ?? ""],
    queryFn: async (): Promise<Project[]> => {
      const res = await api.listProjects();
      if (!res.ok) throw new Error(res.error);
      return res.projects;
    },
    enabled: Boolean(user),
    staleTime: 30_000,
  });
}
