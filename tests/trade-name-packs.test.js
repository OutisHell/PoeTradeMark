const { test } = require("node:test");
const assert = require("node:assert/strict");

for (const [game, region, unique, translatedUnique, type, translatedType] of [
  ["poe1", "tw", "Rigwald's Crest", "瑞佛之冠", "Two-Stone Ring", "雙玉戒指"],
  ["poe2", "tw", "Ab Aeterno", "源於永恆", "Grand Cuisses", "宏偉腿甲"],
  ["poe2", "th", "Ab Aeterno", "Ab Aeterno", "Ice Nova", "น้ำแข็งกระจาย"],
]) {
  test(`${game}/${region} names align with the shipped English rows`, () => {
    const english = require(`../extension/src/assets/trade-names/${game}/en.json`);
    const localized = require(`../extension/src/assets/trade-names/${game}/${region}.json`);
    for (const [field, source, target] of [["name", unique, translatedUnique], ["type", type, translatedType]]) {
      assert.equal(localized[field].length, english[field].length);
      assert.equal(localized[field][english[field].indexOf(source)], target);
      assert.ok(localized[field].filter(Boolean).length >= 0.99 * english[field].filter(Boolean).length);
      assert.ok(localized[field].every((value, i) => value === null ||
        (english[field][i] && typeof value === "string" && !value.includes("<size:"))));
    }
  });
}

test("PoB base aliases can recover the English item from either localized variant", () => {
  const taiwan = require("../extension/src/assets/pob-base-aliases/poe1/tw.json");
  assert.equal(taiwan.name["化為塵土"], "To Dust");
  assert.equal(taiwan.name["塵埃落定"], "To Dust");
  assert.equal(taiwan.type["黑牙魔符"], "Black Maw Talisman");
  assert.equal(taiwan.type["黯牙魔符"], "Black Maw Talisman");
  // The game uses this spelling for both Ylfe Ban and Scold's Bridle.
  assert.equal(Object.hasOwn(taiwan.name, "禁語"), false);

  const thai = require("../extension/src/assets/pob-base-aliases/poe2/th.json");
  assert.equal(thai.type["ปลดปล่อย"], "Unleash");
});
