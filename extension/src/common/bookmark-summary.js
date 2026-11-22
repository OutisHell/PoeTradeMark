// Use the executed query when the trade link carries one. Short IDs rely on the trade form.

// Display labels from the regional trade filter catalogs, used for opaque search IDs.
const tradeRarityOptions = {
  "Item Rarity": ["Normal", "Magic", "Rare", "Unique", "Unique (Foil)"],
  "아이템 희귀도": ["일반", "마법", "희귀", "고유", "고유 (반짝이 버전)"],
  "アイテムレアリティ": ["ノーマル", "マジック", "レア", "ユニーク", "ユニーク（フォイル）"],
  "Gegenstandsseltenheit": ["Normal", "Magisch", "Selten", "Einzigartig", "Einzigartiger Gegenstand (Foil)"],
  "Rareté de l'objet": ["Normal", "Magique", "Rare", "Unique", "Objet unique (en version surbrillante)"],
  "Rareza de objeto": ["Normal", "Mágico", "Raro", "Único", "Único (brillante)"],
  "Raridade do Item": ["Normal", "Mágico", "Raro", "Único", "Único (Laminado)"],
  "Редкость предмета": ["Обычный", "Волшебный", "Редкий", "Уникальный", "Уникальный предмет (особый)"],
  "ระดับความหายาก": ["ธรรมดา", "เมจิก", "แรร์", "ยูนิค", "ไอเทมยูนิค (ฟอยล์)"],
  "物品稀有度": ["一般", "魔法", "稀有", "傳奇", "傳奇 (貼模)"],
};
PTB.tradeFormRarity = function (key, title, id, label) {
  const options = Object.hasOwn(tradeRarityOptions, title) ? tradeRarityOptions[title] : null;
  if (!options && key !== "rarity") return undefined;
  if (id) return id;
  return ["normal", "magic", "rare", "unique", "uniquefoil"][options?.indexOf(label)] || "";
};

PTB.matchListingSample = async function (sample, searchId, query) {
  if (!sample || sample.query === searchId) return sample;
  if (!query || !sample.query?.startsWith("H4sI")) return null;
  try {
    const received = await PTB.unpackTradeQuery(sample.query);
    const sorted = (_, value) => value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value;
    return JSON.stringify(received, sorted) === JSON.stringify(query, sorted) ? sample : null;
  } catch {
    return null;
  }
};

function listingRarity(sample) {
  const rows = sample?.rows || [];
  if (!rows.length || (rows.length < 3 && rows.length !== sample.total)) return;
  if (Object.hasOwn(PTB.bookmarkRarityColors, rows[0]) && rows.every(rarity => rarity === rows[0])) return rows[0];
  if (rows.every(rarity => rarity === "unique" || rarity === "uniquefoil")) return "unique";
}

PTB.bookmarkSummary = function (query, form, categoryLabels, sample) {
  const t = (key, fallback) => PTB.i18n?.t(key, fallback) || fallback;
  const text = value => typeof value === "string" ? value.trim() : "";
  const field = value => text(value?.option ?? value);
  const humanize = key => key.replace(/[_\.]/g, " ");
  const range = value => [
    value?.min != null && "≥ " + value.min,
    value?.max != null && "≤ " + value.max,
    value?.weight != null && "× " + value.weight,
  ].filter(Boolean).join(" · ");
  const types = query?.filters?.type_filters;
  const filter = types?.filters?.rarity;
  const option = query ? (!types?.disabled && !filter?.disabled ? field(filter) : "") : form.rarity;
  const named = query ? field(query.name) : form.named ? form.title : "";
  let rarity;
  if (option === "uniquefoil") rarity = "uniquefoil";
  else if (named) rarity = "unique";
  else if (Object.hasOwn(PTB.bookmarkRarityColors, option)) rarity = option;
  else if (!option || option === "any") rarity = listingRarity(sample);
  const base = query ? field(query.type) : named ? "" : form.title;
  const itemName = [...new Set([named, base].filter(Boolean))].join(" ") || text(query?.term);
  if (!query) {
    return { title: itemName || form.category || form.filters[0] || t("noTitle", "(Untitled)"),
      itemName, filters: form.filters, rarity };
  }
  const filters = [];
  let category = "";
  const labels = {
    ilvl: t("queryItemLevel", "Item level"), indexed: t("queryIndexed", "Listed within"),
    price: t("queryPrice", "Price"),
  };
  for (const group of Object.values(query.filters || {})) {
    if (!group || group.disabled) continue;
    for (const [key, value] of Object.entries(group.filters || {})) {
      if (value == null || value.disabled) continue;
      if (key === "rarity" || key === "status") continue;
      if (key === "category") {
        const id = field(value);
        if (id && id !== "any") category = categoryLabels && Object.hasOwn(categoryLabels, id)
          ? categoryLabels[id] : form.categoryId === id ? form.category : "";
        continue;
      }
      let option = value.option ?? (typeof value === "object" ? "" : value);
      if (option === "any" && !range(value)) continue;
      if (key === "indexed" && /^(\d+)days?$/.test(option)) {
        option = t("queryDays", "{n} days").replace("{n}", parseInt(option, 10));
      }
      const description = [range(value), option].filter(v => v !== "" && v != null && typeof v !== "object").join(" ");
      if (description) filters.push((form.labels?.[key] || labels[key] || humanize(key)) + ": " + description);
    }
  }
  const stats = Array.isArray(query.stats) ? query.stats.filter(group => Array.isArray(group?.filters)) : [];
  const statCount = stats.reduce((count, group) => count + group.filters.length, 0);
  const statNames = form.statNames?.length === statCount ? form.statNames : [];
  let index = 0;
  for (const group of stats) {
    const entries = [];
    for (const stat of group.filters || []) {
      const renderedName = statNames[index++];
      if (group.disabled || !stat?.id || stat.disabled) continue;
      const value = [range(stat.value), stat.value?.option].filter(v => v != null && v !== "").join(" ");
      const name = form.labels?.[stat.id] || renderedName || stat.id;
      entries.push(value ? name + ": " + value : name);
    }
    if (group.type === "and") filters.push(...entries);
    else if (entries.length) filters.push([group.type, range(group.value), entries.join(" / ")].filter(Boolean).join(" · "));
  }
  const primary = filters[0];
  if (category && itemName) filters.unshift(category);
  return { title: itemName || category || primary || t("noTitle", "(Untitled)"), itemName, filters, rarity };
};
