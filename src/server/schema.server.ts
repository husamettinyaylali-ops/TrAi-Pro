import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Tarihler ISO-8601 UTC metni olarak saklanır; para birimi kuruş/sent tamsayısıdır.

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  /** Yalnız Google ile açılan hesaplarda boştur; bu hesaplar şifreyle giriş yapamaz. */
  passwordHash: text("password_hash"),
  /** E-posta sahipliği kanıtlandığında (doğrulama bağlantısı, şifre sıfırlama ya da Google). */
  emailVerifiedAt: text("email_verified_at"),
  createdAt: text("created_at").notNull(),
  /**
   * Hesap silindiğinde dolar. Satır, mali kayıtlar (sipariş, bakiye defteri,
   * ödeme talepleri) yasal saklama süresince bağlı kalsın diye kişisel bilgisi
   * silinerek (ad boş, e-posta deleted-<id>@invalid, şifre yok) tutulur.
   */
  deletedAt: text("deleted_at"),
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
    /** "balance": bakiyeden alım. Eski değerler demo dönemin kayıtları içindir. */
    method: text("method", { enum: ["card", "crypto", "bank", "balance"] }).notNull(),
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
    /** Gerçek seslendirmede ses dosyasının depodaki anahtarı; demo üretimde boş. */
    audioKey: text("audio_key"),
    /** Gerçek görsel/video üretiminde dosyaların depodaki anahtarları; demo üretimde boş. */
    files: text("files", { mode: "json" }).$type<string[]>(),
    /**
     * Uzun süren üretimde (video) iş durumu; boşsa tamamlanmış sayılır.
     * "failed" olan işin kredisi iade edilmiştir.
     */
    status: text("status", { enum: ["pending", "failed"] }),
    /** Sağlayıcıdaki iş: kuyruk kimliği ve durum/sonuç adresleri. */
    job: text("job", { mode: "json" }).$type<{
      requestId: string;
      statusUrl: string;
      responseUrl: string;
      cancelUrl: string | null;
    }>(),
    /** Hangi paketten kaç kredi düşüldüğü; başarısız işte aynı paketlere iade edilir. */
    charges: text("charges", { mode: "json" }).$type<{ grantId: string; amount: number }[]>(),
    cost: integer("cost").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("generations_user_idx").on(t.userId), index("generations_status_idx").on(t.status)],
);

export const voiceClones = sqliteTable(
  "voice_clones",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Sağlayıcıdaki (ElevenLabs) ses kimliği; demo klonda boş. */
    providerVoiceId: text("provider_voice_id"),
    /** Kullanıcının "bu ses bana ait ya da izinliyim" onayını verdiği an. */
    consentAt: text("consent_at"),
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

/**
 * E-posta doğrulama ve şifre sıfırlama token'ları. Kimlik, e-postadaki token'ın
 * SHA-256 özetidir; token düz metin saklanmaz. Tek kullanımlıktır.
 */
export const emailTokens = sqliteTable(
  "email_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose", { enum: ["verify", "reset"] }).notNull(),
    /** Token verildiğindeki e-posta; adres sonradan değişirse doğrulama geçersiz olur. */
    email: text("email").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
  },
  (t) => [index("email_tokens_user_idx").on(t.userId)],
);

/**
 * USD bakiye defteri. Kayıtlar değiştirilmez; düzeltme yeni kayıtla yapılır
 * ("adjust"). Bakiye, kullanıcının kayıtlarının toplamıdır (sent).
 */
export const walletEntries = sqliteTable(
  "wallet_entries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["topup", "purchase", "adjust"] }).notNull(),
    /** Artı: yükleme; eksi: harcama. */
    amountCents: integer("amount_cents").notNull(),
    /** Yükleme talebi ya da sipariş kimliği. */
    reference: text("reference"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("wallet_entries_user_idx").on(t.userId)],
);

/**
 * Bakiye yükleme talebi. Kripto yöntemlerinde ödemeyi kullanıcıya bağlayan
 * benzersiz tutar (payAmount) tutulur. Sağlayıcı işlem kimliği (providerRef)
 * yöntem başına benzersizdir: aynı ödeme iki kez bakiyeye yazılamaz.
 */
export const paymentIntents = sqliteTable(
  "payment_intents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    method: text("method", { enum: ["usdt_bep20", "binance_pay", "paypal", "demo"] }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    payAmount: text("pay_amount").notNull(),
    payCurrency: text("pay_currency", { enum: ["USDT", "USD"] }).notNull(),
    status: text("status", { enum: ["pending", "completed", "expired"] }).notNull(),
    providerRef: text("provider_ref"),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    completedAt: text("completed_at"),
    /** Kullanıcının talep anındaki dili; makbuz e-postası bu dilde gider. */
    lang: text("lang", { enum: ["tr", "en"] }),
    /** Makbuz e-postası gönderildiyse zamanı (her ödeme için bir kez). */
    receiptSentAt: text("receipt_sent_at"),
  },
  (t) => [
    index("payment_intents_user_idx").on(t.userId),
    uniqueIndex("payment_intents_ref_idx").on(t.method, t.providerRef),
  ],
);

/**
 * Yönetici işlemleri kaydı (denetim). Kayıtlar değiştirilmez ve hesap
 * silinince de kalır; her bakiye düzeltmesi ve elle tamamlanan ödeme buraya
 * gerekçesiyle yazılır.
 */
export const adminActions = sqliteTable(
  "admin_actions",
  {
    id: text("id").primaryKey(),
    adminId: text("admin_id")
      .notNull()
      .references(() => users.id),
    action: text("action", { enum: ["adjustBalance", "completeIntent"] }).notNull(),
    targetUserId: text("target_user_id").references(() => users.id),
    reason: text("reason").notNull(),
    /** İşleme özgü ayrıntılar (JSON): tutar, talep kimliği, sağlayıcı referansı. */
    details: text("details").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("admin_actions_target_idx").on(t.targetUserId),
    index("admin_actions_created_idx").on(t.createdAt),
  ],
);

/**
 * Geliştirici API anahtarı. Anahtarın kendisi saklanmaz, yalnız SHA-256 özeti;
 * kullanıcı anahtarı oluşturduğunda bir kez görür. İptal edilen anahtar kalır
 * (revokedAt) ama kabul edilmez.
 */
export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Listede gösterilen baş kısım, ör. "trai_AbC123xy". */
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    createdAt: text("created_at").notNull(),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
  },
  (t) => [index("api_keys_user_idx").on(t.userId)],
);
