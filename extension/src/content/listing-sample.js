// Runs in the page world so the bookmark button can reuse the trade site's own
// result batches. Keep a bounded, tab-local snapshot for each completed search.
(() => {
  if (!/^\/trade2?(?:\/|$)/.test(location.pathname)) return;
  const searches = new Map();
  const items = new Map();
  const pobItems = new Map();
  const decoding = new Set();
  const landingPath = location.pathname;
  const landingQuery = /\/(?:search|exchange)\/(?:poe2\/)?[^/]+\/([\w-]+)\/?$/.exec(landingPath)?.[1];
  let landingBatch, landingAt, searchStarted = false, subsequentSearch = false;
  const rarityByFrame = { 0: "normal", 1: "magic", 2: "rare", 3: "unique", 9: "uniquefoil" };

  function remember(map, key, value, limit) {
    map.delete(key);
    map.set(key, value);
    if (map.size > limit) map.delete(map.keys().next().value);
  }

  function tradeRoute(raw) {
    try {
      const url = new URL(raw, location.href);
      const match = /^\/api\/(trade2?)\/(search|exchange|fetch)\/.+/.exec(url.pathname);
      if (url.origin === location.origin && match) {
        const leaguePath = match[2] !== "fetch" ? url.pathname.slice(4) : location.pathname;
        const league = /^\/trade2?\/(?:search|exchange)\/(?:poe2\/)?([^/]+)/.exec(leaguePath)?.[1];
        return { game: match[1], action: match[2], query: url.searchParams.get("query"), league: league && decodeURIComponent(league) };
      }
    } catch { /* Other page requests are irrelevant. */ }
  }

  function submittedSearch(route, body) {
    // A direct visit can fetch the server-rendered result IDs without issuing
    // a search POST. Bind only its first opaque batch to this document's URL.
    if (route && route.action !== "fetch") {
      subsequentSearch = searchStarted || !!landingBatch;
      searchStarted = true;
    }
    if (route?.action === "fetch" && !searchStarted && landingQuery && location.pathname === landingPath &&
        route.query && (route.query === landingQuery || (landingQuery.startsWith("H4sI") && !route.query.startsWith("H4sI")))) {
      landingBatch ??= route.query;
    }
    if (route?.action !== "search" || typeof body !== "string" || body.length > 1024 * 1024) return;
    try {
      const { query } = JSON.parse(body);
      if (!query || typeof query !== "object") return;
      const bridge = document.createElement("template");
      document.documentElement.appendChild(bridge);
      try {
        bridge.dispatchEvent(new Event("ptb-read-search-labels", { bubbles: true }));
        const form = JSON.parse(bridge.dataset.labels || "null");
        const labels = form?.labels || {};
        const stats = (query.stats || []).flatMap(group => group.filters || []);
        if (form?.statNames?.length === stats.length) {
          stats.forEach((stat, index) => { if (stat?.id) labels[stat.id] ??= form.statNames[index]; });
        }
        return { query, labels };
      } finally { bridge.remove(); }
    } catch { /* The trade request must proceed even if its format is unfamiliar. */ }
  }

  const rowSnapshots = new WeakMap();
  function pobListing(item) {
    const nativeText = item.extended?.text;
    if (nativeText && (typeof nativeText !== "string" || nativeText.length > 131072)) return;
    if (nativeText && ["www.pathofexile.com", "pathofexile.com"].includes(location.hostname)) return { nativeText };
    const rarity = ["Normal", "Magic", "Rare", "Unique", "Gem", "Currency", "Divination Card", "Quest", "Prophecy", "Relic"][item.frameType] || item.rarity;
    const baseType = item.baseType || item.typeLine;
    if (!baseType || !rarity) return;
    const mods = [], affixNames = new Set();
    for (const key of Object.keys(item)) {
      if (!key.endsWith("Mods") || !Array.isArray(item[key])) continue;
      const kind = key.slice(0, -4);
      const ids = (item.extended?.hashes?.[kind] || []).map(h => Array.isArray(h) ? h[0] : h);
      for (const mod of item[key]) {
        const description = typeof mod === "string" ? mod : mod?.description;
        if (!description || description.length > 4096 || mods.length >= 128) return;
        mods.push({ description, hash: mod.hash, kind: mod.domain || kind, ids: mod.hash ? undefined : ids });
        if (kind === "explicit" && rarity === "Magic") {
          for (const affix of mod.mods || []) if (affix.name) affixNames.add(affix.name);
        }
      }
    }
    const requirements = item.requirements || [];
    const simple = !nativeText && rarity === "Unique" && item.identified !== false && !item.mirrored &&
      !item.duplicated && !item.synthesised && !item.split && !item.fractured && !item.talismanTier &&
      !item.influences && !item.sockets?.length && !item.properties?.length && !item.additionalProperties?.length &&
      requirements.length <= 1 && requirements.every(r => r.type === 62) &&
      mods.every(m => m.kind === "implicit" || m.kind === "explicit");
    if (!nativeText && !simple) return;
    return { nativeText, rarity, baseType, typeLine: item.typeLine, name: item.name, flavour: item.flavourText,
      ilvl: item.ilvl, mods, affixNames: [...affixNames], properties: item.properties, requirements,
      additionalProperties: item.additionalProperties, sockets: item.sockets, corrupted: item.corrupted, simple };
  }

  function bindPobRows() {
    const route = /^\/(trade2?)\/search\/(?:poe2\/)?([^/]+)/.exec(location.pathname);
    if (!route || !pobItems.size) return;
    const prefix = route[1] + ":" + decodeURIComponent(route[2]) + ":";
    for (const row of document.querySelectorAll(".row[data-id]")) {
      const key = prefix + row.dataset.id;
      if (pobItems.has(key)) rowSnapshots.set(row, { key, item: pobItems.get(key) });
    }
  }

  function collect(route, data, submitted) {
    if (!data?.result || typeof data.result !== "object") return;
    const results = Array.isArray(data.result) ? data.result : Object.values(data.result);
    const at = Date.now();
    const prefix = route.game + ":" + route.league + ":";
    const batch = route.action === "fetch" ? route.query : data.id;
    if (route.action === "fetch" && landingBatch && batch === landingBatch && !searchStarted) landingAt ??= at;
    if (route.action !== "fetch") {
      if (typeof data.id === "string") {
        remember(searches, prefix + data.id, {
          submitted, at,
          league: route.league,
          ids: new Set(results.slice(0, 600).map(row => typeof row === "string" ? row : row?.id).filter(Boolean)),
          total: Number.isSafeInteger(data.total) && !data.inexact ? data.total : null,
        }, 6);
      }
    }
    for (const entry of results) {
      const { id, item } = entry || {};
      if (!id || !item) continue;
      const snapshot = pobListing(item);
      if (snapshot) remember(pobItems, prefix + id, snapshot, 128);
      else pobItems.delete(prefix + id);
      const price = entry.listing?.price;
      remember(items, prefix + id, {
        query: batch, league: route.league, at,
        price: price?.amount > 0 && Number.isFinite(price.amount) && typeof price.currency === "string" && price.currency
          ? { amount: price.amount, currency: price.currency } : null,
        rarity: rarityByFrame[item.frameType] || String(item.rarity || "").toLowerCase(),
      }, 600);
    }
  }

  const fetchPage = window.fetch;
  window.fetch = function (input, ...args) {
    const promise = fetchPage.call(this, input, ...args);
    const route = tradeRoute(input?.url ?? input);
    const submitted = submittedSearch(route, args[0]?.body);
    if (route) promise.then(async r => {
      if (!r.ok) return;
      const read = r.clone().json();
      decoding.add(read);
      try { collect(route, await read, submitted); }
      finally {
        decoding.delete(read);
        if (!decoding.size) document.dispatchEvent(new Event("ptb-listings-ready"));
      }
    }).catch(() => {});
    return promise;
  };

  const open = XMLHttpRequest.prototype.open;
  const requests = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const result = open.call(this, method, url, ...rest);
    const route = tradeRoute(url);
    requests.delete(this);
    if (route) requests.set(this, route);
    return result;
  };
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    const route = requests.get(this);
    const submitted = submittedSearch(route, body);
    if (route) this.addEventListener("loadend", function () {
      try {
        if (this.status === 200) {
          collect(route, this.responseType === "json" ? this.response : JSON.parse(this.responseText), submitted);
          document.dispatchEvent(new Event("ptb-listings-ready"));
        }
      } catch { /* A failed or unfamiliar response must not interrupt trade. */ }
    }, { once: true });
    return send.apply(this, arguments);
  };

  document.addEventListener("ptb-bind-pob-rows", bindPobRows);
  document.addEventListener("ptb-read-pob-item", ({ target }) => {
    if (!(target instanceof HTMLTemplateElement)) return;
    try {
      const { game, league, id } = JSON.parse(target.dataset.request);
      const key = game + ":" + league + ":" + id;
      const bound = rowSnapshots.get(target.closest?.(".row[data-id]"));
      target.dataset.result = JSON.stringify(pobItems.get(key) || (bound?.key === key ? bound.item : null));
    } catch { /* Ignore unrelated events. */ }
  });

  document.addEventListener("ptb-read-listing-sample", ({ target }) => {
    if (!(target instanceof HTMLTemplateElement)) return;
    try {
      const { game, query, league, ids, details } = JSON.parse(target.dataset.request);
      if (!Array.isArray(ids) || !["trade", "trade2"].includes(game)) return;
      const prefix = game + ":" + league + ":";
      // A shared page URL and the API can encode the same search with different gzip IDs.
      // The content script checks the decoded query before using an alternate batch.
      let batch = query;
      if (!searches.has(prefix + query)) {
        const alternate = [...searches.entries()].reverse().find(([key, search]) =>
          key.startsWith(prefix) && search.league === league &&
          (ids.some(id => search.ids.has(id)) || (!ids.length && search.total === 0)));
        if (alternate) batch = alternate[0].slice(prefix.length);
        else {
          const visibleItem = ids.map(id => items.get(prefix + id)).find(item => item?.query && item.league === league);
          if (visibleItem) batch = visibleItem.query;
        }
      }
      const search = searches.get(prefix + batch);
      const matched = ids.map(id => search?.ids.has(id) || items.get(prefix + id)?.query === batch);
      const rows = ids.map((id, i) => matched[i] ? items.get(prefix + id)?.rarity ?? null : null);
      let observedAt = search?.at;
      const prices = ids.map((id, i) => {
        const item = items.get(prefix + id);
        if (!matched[i] || !item || (item.query && item.query !== batch)) return null;
        observedAt = Math.max(observedAt || 0, item.at);
        return item.price;
      });
      const landing = !searchStarted && location.pathname === landingPath && batch === landingBatch && matched.includes(true);
      target.dataset.sample = JSON.stringify({ query: batch, landingQuery: landing ? landingQuery : undefined,
        searchAt: details ? search?.at ?? (landing ? landingAt : undefined) : undefined,
        firstResult: !subsequentSearch && (!!search || landing),
        rows, prices, observedAt, matched, known: !!search || matched.includes(true), decoding: decoding.size > 0,
        total: search?.total ?? null, submitted: details || batch !== query ? search?.submitted : undefined });
    } catch { /* Ignore unrelated events. */ }
  });
})();
