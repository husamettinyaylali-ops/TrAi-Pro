import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Tarihler ISO-8601 UTC metni olarak saklanır; para birimi kuruş/sent tamsayısıdır.

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  /** Yalnız Google ile açılan hesaplarda boştur; bu hesaplar şifreyle giriş yapamaz. */
  passwordHash: text("password_hash"),
  createdAt: text("created_at").notNull(),
});

/** Dış kimlik sağlayıcı bağlantısı (şimdilik yalnız Google). */
export const oauthAccounts = sqliteTable(
  "oauth_accounts",
  {
    provider: text("provider", { enum: ["google"] }).notNull(),
    providerUserId: text("provider_user_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerUserId] }),
    index("oauth_accounts_user_idx").on(t.userId),
  ],
);

/** Oturum kimliği, çerezdeki token'ın SHA-256 özetidir; token düz metin saklanmaz. */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const creditGrants = sqliteTable(
  "credit_grants",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["voice", "media"] }).notNull(),
    packageId: text("package_id").notNull(),
    credits: integer("credits").notNull(),
    remaining: integer("remaining").notNull(),
    grantedAt: text("granted_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [index("credit_grants_user_idx").on(t.userId)],
);

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    packageId: text("package_id").notNull(),
    kind: text("kind", { enum: ["voice", "media"] }).notNull(),
    credits: integer("credits").notNull(),
    days: integer("days").notNull(),
    amountCents: integer("amount_cents").notNull(),
    method: text("method", { enum: ["card", "crypto", "bank"] }).notNull(),
    status: text("status", { enum: ["paid"] }).notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [index("orders_user_idx").on(t.userId)],
);

export const generations = sqliteTable(
  "generations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["tts", "image", "video"] }).notNull(),
    text: text("text").notNull(),
    voiceId: text("voice_id"),
    style: text("style"),
    images: text("images", { mode: "json" }).$type<number[]>(),
    cost: integer("cost").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("generations_user_idx").on(t.userId)],
);

export const voiceClones = sqliteTable(
  "voice_clones",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("voice_clones_user_idx").on(t.userId)],
);

/** Giriş ve kayıt denemeleri; kaba kuvvete karşı sınır için. Anahtar ör. "signin:email:<e-posta>". */
export const authAttempts = sqliteTable(
  "auth_attempts",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("auth_attempts_key_idx").on(t.key, t.createdAt)],
);
