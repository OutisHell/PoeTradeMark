const { test } = require("node:test");
const assert = require("node:assert/strict");
const { gzipSync, gunzipSync } = require("node:zlib");
const { readFile } = require("node:fs/promises");
require("../extension/src/common/url.js");
require("../extension/src/common/trade-region.js");
require("../extension/src/background/trade-search.js");

const original = "https://poe.kakaogames.com/trade/search/Covens/H4sIAAAAAAAACnWOvQ7CMAyEXwXdwpINBpSVN2BFFTIkIEv5qRrTUkV-dxRYwoAX332-k1xRhORZYCvyKJwTLGgmDnQNHmqQKHpYnPixUHDbsjnmGCk5mE-1wJ4rZB1b6IvvHMRP7TDo0NkKmcj5Swc6ycn5l3c_j-wcrQWqahC53P41wxzajpxgD3tt8wbsx-4U2AAAAA";
const unpack = (url) => JSON.parse(gunzipSync(Buffer.from(new URL(url).pathname.split("/").pop(), "base64url")));
const dict = async (game, region) => JSON.parse(await readFile(require.resolve("../extension/src/assets/trade-names/" + game + "/" + region + ".json")));

test("the Allflame share URL transfers before the destination app consumes q", async () => {
  const source = new URL("https://www.pathofexile.com/trade/search/Allflame?q=%7B%22query%22%3A%7B%22status%22%3A%7B%22option%22%3A%22available%22%7D%2C%22name%22%3A%22Rigwald%27s%20Command%22%2C%22stats%22%3A%5B%7B%22type%22%3A%22and%22%2C%22filters%22%3A%5B%5D%7D%5D%2C%22filters%22%3A%7B%22trade_filters%22%3A%7B%22filters%22%3A%7B%22indexed%22%3A%7B%22option%22%3A%223days%22%7D%7D%7D%2C%22misc_filters%22%3A%7B%22filters%22%3A%7B%22ilvl%22%3A%7B%22min%22%3A84%7D%7D%7D%7D%7D%2C%22sort%22%3A%7B%22price%22%3A%22asc%22%7D%7D");
  source.search += "&other=a%20b";
  source.hash = "#row";
  const target = new URL(await PTB.transferQuerySearch(source.href, "kr", dict));
  const payload = JSON.parse(source.searchParams.get("q"));
  assert.deepEqual(payload.query, unpack(original));
  payload.query.name = "리그월드의 명령";
  assert.deepEqual(JSON.parse(target.searchParams.get("q")), payload);
  assert.equal(target.hostname, "poe.kakaogames.com");
  assert.equal(target.pathname, "/trade/search/Allflame");
  assert.ok(target.search.includes("other=a%20b"));
  assert.equal(target.hash, "#row");
});

test("reported Covens link translates its name and retains every filter and the region override", async () => {
  const url = await PTB.localizeTradeSearch(original + "?ptb_from=www.pathofexile.com&ptb_region_once=1#row", dict);
  assert.deepEqual(unpack(url), { ...unpack(original), name: "리그월드의 명령" });
  assert.equal(new URL(url).search + new URL(url).hash, "?ptb_region_once=1#row");
  assert.equal(await PTB.localizeTradeSearch(url, dict), null);
});

test("the reported Stampede link converts both fields across regions and round-trips every filter", async () => {
  const kr = "https://poe.kakaogames.com/trade/search/Covens/H4sIAAAAAAAACjWOQQrCMAAEvyJ7DqLUFpuvSJHYpBBI09KkRSm5SMGjHirowd78gb8y_kFa8bjszjItjGW2NqAtitLKQoPCiLSu2E4JOALNcgEKf-re5w4E9lBO-dr748sPF_-4zfzw_Nx7kOnMgG7a_4xpDoJMKiuqXyE5KMS-VDKVdj4C2yBehdE6DKIYBA1TtRh1cqlBl-HCEXBpRh0OmjFlhEtc4r5gx1IuugAAAA";
  for (const [region, [host]] of Object.entries(PTB.tradeRegion.regions)) {
    if (region === "kr") continue;
    const href = PTB.tradeRegion.tradeUrl(kr, region, true);
    const translated = await PTB.localizeTradeSearch(href, dict);
    const query = unpack(translated);
    assert.equal(new URL(translated).hostname, host);
    assert.deepEqual({ ...query, name: "쇄도", type: "암살자의 장화" }, unpack(kr));
    if (region === "en") assert.deepEqual([query.name, query.type], ["The Stampede", "Assassin's Boots"]);
    const back = PTB.tradeRegion.tradeUrl(PTB.tradeRegion.stripOverride(translated), "kr", true);
    assert.deepEqual(unpack(await PTB.localizeTradeSearch(back, dict)), unpack(kr));
  }
});

test("PoE2 base types retain discriminators and unknown or invalid queries are left intact", async () => {
  const base = "https://poe.kakaogames.com/trade2/search/poe2/Standard/";
  const encode = (query) => base + gzipSync(JSON.stringify(query)).toString("base64url") + "?ptb_from=www.pathofexile.com";
  const query = { type: { option: "foo base", discriminator: "special" }, stats: [] };
  const names = async (game, region) => { assert.equal(game, "poe2"); return { name: [], type: [region === "en" ? "foo base" : "기본형"] }; };
  const translated = await PTB.localizeTradeSearch(encode(query), names);
  assert.deepEqual(unpack(translated), { ...query, type: { ...query.type, option: "기본형" } });
  await assert.rejects(PTB.localizeTradeSearch(encode({ ...query, name: "unknown" }), names));
  for (const url of [base + "short123", base + "H4sIAAA?ptb_from=www.pathofexile.com", original.replace("poe.kakaogames.com", "www.pathofexile.com")]) {
    assert.equal(await PTB.localizeTradeSearch(url, names), null);
  }
});
