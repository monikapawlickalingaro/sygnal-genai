/*
 * Sygnał — pobiera WYŁĄCZNIE realne treści na żywo:
 *  - newsy: prawdziwe kanały RSS znanych redakcji tech
 *  - memy: prawdziwe posty z Reddita
 * Nic tutaj nie jest generowane ani wymyślane — to strona jest jedynie
 * "oknem" na cudzą, realną treść, z linkiem do oryginału przy każdym elemencie.
 *
 * Publiczne API i CORS-proxy bywają zawodne/limitowane. Jeśli źródło
 * nie odpowie, pokazujemy komunikat o błędzie zamiast czegokolwiek zmyślać.
 */

const CORS_PROXY = "https://api.allorigins.win/raw?url=";

const NEWS_FEEDS = [
  { name: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  { name: "The Verge AI", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
  { name: "VentureBeat AI", url: "https://venturebeat.com/category/ai/feed/" },
  { name: "Ars Technica AI", url: "https://arstechnica.com/tag/ai/feed/" },
];

const MEME_SUBREDDITS = ["ProgrammerHumor", "singularity", "ChatGPT"];
const MAX_NEWS_PER_SOURCE = 8;
const MAX_MEMES_PER_SUB = 12;
const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i;

async function fetchViaProxy(targetUrl) {
  const res = await fetch(CORS_PROXY + encodeURIComponent(targetUrl));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

function relativeTime(date) {
  const diffMs = Date.now() - date.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "przed chwilą";
  if (mins < 60) return `${mins} min temu`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} godz. temu`;
  const days = Math.round(hrs / 24);
  return `${days} dni temu`;
}

function stripHtml(html) {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  return (doc.body.textContent || "").trim();
}

/* ---------- NEWS ---------- */

async function fetchFeed(source) {
  const res = await fetchViaProxy(source.url);
  const xmlText = await res.text();
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");

  if (doc.querySelector("parsererror")) throw new Error("Nieprawidłowy XML");

  const items = Array.from(doc.querySelectorAll("item")).slice(0, MAX_NEWS_PER_SOURCE);
  return items.map((item) => {
    const title = item.querySelector("title")?.textContent?.trim() || "(bez tytułu)";
    const link = item.querySelector("link")?.textContent?.trim() || "#";
    const pubDateRaw = item.querySelector("pubDate")?.textContent;
    const pubDate = pubDateRaw ? new Date(pubDateRaw) : new Date();
    const descRaw =
      item.querySelector("description")?.textContent ||
      item.getElementsByTagNameNS("*", "encoded")[0]?.textContent ||
      "";
    const dek = stripHtml(descRaw).slice(0, 160);
    return { title, link, pubDate, dek, source: source.name };
  });
}

async function loadNews() {
  const container = document.getElementById("newsList");
  const statusEl = document.getElementById("newsSourcesStatus");
  const results = await Promise.allSettled(NEWS_FEEDS.map(fetchFeed));

  let allItems = [];
  const failedSources = [];

  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      allItems = allItems.concat(r.value);
    } else {
      failedSources.push(NEWS_FEEDS[i].name);
    }
  });

  allItems.sort((a, b) => b.pubDate - a.pubDate);

  container.innerHTML = "";

  if (allItems.length === 0) {
    container.innerHTML = `<p class="error-note">Nie udało się pobrać żadnego źródła newsów w tej chwili. Spróbuj odświeżyć za chwilę.</p>`;
  } else {
    allItems.slice(0, 30).forEach((item) => {
      const a = document.createElement("a");
      a.className = "wire-item";
      a.href = item.link;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.innerHTML = `
        <div class="wire-item__meta">
          <span class="wire-item__source">${item.source}</span>
          <span>${relativeTime(item.pubDate)}</span>
        </div>
        <p class="wire-item__title">${item.title}</p>
        <p class="wire-item__dek">${item.dek}</p>
      `;
      container.appendChild(a);
    });
  }

  statusEl.textContent = NEWS_FEEDS.map((f) =>
    failedSources.includes(f.name) ? `${f.name} (niedostępne)` : f.name
  ).join(" · ");

  buildTicker(allItems.slice(0, 10));
  return allItems;
}

function buildTicker(items) {
  const track = document.getElementById("tickerTrack");
  track.innerHTML = "";
  if (items.length === 0) {
    track.innerHTML = `<span class="ticker__item">Brak danych na żywo — spróbuj odświeżyć.</span>`;
    return;
  }
  items.forEach((item) => {
    const span = document.createElement("span");
    span.className = "ticker__item";
    span.textContent = `${item.source}: ${item.title}`;
    track.appendChild(span);
  });
}

/* ---------- MEMES ---------- */

async function fetchSubredditMemes(sub) {
  const res = await fetchViaProxy(`https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`);
  const json = await res.json();
  const posts = json?.data?.children || [];

  return posts
    .map((p) => p.data)
    .filter((d) => !d.stickied && !d.over_18)
    .filter((d) => {
      const url = d.url_overridden_by_dest || d.url || "";
      return d.post_hint === "image" || IMAGE_EXT.test(url);
    })
    .slice(0, MAX_MEMES_PER_SUB)
    .map((d) => ({
      title: d.title,
      img: d.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, "&") || d.url,
      permalink: `https://www.reddit.com${d.permalink}`,
      subreddit: d.subreddit,
      score: d.score,
    }));
}

async function loadMemes() {
  const container = document.getElementById("memeGrid");
  const statusEl = document.getElementById("memeSourcesStatus");
  const results = await Promise.allSettled(MEME_SUBREDDITS.map(fetchSubredditMemes));

  let allMemes = [];
  const failedSubs = [];

  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      allMemes = allMemes.concat(r.value);
    } else {
      failedSubs.push(MEME_SUBREDDITS[i]);
    }
  });

  allMemes.sort((a, b) => b.score - a.score);

  container.innerHTML = "";

  if (allMemes.length === 0) {
    container.innerHTML = `<p class="error-note">Nie udało się pobrać memów w tej chwili. Spróbuj odświeżyć za chwilę.</p>`;
  } else {
    allMemes.slice(0, 20).forEach((meme) => {
      const a = document.createElement("a");
      a.className = "meme-card";
      a.href = meme.permalink;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.innerHTML = `
        <div class="meme-card__img-wrap">
          <span class="meme-card__tag">r/${meme.subreddit}</span>
          <img src="${meme.img}" alt="" loading="lazy">
        </div>
        <div class="meme-card__body">
          <p class="meme-card__title">${meme.title}</p>
          <p class="meme-card__meta">▲ ${meme.score}</p>
        </div>
      `;
      container.appendChild(a);
    });
  }

  statusEl.textContent = MEME_SUBREDDITS.map((s) =>
    failedSubs.includes(s) ? `r/${s} (niedostępne)` : `r/${s}`
  ).join(" · ");
}

/* ---------- orchestration ---------- */

async function loadAll() {
  const btn = document.getElementById("refreshBtn");
  btn.disabled = true;
  btn.textContent = "Odświeżanie…";
  document.getElementById("newsList").innerHTML = `<p class="loading">Pobieram depesze…</p>`;
  document.getElementById("memeGrid").innerHTML = `<p class="loading">Pobieram memy…</p>`;

  await Promise.allSettled([loadNews(), loadMemes()]);

  document.getElementById("lastUpdated").textContent =
    "Ostatnia aktualizacja: " + new Date().toLocaleTimeString("pl-PL");
  btn.disabled = false;
  btn.textContent = "Odśwież";
}

document.getElementById("refreshBtn").addEventListener("click", loadAll);
loadAll();
