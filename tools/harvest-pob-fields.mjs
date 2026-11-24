// Build with: node tools/harvest-pob-fields.mjs /path/to/dat-exports
// Export ClientStrings (Id, Text) and AlternateQualityTypes (Id, Description)
// in all languages, plus ActiveSkills (Id, DisplayedName) for PoE2. Example
// pathofexile-dat output: <root>/poe1/tables/English/ClientStrings.json.
// These strings are extracted from the game clients and belong to Grinding Gear Games.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.argv[2];
if (!root) throw Error("Expected a root containing poe1/tables and poe2/tables");
const locales = { en: "English", kr: "Korean", jp: "Japanese", de: "German", es: "Spanish",
  fr: "French", br: "Portuguese", ru: "Russian", th: "Thai", tw: "Traditional Chinese" };

function plain(text) {
  // The game renderer displays the alias of a linked term (or the term itself).
  return text?.replace(/\[([^\]|]+)\|([^\]]+)\]/g, "$2").replace(/\[([^\]]+)\]/g, "$1")
    .replace(/[\u200b\ufeff]/g, "").replace(/\s+/g, " ").trim().normalize("NFC");
}

for (const game of ["poe1", "poe2"]) {
  const output = new URL("../extension/src/assets/pob-fields/" + game + "/", import.meta.url);
  await mkdir(output, { recursive: true });
  async function load(lang, table = "ClientStrings", column = "Text") {
    const records = JSON.parse(await readFile(join(root, game, "tables", lang, table + ".json"), "utf8"));
    return Object.fromEntries(records.map(row => [row.Id, plain(row[column])]));
  }
  const english = await load("English");
  const englishQuality = await load("English", "AlternateQualityTypes", "Description");
  const englishSkills = game === "poe2" ? await load("English", "ActiveSkills", "DisplayedName") : {};
  const ids = Object.keys(english).filter(id =>
    /^(ItemDisplay|ItemPopup|JewelRadius|JewelItemLimit$|ItemRequirementsLabel$|ItemTierDisplay$|Level$|Quality$|Experience$|Strength(Short)?$|Dexterity(Short)?$|Intelligence(Short)?$|NumberOfPortalsPerWaystone$)/.test(id)
    && !/^(ItemDisplayString(Class|Rarity|Magic|Rare|Unique|Gem|Currency|Normal|DivinationCard|Quest)|ItemDisplayStringNote)$/.test(id));

  for (const [region, lang] of Object.entries(locales)) {
    const local = region === "en" ? english : await load(lang);
    const terms = new Map(), formats = [], duplicates = new Set();
    for (const id of ids) {
      const from = local[id];
      // The clipboard prints the abbreviated stat even in locales in which the
      // full and abbreviated local labels coincide (e.g. Korean 힘).
      const to = /^(Strength|Dexterity|Intelligence)$/.test(id) ? english[id + "Short"] : english[id];
      if (!from || !to || /[<>]|\[DNT\]/.test(from + to)) continue;
      if (/[{}]/.test(from + to)) {
        const slots = text => [...text.matchAll(/\{(\d+)\}/g)].map(m => m[1]).sort().join();
        if (!slots(from) || slots(from) !== slots(to) || /^(?:\{\d+\}[\s:/{}\d-]*)$/.test(from)) continue;
        formats.push([from, to]);
      } else {
        const key = from.replace(/[：:]$/, "").trim();
        const value = to.replace(/[：:]$/, "").trim();
        if (terms.has(key) && terms.get(key) !== value) duplicates.add(key);
        else terms.set(key, value);
      }
    }
    for (const key of duplicates) terms.delete(key);
    if (terms.size < 100 || !local.ItemDisplayStringNote) throw Error("Incomplete client strings: " + lang);
    const quality = await load(lang, "AlternateQualityTypes", "Description");
    for (const [id, description] of Object.entries(quality)) {
      if (description && englishQuality[id]) terms.set(description, englishQuality[id]);
    }
    const data = { note: local.ItemDisplayStringNote, requirements: local.ItemPopupRequirements,
      requires: local.ItemRequirementsLabel, terms: Object.fromEntries(terms), formats };
    if (game === "poe2") {
      const skills = await load(lang, "ActiveSkills", "DisplayedName");
      const map = new Map(), ambiguous = new Set();
      for (const [id, name] of Object.entries(skills)) {
        if (!name || !englishSkills[id]) continue;
        if (map.has(name) && map.get(name) !== englishSkills[id]) ambiguous.add(name);
        else map.set(name, englishSkills[id]);
      }
      for (const name of ambiguous) map.delete(name);
      data.skills = Object.fromEntries(map);
      // Some client templates use formatting markup around the underlined
      // value. Placeholders themselves are also braced. Preserve both slots.
      data.skillFormats = [
        [local.ItemDisplayGrantsSkill + ": " + local.ItemPopupSkillOfLevel, "Grants Skill: Level {1} {0}"],
        [local.ItemDisplayGrantedSkill.replace(/<underline>\{\{(?=0\})/, "{").replace("<underline>{{", "").replace(/\}\}$/, ""),
          "Grants Skill: Level {1} {0}"],
        [local.ItemDisplayGrantedSkillNoScaling.replace(/<underline>\{\{\{0\}\}\}/, "{0}"), "Grants Skill: {0}"],
      ];
    }
    await writeFile(new URL(region + ".json", output), JSON.stringify(data) + "\n");
  }
}
