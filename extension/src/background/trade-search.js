// A long trade ID can be a gzip-compressed query with locale-specific item text.
// Short server IDs are opaque and need no rewriting.
const tradeNamePacks = new Map();
async function loadTradeNames(game, region) {
  const key = game + "/" + region;
  if (!tradeNamePacks.has(key)) {
    const resource = chrome.runtime.getURL("src/assets/trade-names/" + key + ".json");
    const result = fetch(resource).then((response) => {
      if (!response.ok) throw new Error("Trade name catalog unavailable");
      return response.json();
    }).catch((error) => {
      tradeNamePacks.delete(key);
      throw error;
    });
    tradeNamePacks.set(key, result);
  }
  return tradeNamePacks.get(key);
}

async function packSearch(query) {
  const stream = new Blob([JSON.stringify(query)]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const regionOf = (host) => host === "pathofexile.com" ? "en" :
  Object.keys(PTB.tradeRegion.regions).find((key) => PTB.tradeRegion.regions[key][0] === host);

// Older opaque links expose only the selected display text. Use the shipped name
// catalog to recognize a whole unique name, optionally followed by a whole base type.
PTB.namedTradeSelection = async function (href, title, namesFor = loadTradeNames) {
  const info = PTB.parseTradeUrl(href);
  if (!info || info.type !== "search" || !title) return false;
  const region = regionOf(info.host);
  if (!region || (info.game === "poe2" && region === "th")) return false;
  const { name, type } = await namesFor(info.game, region);
  if (type.includes(title)) return false;
  return name.includes(title) || name.some(n => n && title.startsWith(n + " ") && type.includes(title.slice(n.length + 1)));
};

async function translateItemFields(query, game, from, to, namesFor) {
  const fields = ["name", "type"].filter((key) => {
    const value = query[key]?.option ?? query[key];
    return typeof value === "string" && value.length;
  });
  if (!fields.length || from === to) return false;
  const [source, destination] = await Promise.all([namesFor(game, from), namesFor(game, to)]);
  let changed = false;
  for (const field of fields) {
    const value = query[field]?.option ?? query[field];
    // Different base variants can share a name. All matches must agree before translating.
    const translations = new Set();
    const key = value.toLowerCase();
    source[field].forEach((name, index) => {
      if (name && name.toLowerCase() === key) translations.add(destination[field][index]);
    });
    if (!translations.size && destination[field].includes(value)) continue;
    const [translated] = translations;
    if (translations.size !== 1 || !translated) throw new Error("Unknown or ambiguous trade item");
    if (translated === value) continue;
    if (typeof query[field] === "string") query[field] = translated;
    else query[field].option = translated;
    changed = true;
  }
  return changed;
}

PTB.transferQuerySearch = async function (href, to, namesFor = loadTradeNames) {
  const source = new URL(href);
  const target = PTB.tradeRegion.tradeUrl(href, to);
  if (!target || !PTB.tradeRegion.isQuerySearch(source)) throw new Error("Invalid trade URL");
  const url = new URL(target);
  const payload = JSON.parse(source.searchParams.get("q"));
  if (!payload?.query || typeof payload.query !== "object" || Array.isArray(payload.query)) throw new Error("Invalid trade query");
  if (await translateItemFields(payload.query, PTB.gameFromUrl(href), regionOf(source.host), to, namesFor)) {
    // Only replace q. Preserve the exact encoding and order of unrelated parameters.
    const parts = url.search.slice(1).split("&");
    const index = parts.findIndex((part) => new URLSearchParams(part).has("q"));
    parts[index] = "q=" + encodeURIComponent(JSON.stringify(payload));
    url.search = parts.join("&");
  }
  url.search += "&ptb_region_once=1";
  return url.href;
};

function searchRoute(href) {
  const url = new URL(href);
  const code = regionOf(url.host);
  if (!code || !PTB.tradeRegion.tradeUrl(href, code)) throw Error("Unsupported trade site");
  const game = PTB.gameFromUrl(href);
  const root = game === "poe2" ? "/trade2" : "/trade";
  const base = root + (game === "poe2" ? "/search/poe2" : "/search");
  const path = url.pathname.replace(/\/$/, "");
  const parts = path.startsWith(base + "/") ? path.slice(base.length + 1).split("/") : [];
  if ((!parts.length && ![root, root + "/search", base].includes(path)) ||
      parts.length > 3 || (parts.length === 3 && parts[2] !== "live")) throw Error("Unsupported search route");
  return { url, code, game, base, league: PTB.decodePathPart(parts[0]), token: parts[1], live: parts[2] === "live" };
}

async function searchPayload(route) {
  let payload;
  if (route.token?.startsWith("H4sI")) payload = { query: await PTB.unpackTradeQuery(route.token) };
  else if (route.url.searchParams.has("q")) payload = JSON.parse(route.url.searchParams.get("q"));
  else return null;
  if (!payload?.query || typeof payload.query !== "object" || Array.isArray(payload.query)) throw Error("Invalid search");
  return payload;
}

PTB.tradeSnapshot = async function (href) {
  const route = searchRoute(href);
  const data = await searchPayload(route);
  const status = data?.query?.status?.option;
  if (!route.league || !PTB.tradeRegion.statuses.includes(status)) throw Error("Open a completed item search first");
  return { code: route.code, profile: { game: route.game, league: route.league, status } };
};

PTB.profileTradeUrl = async function (href, to, profile, namesFor = loadTradeNames, catalogFor = PTB.tradeLeagues) {
  const route = searchRoute(href);
  const url = to ? new URL(PTB.tradeRegion.tradeUrl(href, to)) : new URL(href);
  let league = profile.league || route.league;
  if (league === "@latest" || !league) {
    const catalog = await catalogFor(route.game);
    league = catalog.latest || route.league || catalog.leagues[0].id;
  }
  url.pathname = route.base + "/" + encodeURIComponent(league);
  const data = await searchPayload(route);
  if (!data && route.token && profile.status) {
    throw Object.assign(Error("Cannot change status in an opaque trade ID"), { code: "opaque-search" });
  }
  const query = data?.query || {};
  let changed = await translateItemFields(query, route.game, route.code, to || route.code, namesFor);
  if (profile.status && query.status?.option !== profile.status) {
    query.status = { ...query.status, option: profile.status };
    changed = true;
  }
  if (route.token) {
    const token = changed ? await packSearch(query) : route.token;
    url.pathname += "/" + token + (route.live ? "/live" : "");
  } else if (changed) {
    const value = "q=" + encodeURIComponent(JSON.stringify({ ...data, query }));
    const parts = url.search.slice(1).split("&").filter(Boolean);
    const index = parts.findIndex((part) => new URLSearchParams(part).has("q"));
    if (index < 0) parts.push(value);
    else parts[index] = value;
    url.search = parts.join("&");
  }
  url.search += (url.search ? "&" : "?") + "ptb_region_once=1";
  return url.href;
};

PTB.localizeTradeSearch = async function (href, namesFor = loadTradeNames) {
  const url = new URL(href);
  const from = regionOf(url.searchParams.get("ptb_from")), to = regionOf(url.host);
  if (url.protocol !== "https:" || !from || !to || from === to) return null;
  const match = url.pathname.match(/^(\/trade\/search\/[^/]+\/|\/trade2\/search\/poe2\/[^/]+\/)(H4sI[^/]{1,65536})(\/live)?\/?$/);
  if (!match) return null;
  let query;
  try { query = await PTB.unpackTradeQuery(match[2]); } catch { return null; }
  if (!query || typeof query !== "object") return null;
  if (!await translateItemFields(query, PTB.gameFromUrl(href), from, to, namesFor)) return null;
  const token = await packSearch(query);
  url.pathname = url.pathname.replace(match[2], token);
  url.search = url.search.slice(1).split("&").filter((part) => !part.startsWith("ptb_from=")).join("&");
  return url.href;
};
