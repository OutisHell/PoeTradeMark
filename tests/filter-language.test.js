const { test } = require("node:test");
const assert = require("node:assert/strict");
require("../extension/src/common/url.js");
require("../extension/src/common/storage.js");
require("../extension/src/common/bookmark-summary.js");

const token = "H4sIAAAAAAAACp2S3UrEMBBG3-W7DpLJTyebV5Eitc1CILalSUQpeXfpihdCldXrmTPnG2Z25DKUmuF3LGuJywyPHMa6Dc8poIlbPcM_7ijva4DHME8QuMZUwvZZiBM8wtua4hjLwwE8ac3EdJFkIDDFfEyb4K9DyqGJU4Qkkeu0vnxHylZD6w_mf8obf2603FnlpOruzqiZlTOOzjL-aatfJZotGy2tvFviiKXSnSL80KGkcWzYskLrxdcpx6XOBQKvQ6rheIGXOMNTa337AME6Dv0ZAgAA";
const packs = (game, lang) => require("../extension/src/assets/trade-filters/" + game + "/" + lang + ".json");
test("a saved Korean search renders its active stats in each chosen UI language", async () => {
  const mark = Object.freeze({ game: "poe1", type: "search", searchId: token, title: "My search", filters: [] });
  for (const lang of ["ko", "en", "ja", "de", "fr", "es", "pt", "ru", "th", "tw"]) {
    const pack = packs("poe1", lang);
    const result = await PTB.localizedBookmark(mark, lang, packs);
    assert.equal(result.title, mark.title);
    assert.equal(result.filters[0], pack.stats["explicit.stat_3371719014"]);
    assert.equal(result.filters.length, 2);
    assert.match(result.filters[1], /≥ 1/);
    assert.ok(result.filters[1].includes(pack.stats["explicit.stat_576528026"]));
    assert.doesNotMatch(result.filters.join(" "), /explicit\.stat_|^count/);
  }
});

test("opaque searches with a captured query localize filter names and options across games", async () => {
  for (const game of ["poe1", "poe2"]) {
    const mark = { game, type: "search", searchId: "abc", title: "Mine",
      filterQuery: { filters: { trade_filters: { filters: { indexed: { option: "3days" } } } } } };
    for (const lang of ["en", "ko"]) {
      const pack = packs(game, lang);
      const display = await PTB.localizedBookmark(mark, lang, packs);
      assert.deepEqual(display.filters, [pack.fields["trade_filters.indexed"] + ": " + pack.options["trade_filters.indexed"]["3days"]]);
    }
  }
});

test("each option in a count group keeps its own localized modifier badge", async () => {
  const mark = { game: "poe1", type: "search", searchId: "abc", title: "Options",
    filterQuery: { stats: [{ type: "count", value: { min: 1 }, filters: [
      { id: "explicit.stat_3299347043" }, { id: "implicit.stat_3299347043" }, { id: "crafted.stat_3299347043" },
    ] }] } };
  const [group] = (await PTB.localizedBookmark(mark, "ko", packs)).filterParts;
  assert.equal(group.label, "일치 개수 ≥ 1");
  assert.equal(group.entries.length, 3);
  assert.deepEqual(group.entries.filter(p => p.badge).map(p => p.badge.label), ["고정", "제작된"]);
});

test("a single default stat stays inline and compound groups have separate localized headings", () => {
  const a = { id: "explicit.stat_3299347043" }, b = { id: "crafted.stat_3299347043", value: { weight: 2 } };
  const stats = ["and", "and", "not", "if", "weight", "weight2"].map((type, i) => ({
    type, filters: i ? [a, b] : [a, { ...b, disabled: true }],
    ...(i >= 4 ? { value: { min: 0, max: 4 } } : {}),
  }));
  const { filterParts, title } = PTB.bookmarkSummary({ stats }, {}, null, null, packs("poe1", "ko"), "ko");
  assert.equal(filterParts[0].text, title);
  assert.deepEqual(filterParts.slice(1).map(group => group.label),
    ["및", "제외", "만약", "가중 합계 ≥ 0 · ≤ 4", "가중치 적용 합계 v2 ≥ 0 · ≤ 4"]);
  assert.match(filterParts.at(-1).entries[1].text, /× 2/);
});

test("only the first visible group uses the default stat filter heading and inline shortcut", () => {
  const a = { id: "a" }, b = { id: "b" };
  const group = (type, ...filters) => ({ type, filters });
  const parts = (stats, lang = "ko") => PTB.bookmarkSummary({ stats }, {}, null, null, null, lang).filterParts;
  const [first, later] = parts([group("and", a, b), group("and", b)]);
  assert.equal(first.label, "능력치 필터");
  assert.equal(first.entries.length, 2);
  assert.equal(later.label, "및");
  assert.equal(parts([group("not", a), group("and", b)])[1].label, "및");
  assert.equal(parts([{ ...group("not", a), disabled: true }, group("and", { ...a, disabled: true }), group("and", b)])[0].text, "b");
  assert.equal(parts([group("and", a, b)], "de")[0].label, "Filter: Eigenschaften");
});

test("filter-based titles keep their duplicate suffix, while custom and opaque legacy titles survive", async () => {
  const mark = { game: "poe1", type: "search", searchId: "abc", itemName: "",
    autoFilterTitle: "양손 근접 무기", title: "양손 근접 무기 (2)",
    filterQuery: { filters: { type_filters: { filters: { category: { option: "weapon.twomelee" } } } } } };
  assert.equal((await PTB.localizedBookmark(mark, "en", packs)).title, "Two-Handed Melee Weapon (2)");
  const renamed = { ...mark, autoFilterTitle: undefined, title: "My weapons" };
  assert.equal((await PTB.localizedBookmark(renamed, "ko", packs)).title, "My weapons");
  const legacy = { ...renamed, filterQuery: undefined, filters: ["Stored text"] };
  assert.deepEqual(await PTB.localizedBookmark(legacy, "en", packs), legacy);
});
