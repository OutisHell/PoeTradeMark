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

test("bookmark jumps use the preferred site but bypass automatic league and trade mode settings", async () => {
  const bookmark = { ...PTB.parseTradeUrl(source.replace("/live", "")), id: "saved" };
  const original = PTB.buildTradeUrl(bookmark);
  const script = require("node:fs").readFileSync(require.resolve("../extension/src/region/query.js"), "utf8");
  for (const [code, enabled, expectedHost] of [
    ["kr", true, "poe.kakaogames.com"], ["de", false, "de.pathofexile.com"], ["", true, bookmark.host],
  ]) {
    let visit, guard, destination;
    const chrome = {
      runtime: { sendMessage: async () => ({ settings: { code, enabled, profiles: { poe1: { league: "Standard", status: "any" } } } }) },
      tabs: { getCurrent: async () => ({ id: 17 }) },
      storage: { local: { get: async () => ({ bookmarks: [bookmark] }) },
        session: { set: async values => { visit = values["ptbVisit:17"]; } } },
      declarativeNetRequest: { updateSessionRules: async rules => { [guard] = rules.addRules; } },
    };
    const location = { search: "?bookmark=saved", replace: href => { destination = new URL(href); } };
    await require("node:vm").runInNewContext(script, { location, chrome, PTB, URL, URLSearchParams, crypto });
    assert.equal(destination.host, expectedHost);
    assert.equal(destination.pathname, new URL(original).pathname);
    assert.equal(destination.hash, "#ptb-visit=" + visit.token);
    destination.hash = "";
    assert.equal(visit.destination, destination.href);
    assert.equal(visit.href, original);
    assert.ok(new RegExp(guard.condition.regexFilter).test(destination.href));
    assert.deepEqual([...guard.condition.tabIds], [17]);
  }
});

test("the preferred-site link applies the saved search profile even with automatic redirection off", async () => {
  const settings = { code: "kr", enabled: false, profiles: { poe1: { league: "Standard", status: "any" } } };
  const chrome = { runtime: {
    getURL: (path) => "chrome-extension://test/" + path,
    sendMessage: async () => ({ settings }),
  } };
  global.chrome = chrome;
  const href = await PTB.preferredTradeUrl(source, settings);
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

test("the manual preference link compares only configured fields for the current game", async () => {
  global.chrome = { runtime: { getURL: path => "chrome-extension://test/" + path } };
  const link = (profile, code = "", href = source, catalog = leagues) =>
    PTB.preferredTradeUrl(href, { code, profiles: { poe1: profile } }, catalog);
  assert.equal(await link({}), null);
  assert.equal(await link({ league: "Old", status: "securable" }, "en"), null);
  assert.match(await link({ league: "Standard" }), /\?preferred=source&/);
  assert.match(await link({ status: "any" }, "en"), /\?preferred=en&/);
  assert.match(await link({}, "kr"), /poe\.kakaogames\.com/);
  const json = origin + "/trade/search/Old?q=" + encodeURIComponent(JSON.stringify(data));
  assert.equal(await link({ status: "securable" }, "", json), null);
  assert.match(await link({ status: "online" }, "", json), /\?preferred=source&/);
  assert.equal(await link({ league: "@latest" }, "", source, async () => ({ latest: "Old" })), null);
  assert.match(await link({ league: "@latest" }), /\?preferred=source&/);
  assert.equal(await link({ status: "any" }, "", origin + "/trade/search/Old/opaque"), null);
  assert.equal(await link({ league: "Standard" }, "", origin + "/trade2/search/poe2/Old/" + token), null);
  const exchange = origin + "/trade/exchange/Old/" + token;
  assert.match(await link({ league: "Standard" }, "", exchange), /\?preferred=source&/);
  const moved = new URL(await PTB.profileTradeUrl(exchange, "", { league: "Standard" }));
  assert.equal(moved.pathname, "/trade/exchange/Standard/" + token);
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
