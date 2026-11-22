const { test } = require("node:test");
const assert = require("node:assert/strict");
const { gzipSync, gunzipSync } = require("node:zlib");
require("../extension/src/common/url.js");
require("../extension/src/common/trade-region.js");
require("../extension/src/background/trade-search.js");
require("../extension/src/background/trade-leagues.js");
const origin = "https://www.pathofexile.com";
const data = { query: { status: { option: "securable" }, stats: [{ type: "and", filters: [] }] }, sort: { price: "desc" } };
const token = gzipSync(JSON.stringify(data.query)).toString("base64url");
const source = origin + "/trade/search/Old/" + token + "/live";
const noNames = () => { throw Error("unexpected dictionary read"); };
const leagues = async () => ({ latest: "New Season" });

test("a snapshot stores only the source region, game's league and trade status", async () => {
  assert.deepEqual(await PTB.tradeSnapshot(source), { code: "en", profile: { game: "poe1", league: "Old", status: "securable" } });
  await assert.rejects(PTB.tradeSnapshot(origin + "/trade/search/Old/abc"));
});

test("the preferred-site link applies the saved search profile even with automatic redirection off", async () => {
  const settings = { code: "kr", enabled: false, profiles: { poe1: { league: "Standard", status: "any" } } };
  const chrome = { runtime: {
    getURL: (path) => "chrome-extension://test/" + path,
    sendMessage: async () => ({ settings }),
  } };
  global.chrome = chrome;
  const href = PTB.tradeRegion.preferredUrl(source, settings);
  const location = new URL(href);
  let destination;
  location.replace = (value) => { destination = new URL(value); };
  const script = require("node:fs").readFileSync(require.resolve("../extension/src/region/query.js"), "utf8");
  await require("node:vm").runInNewContext(script, { location, chrome, PTB, URL });
  assert.equal(destination.hostname, "poe.kakaogames.com");
  assert.match(destination.pathname, /^\/trade\/search\/Standard\/[^/]+\/live$/);
  const query = JSON.parse(gunzipSync(Buffer.from(destination.pathname.split("/").at(-2), "base64url")));
  assert.deepEqual(query, { ...data.query, status: { option: "any" } });
});

test("profile redirects preserve filters, sort, live mode, hash and independent game routes", async () => {
  const profile = { league: "@latest", status: "onlineleague" };
  const changed = new URL(await PTB.profileTradeUrl(source + "?x=2#row", "kr", profile, noNames, leagues));
  assert.equal(changed.hostname, "poe.kakaogames.com");
  assert.ok(changed.pathname.startsWith("/trade/search/New%20Season/") && changed.pathname.endsWith("/live"));
  const query = JSON.parse(gunzipSync(Buffer.from(changed.pathname.split("/").at(-2), "base64url")));
  assert.deepEqual(query, { ...data.query, status: { option: "onlineleague" } });
  assert.equal(changed.hash, "#row");
  const shared = origin + "/trade2/search/poe2/Standard?q=" + encodeURIComponent(JSON.stringify(data));
  const q = new URL(await PTB.profileTradeUrl(shared, "en", { league: "Hardcore", status: "any" }, noNames, leagues));
  assert.equal(q.pathname, "/trade2/search/poe2/Hardcore");
  assert.deepEqual(JSON.parse(q.searchParams.get("q")), { ...data, query: { ...data.query, status: { option: "any" } } });
});

test("season rollover refreshes the game catalog, retaining a cached list when offline", async (t) => {
  const saved = {};
  t.mock.method(global, "fetch", async (href) => {
    if (offline) throw Error("offline");
    const realm = href.includes("/trade2/") ? "poe2" : "pc";
    return Response.json({ result: [
      { realm: "xbox", id: "Console season" }, { realm, id: "Hardcore" }, { realm, id: season, text: season },
    ] });
  });
  global.chrome = { storage: { local: {
    get: async () => saved,
    set: async (values) => Object.assign(saved, values),
  } } };
  let season = "First", offline = false;
  const [a, b] = await Promise.all([PTB.tradeLeagues("poe1"), PTB.tradeLeagues("poe1")]);
  assert.deepEqual(a, b);
  assert.equal(a.latest, "First");
  assert.deepEqual(a.leagues.map((entry) => entry.id), ["Hardcore", "First"]);
  assert.equal(fetch.mock.callCount(), 1);
  season = "Next";
  assert.equal((await PTB.tradeLeagues("poe1")).latest, "First");
  assert.equal((await PTB.tradeLeagues("poe2")).latest, "Next");
  const [, refreshed] = await Promise.all([PTB.tradeLeagues("poe1"), PTB.tradeLeagues("poe1", true)]);
  assert.equal(refreshed.latest, "Next");
  season = "Third";
  saved["ptbTradeLeagues-poe1"].at -= 3600001;
  assert.equal((await PTB.tradeLeagues("poe1")).latest, "Third");
  saved["ptbTradeLeagues-poe1"].at -= 3600001;
  offline = true;
  assert.equal((await PTB.tradeLeagues("poe1")).latest, "Third");
  await assert.rejects(PTB.tradeLeagues("poe1", true), /offline/);
});
