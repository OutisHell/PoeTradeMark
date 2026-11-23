const { test } = require("node:test");
const assert = require("node:assert/strict");
require("../extension/src/common/url.js");
require("../extension/src/common/trade-region.js");
const { tradeUrl, rules, stripOverride, regions } = PTB.tradeRegion;
global.chrome = { runtime: { getURL: (path) => "chrome-extension://test/" + path } };

test("manual region selection survives an unmarked follow-up request in its own tab", () => {
  for (const code of ["jp", "fr", "es", "en", "de"]) {
    const href = tradeUrl("https://poe.kakaogames.com/trade/search/Covens/id", code, true);
    const clean = stripOverride(href);
    const forced = rules("kr", { poe1: { league: "Standard" } });
    const hits = forced.filter(rule => new RegExp(rule.condition.regexFilter).test(clean));
    assert.equal(hits.sort((a, b) => b.priority - a.priority)[0].action.type, "redirect");
    const guard = PTB.tradeRegion.manualRule(55, href);
    assert.deepEqual(guard.condition.tabIds, [55]);
    assert.deepEqual(guard.condition.resourceTypes, ["main_frame"]);
    const match = new RegExp(guard.condition.regexFilter);
    assert.ok(match.test(clean) && !match.test(clean.replace(regions[code][0], regions.kr[0])));
    assert.ok(!match.test(clean.replace("/trade/", "/trade2/")));
    assert.ok(guard.priority > Math.max(...hits.map(r => r.priority)));
  }
});

test("JSON search links take the same pre-translation route on automatic and manual moves", () => {
  const redirects = rules("kr");
  const rule = redirects.find((r) => r.id === 9104);
  const re = new RegExp(rule.condition.regexFilter);
  for (const path of ["/trade/search/Allflame", "/trade2/search/poe2/Standard/"]) {
    const source = "https://www.pathofexile.com" + path + "?x=1&q=%7B%7D&x=2";
    assert.ok(re.test(source));
    assert.equal(rule.action.redirect.regexSubstitution.replace("\\0", source), tradeUrl(source, "kr", true));
    const once = source + "&ptb_region_once=1";
    const allow = redirects.find((r) => r.action.type === "allow");
    assert.ok(allow.priority > rule.priority && new RegExp(allow.condition.regexFilter).test(once));
    assert.ok(new RegExp(allow.condition.regexFilter).test(once + "#row"));
  }
  for (const url of ["https://www.pathofexile.com/trade/search/Standard/id?q=abc",
    "https://poe.kakaogames.com/trade/search/Standard?q=abc", "https://www.pathofexile.com/trade/search/Allflame?id=q=abc"]) {
    assert.ok(!re.test(url));
  }
});

test("manual and automatic compressed links retain the source language until conversion", () => {
  const original = "https://poe.kakaogames.com/trade/search/Covens/H4sIabc?q=a%20b#row";
  const manual = new URL(tradeUrl(original, "en", true));
  assert.equal(manual.searchParams.get("ptb_from"), "poe.kakaogames.com");
  const rule = rules("en").find((r) => r.id === 9103);
  const beforeHash = original.split("#")[0];
  const redirect = beforeHash.replace(new RegExp(rule.condition.regexFilter), rule.action.redirect.regexSubstitution.replace(/\\(\d)/g, "$$$1"));
  assert.equal(new URL(redirect).searchParams.get("ptb_from"), "poe.kakaogames.com");
  assert.equal(stripOverride(redirect + "#row"), stripOverride(manual.href));
});

test("international URLs preserve the entire route and encoded search", () => {
  for (const route of [
    "/trade", "/trade/", "/trade/exchange/Standard/abcdef",
    "/trade/search/HC%20Private%20%28PL1234%29/8aNb9/live?custom=1#row",
    "/trade2/search/poe2/%ED%95%9C%EA%B8%80/" + "H4sI" + "abcd".repeat(64),
    "/trade2/search/poe2/Standard?q=%7B%22x%22%3A%22a%20b%22%7D",
  ]) {
    assert.equal(tradeUrl("https://poe.kakaogames.com" + route, "fr"), "https://fr.pathofexile.com" + route);
    const [redirect] = rules("fr");
    assert.ok(new RegExp(redirect.condition.regexFilter).test("https://poe.kakaogames.com" + route));
  }
});

test("regional rules do not touch unrelated origins, account pages, APIs, or other realms", () => {
  for (const url of [
    "https://www.pathofexile.com/api/trade/search/Standard", "https://www.pathofexile.com/login",
    "https://www.pathofexile.com/trade2027", "https://www.pathofexile.com.evil.test/trade",
    "https://webcdn.pathofexile.com/trade", "https://pathofexile.tw/trade2", "http://www.pathofexile.com/trade",
    "https://name:pass@www.pathofexile.com/trade", "https://www.pathofexile.com:9443/trade",
  ]) {
    assert.equal(tradeUrl(url, "kr"), null);
    assert.ok(!new RegExp(rules("kr")[0].condition.regexFilter).test(url));
  }
  assert.deepEqual(rules("tw"), []);
  assert.deepEqual(rules(""), []);
});

test("explicit country wins once and the clean URL has the original query and hash", () => {
  const original = "https://de.pathofexile.com/trade2/search/poe2/Standard/id?q=a%20b#row";
  const manual = tradeUrl(original, "en", true);
  assert.ok(new RegExp(rules("kr")[1].condition.regexFilter).test(manual.split("#")[0]));
  assert.equal(stripOverride(manual), original.replace("de.pathofexile.com", "www.pathofexile.com"));
  for (const [code, [host]] of Object.entries(regions)) {
    assert.ok(!new RegExp(rules(code)[0].condition.regexFilter).test("https://" + host + "/trade2"));
  }
});
