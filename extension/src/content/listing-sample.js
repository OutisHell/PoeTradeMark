// Runs in the page world so the bookmark button can reuse the trade site's own
// result batches. Retain only the IDs and rarities needed to color a bookmark.
(() => {
  if (!/^\/trade2?(?:\/|$)/.test(location.pathname)) return;
  const searches = new Map();
  const items = new Map();
  const rarityByFrame = { 0: "normal", 1: "magic", 2: "rare", 3: "unique", 9: "uniquefoil" };

  function remember(map, key, value, limit) {
    map.delete(key);
    map.set(key, value);
    if (map.size > limit) map.delete(map.keys().next().value);
  }

  function tradeRoute(raw) {
    try {
      const url = new URL(raw, location.href);
      const match = /^\/api\/(trade2?)\/(search|fetch)\/.+/.exec(url.pathname);
      if (url.origin === location.origin && match) {
        const leaguePath = match[2] === "search" ? url.pathname.slice(4) : location.pathname;
        const league = /^\/trade2?\/search\/(?:poe2\/)?([^/]+)/.exec(leaguePath)?.[1];
        return { game: match[1], action: match[2], query: url.searchParams.get("query"), league: league && decodeURIComponent(league) };
      }
    } catch { /* Other page requests are irrelevant. */ }
  }

  function collect(route, data) {
    if (!Array.isArray(data?.result)) return;
    if (route.action === "search") {
      if (typeof data.id === "string") {
        remember(searches, route.game + ":" + data.id, {
          league: route.league,
          ids: new Set(data.result.filter(id => typeof id === "string").slice(0, 600)),
          total: Number.isSafeInteger(data.total) && !data.inexact ? data.total : null,
        }, 6);
      }
      return;
    }
    for (const entry of data.result) {
      const { id, item } = entry || {};
      if (!id || !item) continue;
      remember(items, route.game + ":" + id, {
        query: route.query, league: route.league,
        rarity: rarityByFrame[item.frameType] || String(item.rarity || "").toLowerCase(),
      }, 600);
    }
  }

  const fetchPage = window.fetch;
  window.fetch = function (input, ...args) {
    const promise = fetchPage.call(this, input, ...args);
    const route = tradeRoute(input?.url ?? input);
    if (route) promise.then(r => {
      if (r.ok) return r.clone().json().then(data => collect(route, data));
    }).catch(() => {});
    return promise;
  };

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const result = open.call(this, method, url, ...rest);
    if (tradeRoute(url)) this.addEventListener("loadend", function () {
      try {
        const route = tradeRoute(this.responseURL);
        if (route && this.status === 200) collect(route, this.responseType === "json" ? this.response : JSON.parse(this.responseText));
      } catch { /* A failed or unfamiliar response must not interrupt trade. */ }
    }, { once: true });
    return result;
  };

  document.addEventListener("ptb-read-listing-sample", ({ target }) => {
    if (!(target instanceof HTMLTemplateElement)) return;
    try {
      const { game, query, league, ids } = JSON.parse(target.dataset.request);
      if (!Array.isArray(ids) || !["trade", "trade2"].includes(game)) return;
      const prefix = game + ":";
      // A shared page URL and the API can encode the same search with different gzip IDs.
      // The content script checks the decoded query before using an alternate batch.
      let batch = query;
      if (!searches.has(prefix + query)) {
        const alternate = [...searches.entries()].reverse().find(([key, search]) =>
          key.startsWith(prefix) && search.league === league && ids.some(id => search.ids.has(id)));
        if (alternate) batch = alternate[0].slice(prefix.length);
        else {
          const visibleItem = ids.map(id => items.get(prefix + id)).find(item => item?.query && item.league === league);
          if (visibleItem) batch = visibleItem.query;
        }
      }
      const search = searches.get(prefix + batch);
      const rows = ids.slice(0, 600).map(id => {
        const item = items.get(game + ":" + id);
        if (!item || (item.query !== batch && !search?.ids.has(id))) return null;
        return item.rarity;
      });
      target.dataset.sample = JSON.stringify({ query: batch, rows, total: search?.total ?? null });
    } catch { /* Ignore unrelated events. */ }
  });
})();
