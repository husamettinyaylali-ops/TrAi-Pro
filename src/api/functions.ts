import { createServerFn } from "@tanstack/react-start";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { z } from "zod";

import { clock } from "@/lib/clock";
import type { Account, SessionPayload } from "@/lib/types";

import { getDb } from "@/server/db.server";
import * as svc from "@/server/services.server";
import { SESSION_COOKIE } from "@/server/session.server";

// İstemci bu dosyadaki fonksiyonları RPC olarak çağırır; gövdeler yalnız sunucuda çalışır.

const parse =
  <T extends z.ZodTypeAny>(schema: T) =>
  (input: unknown): z.infer<T> =>
    schema.parse(input);

const email = z.string().trim().email().max(254);
const password = z.string().min(8).max(200);

function setSessionCookie(token: string, expires: Date) {
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env["NODE_ENV"] === "production",
    path: "/",
    expires,
  });
}

async function currentUser(): Promise<Account | null> {
  const token = getCookie(SESSION_COOKIE);
  if (!token) return null;
  return svc.getSessionUser(await getDb(), token, clock());
}

async function payloadFor(user: Account): Promise<SessionPayload> {
  return { user, data: await svc.loadUserData(await getDb(), user.id) };
}

async function startSession(userId: string): Promise<SessionPayload> {
  const db = await getDb();
  const { token, expiresAt } = await svc.createSession(db, userId, clock());
  setSessionCookie(token, expiresAt);
  const user = await svc.getSessionUser(db, token, clock());
  if (!user) throw new Error("Oturum oluşturulamadı");
  return payloadFor(user);
}

export const getSession = createServerFn({ method: "GET" }).handler(async () => {
  const user = await currentUser();
  return user ? payloadFor(user) : null;
});

export const signUp = createServerFn({ method: "POST" })
  .validator(parse(z.object({ name: z.string().trim().min(1).max(80), email, password })))
  .handler(async ({ data }) => {
    const res = await svc.registerUser(await getDb(), data, clock());
    if (!res.ok) return res;
    return { ok: true as const, session: await startSession(res.userId) };
  });

export const signIn = createServerFn({ method: "POST" })
  .validator(parse(z.object({ email, password: z.string().min(1).max(200) })))
  .handler(async ({ data }) => {
    const res = await svc.authenticate(await getDb(), data);
    if (!res.ok) return res;
    return { ok: true as const, session: await startSession(res.userId) };
  });

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  const token = getCookie(SESSION_COOKIE);
  if (token) await svc.deleteSession(await getDb(), token);
  deleteCookie(SESSION_COOKIE, { path: "/" });
  return { ok: true as const };
});

/** Demo ödemeler üretimde yalnız DEMO_PAYMENTS=on ise açıktır. */
const demoPaymentsEnabled = () =>
  process.env["NODE_ENV"] !== "production" || process.env["DEMO_PAYMENTS"] === "on";

export const purchase = createServerFn({ method: "POST" })
  .validator(
    parse(z.object({ packageId: z.string().max(40), method: z.enum(["card", "crypto", "bank"]) })),
  )
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    if (!demoPaymentsEnabled()) return { ok: false as const, error: "paymentsDisabled" as const };
    const res = await svc.purchasePackage(await getDb(), user.id, data, clock());
    if (!res.ok) return res;
    return { ok: true as const, order: res.order, session: await payloadFor(user) };
  });

const generateSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tts"), text: z.string().max(10_000), voiceId: z.string().max(80) }),
  z.object({ type: z.literal("image"), text: z.string().max(1_000), count: z.number().int() }),
  z.object({ type: z.literal("video"), text: z.string().max(1_000), styleIndex: z.number().int() }),
]);

export const generate = createServerFn({ method: "POST" })
  .validator(parse(generateSchema))
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    const res = await svc.generateContent(await getDb(), user.id, data, clock());
    if (!res.ok) return res;
    return { ok: true as const, generation: res.generation, session: await payloadFor(user) };
  });

export const deleteGeneration = createServerFn({ method: "POST" })
  .validator(parse(z.object({ id: z.string().max(80) })))
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    await svc.removeGeneration(await getDb(), user.id, data.id);
    return { ok: true as const, session: await payloadFor(user) };
  });

export const addClone = createServerFn({ method: "POST" })
  .validator(parse(z.object({ name: z.string().max(80) })))
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    const res = await svc.addVoiceClone(await getDb(), user.id, data.name, clock());
    if (!res.ok) return res;
    return { ok: true as const, session: await payloadFor(user) };
  });
