(() => {
  const clean = PTB.cleanPobLine;
  const flags = new Set(["implicit", "enchant", "fractured", "crafted", "crucible", "scourge"]);
  function decode(text) {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(text), c => c.charCodeAt(0)));
  }

  let aliasKey, aliases;
  async function englishNames(item, game, region) {
    const names = { type: item.baseType };
    if (!names.type) throw Error("Missing base type");
    if (item.rarity === "Unique" || item.rarity === "Relic") names.name = item.name;
    try {
      const translated = { ...names };
      await translateItemFields(translated, game, region, "en", loadTradeNames);
      return translated;
    } catch {
      // The reverse direction can be unambiguous even when one English name
      // has several localized forms. These aliases are for PoB import only.
      const key = game + "/" + region;
      if (aliasKey !== key || !aliases) {
        aliasKey = key;
        aliases = fetch(chrome.runtime.getURL("src/assets/pob-base-aliases/" + key + ".json")).then(res => {
          if (!res.ok) throw Error("Missing item name aliases");
          return res.json();
        }).catch(error => { if (aliasKey === key) aliases = undefined; throw error; });
      }
      const data = await aliases;
      for (const [field, value] of Object.entries(names)) {
        if (!value) continue;
        if (Object.hasOwn(data[field], value.toLowerCase())) names[field] = data[field][value.toLowerCase()];
        else {
          const single = { [field]: value };
          await translateItemFields(single, game, region, "en", loadTradeNames);
          names[field] = single[field];
        }
      }
    }
    return names;
  }

  function modifierText(mod, translate) {
    const kind = mod.hash?.replace(/^stat\./, "").split(".")[0] || mod.kind;
    return translate(mod).then(text => flags.has(kind) ? text + " (" + kind + ")" : text);
  }

  // Older listings can omit native copy text. Only use the structured form
  // when it contains the full equipment data for a simple item.
  async function simpleBody(item, translate) {
    if (!item.simple || !Number.isInteger(item.ilvl)) throw Error("Missing item copy text");
    const parts = [];
    const level = item.requirements?.[0]?.values?.[0]?.[0];
    if (level != null) {
      if (!/^\d+$/.test(level)) throw Error("Unknown requirement");
      parts.push("Requirements:\nLevel: " + level);
    }
    parts.push("Item Level: " + item.ilvl);
    for (const kind of ["implicit", "explicit"]) {
      const mods = item.mods.filter(m => m.kind === kind);
      if (mods.length) parts.push((await Promise.all(mods.map(m => modifierText(m, translate)))).join("\n"));
    }
    if (item.corrupted) parts.push("Corrupted");
    return parts;
  }

  async function translateBody(raw, item, translate, field) {
    const [header, ...sections] = raw.replace(/\r/g, "").trim().split(/\n--------\n/);
    if (!sections.length || header.split("\n").length < 3) throw Error("Missing item header");
    const itemClass = clean(header.split("\n", 1)[0]).split(/[:：]/).slice(1).join(":").trim();
    const flavor = clean((item.flavour || []).join(" "));
    const byText = new Map();
    let maxLines = 1;
    for (const mod of item.mods) {
      const key = clean(mod.description);
      if (!byText.has(key)) byText.set(key, []);
      byText.get(key).push(mod);
      maxLines = Math.max(maxLines, mod.description.split("\n").length);
    }
    const result = [];
    for (const section of sections) {
      if (!section.trim() || clean(section) === flavor) continue;
      const lines = section.split("\n"), translated = [];
      for (let i = 0; i < lines.length; i++) {
        const line = clean(lines[i]);
        if (!line || line === itemClass) continue;
        let matched;
        for (let size = Math.min(maxLines, lines.length - i); size >= 1; size--) {
          matched = byText.get(clean(lines.slice(i, i + size).join(" ")));
          if (matched) { i += size - 1; break; }
        }
        if (matched) {
          const choices = new Set(await Promise.all(matched.map(mod => modifierText(mod, translate))));
          if (choices.size !== 1) throw Error("Ambiguous item line");
          translated.push(...choices);
        } else {
          const text = field(lines[i], item);
          if (text == null) throw Error("Unrecognised item line");
          if (text) translated.push(text);
        }
      }
      if (translated.length) result.push(translated.join("\n"));
    }
    return result;
  }

  PTB.pobItemText = async function (item, host, game) {
    if (!item || !["poe1", "poe2"].includes(game)) throw Error("Missing listing");
    const region = PTB.hostToRealm(host);
    const raw = item.nativeText ? decode(item.nativeText) : null;
    if (raw && /^(?:Item Class: [^\r\n]+\r?\n)?Rarity: /i.test(raw) && region === "en") return raw;
    const names = await englishNames(item, game, region);
    const [titles, field, translate] = await Promise.all([
      PTB.pobTitleLines(item, names, game, region), PTB.pobFields(region, game),
      region === "en" ? (mod => Promise.resolve(mod.description)) : PTB.pobStats(game, region),
    ]);
    const header = ["Rarity: " + item.rarity, ...titles].join("\n");
    const body = raw ? await translateBody(raw, item, translate, field) : await simpleBody(item, translate);
    return [header, ...body].join("\n--------\n");
  };
})();
