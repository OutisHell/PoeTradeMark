const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "../extension");
function worker() {
  const PTB = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, "src/background/pob-fields.js"), "utf8"), {
    PTB, chrome: { runtime: { getURL: file => path.join(root, file) } },
    fetch: async file => Response.json(JSON.parse(fs.readFileSync(file, "utf8"))),
  });
  return PTB;
}

test("both games translate item level from their own client strings in each region", async () => {
  const PTB = worker();
  const labels = { en: "Item Level", kr: "아이템 레벨", fr: "Niveau de l'objet", de: "Gegenstandsstufe",
    ru: "Уровень предмета", jp: "アイテムレベル", th: "เลเวลไอเทม", tw: "物品等級",
    es: "Nivel de objeto", br: "Nível do Item" };
  for (const game of ["poe1", "poe2"]) {
    for (const [region, label] of Object.entries(labels)) {
      const field = await PTB.pobFields(region, game);
      assert.equal(field(label + ": 86", {}), "Item Level: 86", game + "/" + region);
    }
  }
});

test("raw fields preserve socket groups, stat rolls, range units and all item states", async () => {
  const fields = await worker().pobFields("kr", "poe1");
  for (const [line, english] of [
    ["홈: B-W A DV", "Sockets: B-W A DV"], ["힘: 113", "Str: 113"],
    ["요구사항:", "Requirements:"], ["무기 범위: 1.3미터", "Weapon Range: 1.3 metres"],
    ["물리 피해: 367-776 (augmented)", "Physical Damage: 367-776 (augmented)"],
    ["분열된 아이템", "Fractured Item"], ["메모: call my character", ""],
    ["미지의 필드: 17", null], ["물리 피해: some text", null],
  ]) assert.equal(fields(line, {}), english, line);
});

test("field templates reorder flask values by parameter ID and normalize decimal separators", async () => {
  const PTB = worker();
  assert.equal((await PTB.pobFields("jp", "poe1"))("4秒間で1500ライフ回復", {}), "Recovers 1500 Life over 4 Seconds");
  const fields = await PTB.pobFields("fr", "poe1");
  assert.equal(fields("Allonge : 1,3 mètres", {}), "Weapon Range: 1.3 metres");
  assert.equal(fields("Armure : 1 234 (augmented)", {}), "Armour: 1234 (augmented)");
});

test("typed API properties handle trade-specific labels without depending on the page language", async () => {
  const fields = await worker().pobFields("kr", "poe1");
  const item = { requirements: [{ type: 63, name: "힘 요구치", values: [["133", 0]] }] };
  assert.equal(fields("힘 요구치: 133", item), "Str: 133");
  assert.equal(fields("힘 요구치: 134", item), null);
});

test("catalyst quality, jewel limits, combined requirements and granted skills keep their mechanics", async () => {
  const PTB = worker();
  assert.equal((await PTB.pobFields("kr", "poe1"))("퀄리티 (공격 속성 부여): +20% (augmented)", {}),
    "Quality (Attack Modifiers): +20% (augmented)");
  assert.equal((await PTB.pobFields("en", "poe1"))("Limited to: 1", {}), "Limited to: 1");
  const korean = await PTB.pobFields("kr", "poe2");
  assert.equal(korean("스킬 부여: 17레벨 대지 강타", {}), "Grants Skill: Level 17 Ground Slam");
  assert.equal(korean("요구 사항: 레벨 79, 힘 74, 민첩 42", {}), "Requires: Level 79, 74 Str, 42 Dex");
  assert.equal(korean("스킬 부여: 17레벨 미지의 스킬", {}), null);
  assert.equal((await PTB.pobFields("fr", "poe2"))("Prérequis:", {}), "Requirements:");
});

test("source fields retain jewel radius and unidentified tier, and use listed socket colours", async () => {
  const PTB = worker();
  const field = await PTB.pobFields("kr", "poe1");
  assert.equal(field("적용 반경: 대형 (1500)"), "Radius: Large (1500)");
  assert.equal(field("미확인 (3등급)"), "Unidentified (Tier 3)");
  const sockets = [{ sColour: "R", group: 0 }, { sColour: "B", group: 0 }, { sColour: "G", group: 1 }];
  assert.equal(field("홈: 빨강-파랑 초록", { sockets }), "Sockets: R-B G");
  assert.equal(field("홈: 빨강-파랑", { sockets }), null);
  const de = await PTB.pobFields("de", "poe1");
  assert.equal(de("Rüstung: 1.345"), "Armour: 1345");
  assert.equal(de("Angriffe pro Sekunde: 1.345"), "Attacks per Second: 1.345");
});
