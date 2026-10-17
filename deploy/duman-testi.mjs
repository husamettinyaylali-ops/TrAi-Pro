#!/usr/bin/env node
/**
 * TrAi Pro — duman testi: yayındaki siteyi dışarıdan sırayla dener.
 *
 *   node deploy/duman-testi.mjs https://alanadiniz.com
 *   node deploy/duman-testi.mjs https://alanadiniz.com --anahtar trai_…   (API ve servis bağlantıları)
 *   node deploy/duman-testi.mjs https://alanadiniz.com --anahtar trai_… --uret   (gerçek üretim, kredi harcar)
 *
 * Anahtar TRAI_KEY ortam değişkeninden de okunur; Hesabım > API anahtarları'ndan oluşturulur.
 * --uret ~10 Ses AI kredisi (kısa seslendirme ve onun yazıya dökülmesi) ve 1 Video & Görsel
 * kredisi (bir görsel) harcar;
 * --video ayrıca 15 kredilik bir video üretip bitmesini bekler (birkaç dakika).
 * Bağımlılığı yoktur (Node 18+). Başarısız kontrol varsa çıkış kodu 1'dir.
 */

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const base = argv.find((a) => /^https?:\/\//.test(a))?.replace(/\/+$/, "");
const key = opt("--anahtar") ?? process.env.TRAI_KEY;
const produce = argv.includes("--uret") || argv.includes("--video");
const video = argv.includes("--video");

if (!base) {
  console.error(
    "Kullanım: node deploy/duman-testi.mjs https://alanadiniz.com [--anahtar trai_…] [--uret] [--video]",
  );
  process.exit(2);
}

class Skip extends Error {}
const results = { ok: 0, fail: 0, skip: 0 };
const mark = { ok: "✓", fail: "✗", skip: "–" };

async function check(name, fn) {
  let state = "ok";
  let note = "";
  try {
    note = (await fn()) ?? "";
  } catch (err) {
    state = err instanceof Skip ? "skip" : "fail";
    note = err instanceof Error ? err.message : String(err);
  }
  results[state] += 1;
  console.log(`${mark[state]} ${name}${note ? ` — ${note}` : ""}`);
}

function expect(cond, message) {
  if (!cond) throw new Error(message);
}

/** Beklenmeyen durumda hata, yanıt gövdesiyle; beklenen durumda gövde okunmaz (sonra JSON okunur). */
async function expectStatus(r, expected) {
  if (r.status !== expected) throw new Error(`HTTP ${r.status} ${await r.text()}`);
}

const request = (path, init = {}) =>
  fetch(path.startsWith("http") ? path : base + path, {
    redirect: "manual",
    signal: AbortSignal.timeout(init.timeout ?? 30_000),
    ...init,
    headers: { "user-agent": "trai-duman-testi", ...(init.headers ?? {}) },
  });
const api = (path, init = {}) =>
  request(`/api/v1${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
const status = (r) => `HTTP ${r.status}`;

console.log(`TrAi Pro duman testi: ${base}\n`);

await check("Sağlık (/health)", async () => {
  const r = await request("/health");
  expect(r.status === 200, `${status(r)} (uygulama ya da veritabanı yanıt vermiyor)`);
  const body = await r.json();
  expect(body.status === "ok", `durum: ${body.status}`);
});

if (base.startsWith("https://")) {
  await check("HTTP isteği HTTPS'e yönleniyor", async () => {
    const r = await request(`${base.replace(/^https:/, "http:")}/`);
    const to = r.headers.get("location") ?? "";
    expect(
      [301, 302, 307, 308].includes(r.status) && to.startsWith("https://"),
      `${status(r)} → ${to || "yönlendirme yok"}`,
    );
  });
}

await check("Ana sayfa ve güvenlik başlıkları", async () => {
  const r = await request("/");
  expect(r.status === 200, status(r));
  expect((await r.text()).includes("<title"), "sayfa başlığı yok");
  const missing = ["x-content-type-options", "x-frame-options", "referrer-policy"].filter(
    (h) => !r.headers.get(h),
  );
  if (base.startsWith("https://") && !r.headers.get("strict-transport-security"))
    missing.push("strict-transport-security");
  expect(missing.length === 0, `eksik başlık: ${missing.join(", ")}`);
});

await check("Herkese açık sayfalar", async () => {
  const bad = [];
  for (const path of [
    "/pricing",
    "/api-docs",
    "/sign-in",
    "/terms-of-service",
    "/privacy-policy",
  ]) {
    const r = await request(path);
    if (r.status !== 200) bad.push(`${path} ${r.status}`);
  }
  expect(bad.length === 0, bad.join(", "));
});

await check("robots.txt ve site haritası", async () => {
  const robots = await (await request("/robots.txt")).text();
  expect(
    robots.includes(`Sitemap: ${base}/sitemap.xml`),
    "robots.txt'te site haritası yok: PUBLIC_URL bu adres olmalı",
  );
  const r = await request("/sitemap.xml");
  expect(r.status === 200 && (await r.text()).includes("<urlset"), `site haritası ${status(r)}`);
});

await check("Kişisel dosyalar oturumsuz kapalı", async () => {
  const r = await request("/media/audio/duman-testi");
  expect(r.status === 401, `${status(r)} (401 beklenirdi)`);
});

await check("API anahtarsız istek reddediliyor", async () => {
  const r = await request("/api/v1/me");
  expect(r.status === 401, `${status(r)} (401 beklenirdi)`);
});

let voiceId = null;
if (!key) {
  await check("API ve servis kontrolleri", () => {
    throw new Skip("anahtar verilmedi (--anahtar ya da TRAI_KEY)");
  });
} else {
  await check("API: hesap ve krediler", async () => {
    const r = await api("/me");
    expect(r.status === 200, `${status(r)} (anahtar geçersiz ya da iptal edilmiş)`);
    const b = await r.json();
    return `ses ${b.credits.voice}, video/görsel ${b.credits.media}, bakiye $${b.balance_usd}`;
  });

  await check("Ses servisi (ElevenLabs)", async () => {
    const r = await api("/voices");
    if (r.status === 503) throw new Skip("bu sunucuda kapalı (ELEVENLABS_API_KEY yok)");
    expect(
      r.status === 200,
      `${status(r)} (anahtar ya da servis sorunu; Yönetim > Kurulum durumu)`,
    );
    const { voices } = await r.json();
    voiceId = voices.find((v) => v.type === "stock")?.id ?? voices[0]?.id ?? null;
    expect(voiceId, "hiç ses yok (ELEVENLABS_VOICE_IDS?)");
    return `${voices.length} ses`;
  });

  if (!produce) {
    await check("Gerçek üretim", () => {
      throw new Skip("--uret verilmedi (kredi harcamamak için)");
    });
  } else {
    /** Üretimin dosyasını API anahtarıyla indirir; içeriği ve türü döner. */
    const fetchFile = async (url) => {
      const r = await request(url, {
        headers: { authorization: `Bearer ${key}` },
        timeout: 120_000,
      });
      expect(r.status === 200, `dosya ${status(r)}`);
      const data = new Uint8Array(await r.arrayBuffer());
      expect(data.byteLength > 0, "dosya boş");
      return { data, type: r.headers.get("content-type") };
    };
    const describe = ({ data, type }) => `${type}, ${Math.round(data.byteLength / 1024)} KB`;
    const download = async (url) => describe(await fetchFile(url));
    /** Seslendirmenin sesi: sesten yazı adımında yeniden kullanılır. */
    let speech = null;

    await check("Seslendirme ve altyazı (~8 kredi)", async () => {
      if (!voiceId) throw new Skip("ses servisi kapalı");
      const r = await api("/tts", {
        method: "POST",
        body: JSON.stringify({ text: "Merhaba.", voice_id: voiceId }),
        timeout: 120_000,
      });
      await expectStatus(r, 201);
      const g = await r.json();
      speech = await fetchFile(g.files[0]);
      const file = describe(speech);
      if (g.subtitles) {
        const s = await request(g.subtitles.srt, { headers: { authorization: `Bearer ${key}` } });
        expect(s.status === 200, `altyazı ${status(s)}`);
      }
      return `${file}${g.subtitles ? ", altyazılı" : ", altyazı yok"}`;
    });

    await check("Sesten yazı (~1–2 kredi)", async () => {
      if (!speech) throw new Skip("seslendirme dosyası yok");
      const form = new FormData();
      form.append("file", new Blob([speech.data], { type: "audio/mpeg" }), "duman-testi.mp3");
      form.append("language", "tr");
      // Gövde FormData: içerik türünü (sınırıyla) fetch kendisi koyar.
      const r = await request("/api/v1/transcriptions", {
        method: "POST",
        body: form,
        headers: { authorization: `Bearer ${key}` },
        timeout: 120_000,
      });
      if (r.status === 503) throw new Skip("bu sunucuda kapalı (ElevenLabs ya da ffmpeg yok)");
      await expectStatus(r, 202);
      const { id } = await r.json();
      const until = Date.now() + 3 * 60_000;
      while (Date.now() < until) {
        await new Promise((res) => setTimeout(res, 3_000));
        const g = await (await api(`/generations/${id}`)).json();
        if (g.status === "failed") throw new Error("yazıya dökülemedi (kredi iade edildi)");
        if (g.status === "completed") {
          expect(g.transcript, "metin boş");
          return `"${g.transcript.slice(0, 40)}"${g.subtitles ? ", altyazılı" : ""}`;
        }
      }
      throw new Error("3 dakikada bitmedi");
    });

    await check("Görsel (1 kredi)", async () => {
      const r = await api("/images", {
        method: "POST",
        body: JSON.stringify({ prompt: "a red apple on a white table, studio light", count: 1 }),
        timeout: 180_000,
      });
      if (r.status === 503) throw new Skip("bu sunucuda kapalı (FAL_KEY yok)");
      await expectStatus(r, 201);
      return download((await r.json()).files[0]);
    });

    if (video) {
      await check("Video (15 kredi, birkaç dakika)", async () => {
        const r = await api("/videos", {
          method: "POST",
          body: JSON.stringify({
            prompt: "a paper boat floating on a calm lake",
            style: "cinematic",
          }),
        });
        if (r.status === 503) throw new Skip("bu sunucuda kapalı (FAL_KEY yok)");
        await expectStatus(r, 202);
        const { id } = await r.json();
        const until = Date.now() + 10 * 60_000;
        while (Date.now() < until) {
          await new Promise((res) => setTimeout(res, 15_000));
          const g = await (await api(`/generations/${id}`)).json();
          if (g.status === "failed") throw new Error("video üretilemedi (kredi iade edildi)");
          if (g.status === "completed") return download(g.files[0]);
        }
        throw new Error("10 dakikada bitmedi");
      });
    }
  }
}

console.log(`\n${results.ok} başarılı, ${results.fail} başarısız, ${results.skip} atlandı.`);
if (results.fail) {
  console.log("Ayrıntı için sunucuda: docker compose logs --tail 100 app");
  process.exit(1);
}
