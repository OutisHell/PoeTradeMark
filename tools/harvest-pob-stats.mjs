// Generate from each installed client's stat_descriptions.csd (UTF-16LE).
// PoE1: metadata/statdescriptions/; PoE2: data/statdescriptions/.
// Pass the two extracted files, in game order. Nothing is downloaded at runtime.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const languages = { Korean: "ko", German: "de", French: "fr", Spanish: "es", Portuguese: "pt",
  Japanese: "ja", Russian: "ru", Thai: "th", "Traditional Chinese": "tw" };
const slot = /\{(\d+)(?::(\+d|\+|d))?\}/g;
function display(text) {
  return text.replace(/\[([^\[\]|]+)(?:\|([^\[\]]+))?\]/g, (_, key, label) => label ?? key)
    .replace(/\\n/g, "\n").replace(/\\\"/g, '"').replace(/\r/g, "").trim();
}
function filterShape(text) {
  return display(text).replace(slot, (_, n, fmt) => fmt?.startsWith("+") ? "+#" : "#")
    .normalize("NFKC").replace(/\s*\(Local\)$/i, "").replace(/\s+/g, " ").trim().toLowerCase();
}

const inputs = process.argv.slice(2);
if (inputs.length !== 2) throw Error("Usage: node tools/harvest-pob-stats.mjs <poe1.csd> <poe2.csd>");
for (const [index, game] of ["poe1", "poe2"].entries()) {
  const root = new URL("../extension/src/assets/", import.meta.url);
  const catalog = JSON.parse(await readFile(new URL("trade-filters/" + game + "/en.json", root)));
  const english = new Set(Object.values(catalog.stats).map(filterShape));
  const pairs = Object.fromEntries(Object.values(languages).map(code => [code, new Set()]));
  const raw = await readFile(inputs[index], "utf16le");
  for (const block of raw.split(/^\uFEFF?description[^\r\n]*\r?$/m)) {
    const en = new Map(), translations = [];
    let language = "en";
    for (const line of block.split("\n")) {
      const lang = /^\s*lang "([^"]+)"/.exec(line);
      if (lang) { language = languages[lang[1]]; continue; }
      if (!language) continue;
      const match = /^\s*([#\d| +-]+)\s+"((?:[^"\\]|\\.)*)"(.*)$/.exec(line.trimEnd());
      if (!match) continue;
      const [, condition, template, extra] = match;
      const text = display(template);
      if (!text || text.replace(slot, "").includes("{")) continue;
      // Pair only rules applying to the same values with the same value transforms.
      const handlers = extra.replace(/\b(?:reminderstring \S+|canonical_line|canonical_stat \d+)\b/g, "").trim();
      const key = condition.trim() + "|" + handlers;
      if (language === "en") en.set(key, en.has(key) && en.get(key) !== text ? null : text);
      else translations.push([language, key, text]);
    }
    if (![...en.values()].some(t => t && english.has(filterShape(t)))) continue;
    for (const [lang, key, local] of translations) {
      const target = en.get(key);
      if (!target) continue;
      const slots = text => [...new Set([...text.matchAll(slot)].map(m => m[1]))].sort().join("/");
      if (slots(local) !== slots(target)) continue;
      pairs[lang].add(JSON.stringify([local, target]));
    }
  }
  const dir = new URL("pob-stats/" + game + "/", root);
  await mkdir(dir, { recursive: true });
  for (const [lang, entries] of Object.entries(pairs)) {
    if (entries.size < 1000) throw Error("Incomplete stat data for " + game + "/" + lang + ": " + entries.size);
    const bytes = gzipSync("[" + [...entries].sort().join(",") + "]", { level: 9 });
    await writeFile(new URL(lang + ".json.gz", dir), bytes);
    console.log(game, lang, entries.size, bytes.length);
  }
}
