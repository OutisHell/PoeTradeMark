// PoE 거래소 URL 파싱/생성 — globalThis.PTB 공유 네임스페이스 (빌드툴 없음, 클래식 스크립트)
globalThis.PTB = globalThis.PTB || {};

// host → realm 코드. PoE 거래소는 언어만 다른 동일 사이트.
// 한국만 poe.kakaogames.com, 대만은 pathofexile.tw, 나머지는 {lang}.pathofexile.com (영문은 www).
PTB.HOST_REALMS = [
  { re: /kakaogames/, realm: "kr" },
  { re: /pathofexile\.tw$/, realm: "tw" },
  { re: /^jp\./, realm: "jp" },
  { re: /^es\./, realm: "es" },
  { re: /^fr\./, realm: "fr" },
  { re: /^de\./, realm: "de" },
  { re: /^th\./, realm: "th" },
  { re: /^ru\./, realm: "ru" },
  { re: /^br\./, realm: "br" },
];
PTB.hostToRealm = function (host) {
  host = String(host || "");
  for (var i = 0; i < PTB.HOST_REALMS.length; i += 1) {
    if (PTB.HOST_REALMS[i].re.test(host)) return PTB.HOST_REALMS[i].realm;
  }
  return "en"; // www.pathofexile.com 등 = 영문(영국)
};

// realm → 표시용 국가 약자
PTB.REALM_LABEL = {
  kr: "KR", en: "EN", jp: "JP", es: "ES", fr: "FR", de: "DE", th: "TH", ru: "RU", br: "BR", tw: "TW",
  global: "EN", // 레거시(이전 버전 즐겨찾기)
};
PTB.realmLabel = function (realm) {
  return PTB.REALM_LABEL[realm] || String(realm || "").toUpperCase();
};

// URL 경로 조각 디코딩. 이미 디코딩된 값("Forbidden Rites")은 그대로.
PTB.decodePathPart = function (value) {
  const raw = String(value || "");
  try {
    return decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    return raw;
  }
};

// 공식 거래소에서만 현재 게임을 정한다. 다른 사이트의 /trade는 백업 범위를 정할 수 없다.
PTB.gameFromUrl = function (href) {
  try {
    const { protocol, hostname, pathname: path } = new URL(href);
    if (!["https:", "http:"].includes(protocol) ||
        !(hostname === "poe.kakaogames.com" || /(^|\.)pathofexile\.(com|tw)$/.test(hostname))) return null;
    if (path === "/trade2" || path.indexOf("/trade2/") === 0) return "poe2";
    if (path === "/trade" || path.indexOf("/trade/") === 0) return "poe1";
    return null;
  } catch {
    return null;
  }
};

// PoE 1: https://{host}/trade/(search|exchange)/{league}/{searchId}
// PoE 2: https://{host}/trade2/(search|exchange)/poe2/{league}/{searchId}
// → {host,realm,game,type,league,searchId} | null
PTB.parseTradeUrl = function (href) {
  try {
    const url = new URL(href);
    const m =
      url.pathname.match(/^\/trade\/(search|exchange)\/([^/]+)\/([^/]+)\/?$/) ||
      url.pathname.match(/^\/trade2\/(search|exchange)\/poe2\/([^/]+)\/([^/]+)\/?$/);
    const game = PTB.gameFromUrl(href);
    if (!m || !game) return null;
    return {
      host: url.host,
      realm: PTB.hostToRealm(url.host),
      game,
      type: m[1],
      league: PTB.decodePathPart(m[2]),
      searchId: m[3],
    };
  } catch {
    return null;
  }
};

PTB.buildTradeUrl = function ({ host, game, type, league, searchId }) {
  const path = game === "poe2" ? `trade2/${type}/poe2` : `trade/${type}`;
  const leagueSeg = encodeURIComponent(PTB.decodePathPart(league));
  return `https://${host}/${path}/${leagueSeg}/${searchId}`;
};

PTB.unpackTradeQuery = async function (token) {
  const binary = atob(decodeURIComponent(token).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 1024 * 1024) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return JSON.parse(await new Blob(chunks).text());
};
