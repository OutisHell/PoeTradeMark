// Trade IDs connect localized search templates. The client rules supply the
// argument position when the game reorders numbers or uses a different form.
(() => {
  const slot = /\{(\d+)(?::(\+d|\+|d))?\}/g;
  const clean = value => value.normalize("NFKC").replace(/[\u200b\ufeff]/g, "")
    .replace(/\[([^\[\]|]+)(?:\|([^\[\]]+))?\]/g, (_, key, text) => text ?? key)
    .replace(/[’‘]/g, "'").replace(/−/g, "-").replace(/(\d)[\u0020\u202f\u00a0](?=\d{3}\b)/g, "$1")
    .replace(/\s+/g, " ").replace(/\s+%/g, "%").trim();
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const number = "([+-]?\\d+(?:[.,]\\d+)*)";
  const locale = { kr: "ko-KR", jp: "ja-JP", br: "pt-BR", tw: "zh-TW" };
  const grouping = new Map();
  function englishNumber(value, region) {
    if (!grouping.has(region)) {
      const parts = new Intl.NumberFormat(locale[region] || region).formatToParts(12345.6);
      grouping.set(region, { group: parts.find(p => p.type === "group")?.value, decimal: parts.find(p => p.type === "decimal").value });
    }
    const { group, decimal } = grouping.get(region);
    let num = value;
    // Some trade text uses the invariant "." decimal even on comma-decimal sites.
    if (group && value.includes(group)) {
      const integer = value.split(decimal)[0];
      const grouped = new RegExp("^[+-]?\\d{1,3}(?:" + escape(group) + "\\d{3})+$");
      if (grouped.test(integer)) num = num.split(group).join("");
    }
    num = num.replace(decimal, ".");
    return /^[+-]?\d+(?:\.\d+)?$/.test(num) ? num : null;
  }

  const localHint = /\s*\((?:Local|Lokal|특정|ローカル|На предмете|ของไอเทม|部分)\)$/i;
  function tradeMatch(source, target, line, region) {
    const template = clean(source).replace(localHint, "");
    const dest = target.replace(localHint, "");
    const parts = template.split("#"), destParts = dest.split("#");
    if (parts.length !== destParts.length) return;
    if (parts.length > 2 && !(parts.length === 3 && /#\s*(?:to|~|–|-|bis|à|a|から|ถึง|至|до)\s*#/i.test(template) && /# to #/.test(dest))) return;
    const match = new RegExp("^" + parts.map(escape).join(number) + "$", "iu").exec(line);
    if (!match) return;
    const values = match.slice(1).map(n => englishNumber(n, region));
    if (values.includes(null)) return;
    let i = 0;
    return dest.replace(/#/g, () => values[i++]);
  }

  const shape = template => clean(template).toLowerCase().replace(/[+-]?(?:\{\d+(?::[^}]+)?\}|\d+(?:[.,]\d+)*)/g, "#");
  function indexRules(rows) {
    const index = new Map();
    for (const rule of rows) {
      const key = shape(rule[0]);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(rule);
    }
    return index;
  }
  function clientMatch(source, target, line, region) {
    const template = clean(source), slots = [], pattern = [];
    let pos = 0;
    for (const m of template.matchAll(slot)) {
      pattern.push(escape(template.slice(pos, m.index)), number);
      slots.push(m[1]);
      pos = m.index + m[0].length;
    }
    pattern.push(escape(template.slice(pos)));
    const match = new RegExp("^" + pattern.join("") + "$", "iu").exec(line);
    if (!match) return;
    const values = new Map();
    for (const [i, id] of slots.entries()) {
      const val = englishNumber(match[i + 1], region)?.replace(/^\+/, "");
      if (val == null || (values.has(id) && values.get(id) !== val)) return;
      values.set(id, val);
    }
    return target.replace(slot, (_, id, fmt) => (fmt?.startsWith("+") && !values.get(id).startsWith("-") ? "+" : "") + values.get(id));
  }

  async function readAsset(file, compressed = false) {
    const response = await fetch(chrome.runtime.getURL("src/assets/" + file));
    if (!response.ok) throw Error("Missing packaged PoB data");
    if (!compressed) return response.json();
    return new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).json();
  }
  const langCode = region => ({ kr: "ko", jp: "ja", br: "pt" })[region] || region;
  let lastKey, lastCatalogs;
  PTB.pobStats = async function (game, region) {
    const code = langCode(region), key = game + "/" + code;
    if (key !== lastKey || !lastCatalogs) {
      lastKey = key;
      lastCatalogs = Promise.all([code, "en"].map(lang => readAsset("trade-filters/" + game + "/" + lang + ".json"))).then(([src, dest]) => {
        const variants = new Map();
        for (const id of Object.keys(src.stats)) {
          const index = id.indexOf("|");
          if (index < 0) continue;
          const base = id.slice(0, index);
          if (!variants.has(base)) variants.set(base, []);
          variants.get(base).push(id);
        }
        let rules;
        return async function translate(mod) {
          const line = clean(mod.description);
          const choices = new Set();
          const ids = mod.hash ? [mod.hash.replace(/^stat\./, "")] : mod.ids || [];
          for (const id of ids) {
            for (const candidate of [id, ...(variants.get(id) || [])]) {
              const source = src.stats[candidate], target = dest.stats[candidate];
              if (!source || !target) continue;
              const text = tradeMatch(source, target, line, region);
              if (text) choices.add(text);
            }
          }
          if (!choices.size) {
            rules ??= readAsset("pob-stats/" + key + ".json.gz", true).then(indexRules).catch(error => { rules = undefined; throw error; });
            for (const [source, target] of (await rules).get(shape(line)) || []) {
              const text = clientMatch(source, target, line, region);
              if (text) choices.add(text);
            }
          }
          if (choices.size !== 1) throw Error("Unrecognised modifier");
          return [...choices][0];
        };
      }).catch(error => { if (lastKey === key) lastCatalogs = undefined; throw error; });
    }
    return lastCatalogs;
  };
  PTB.cleanPobLine = clean;
})();
