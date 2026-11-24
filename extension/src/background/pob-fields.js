(() => {
  const clean = value => value.normalize("NFC").replace(/[\u200b\ufeff]/g, "")
    .replace(/\s+/g, " ").replace(/\s*[:：]\s*/g, ":").trim();
  const escape = text => text.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&");
  const number = "[+-]?\\d+(?:[.,\\u0020]\\d+)*";
  const typedLabels = { 9: "Physical Damage", 13: "Attacks per Second",
    62: "Level", 63: "Str", 64: "Dex", 65: "Int" };
  const decimalComma = new Set(["fr", "de", "br", "ru", "es"]);

  function normalizeNumber(text, region) {
    text = text.replace(/ (?=\d{3}(?:\D|$))/g, "");
    // Trade clipboard decimals can use a dot even on a comma-decimal client.
    if (decimalComma.has(region)) return text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
    return text.replace(/,(?=\d{3}(?:\D|$))/g, "");
  }

  function compileFormat([source, english], namedSkill = false) {
    const ids = [];
    const pattern = clean(source).split(/(\{\d+\})/g).map(part => {
      if (!/^\{\d+\}$/.test(part)) return escape(part);
      ids.push(Number(part.slice(1, -1)));
      return namedSkill && part === "{0}" ? "(.{1,200}?)" : "(" + number + ")";
    }).join("");
    return { pattern: new RegExp("^" + pattern + "$"), ids, english };
  }

  function formatLine(line, formats, region, skills) {
    const possibilities = new Set();
    for (const { pattern, ids, english } of formats) {
      const match = pattern.exec(line);
      if (!match) continue;
      const slots = [];
      ids.forEach((id, index) => { slots[id] = normalizeNumber(match[index + 1], region); });
      if (skills) {
        const name = match[1 + ids.indexOf(0)];
        if (!Object.hasOwn(skills, name)) continue;
        slots[0] = skills[name];
      }
      // Some languages have a single string for both quantities. Select the
      // corresponding English inflection using its owning placeholder.
      const unit = /\{(\d+)\} (Second|metre|Charge|Use|Variation|Unit|Seed|enemy|Socketed Fossil)(s)?\b/.exec(english);
      if (unit && (Number(slots[unit[1]]) !== 1) !== Boolean(unit[3])) continue;
      possibilities.add(english.replace(/\{(\d+)\}/g, (_, id) => slots[id]));
    }
    return possibilities.size === 1 ? [...possibilities][0] : null;
  }

  function createReader(data, region, game) {
    const formats = data.formats.map(pair => compileFormat(pair));
    const skillFormats = (data.skillFormats || []).map(pair => compileFormat(pair, true));
    const lookup = text => Object.hasOwn(data.terms, text) ? data.terms[text] : null;
    const note = clean(data.note).replace(/:$/, "");
    const requirements = clean(data.requirements).replace(/:$/, "");
    const requires = clean(data.requires).replace(/:$/, "");

    function valueText(text) {
      const literal = lookup(text);
      if (literal) return literal;
      // Only consume a recognized annotation. A field can contain several
      // elemental ranges and a separate augmentation annotation on each roll.
      const pieces = text.split(/,\s+(?=[+-]?\d)/);
      if (pieces.length > 1) {
        const converted = pieces.map(valueText);
        return converted.every(Boolean) ? converted.join(", ") : null;
      }
      const annotated = /^(.+?)\s*(\([^()]+\))$/.exec(text);
      if (annotated) {
        const suffix = annotated[2] === "(augmented)" ? annotated[2] : lookup(annotated[2]);
        if (suffix) {
          const base = valueText(annotated[1]);
          if (base) return base + " " + suffix;
        }
      }
      const rolled = /^([+-]?\d+(?:[., ]\d+)*)(?:\s*([-~～–/])\s*(\d+(?:[., ]\d+)*))?\s*(%)?$/.exec(text);
      if (rolled) {
        const range = rolled[2] ? (rolled[2] === "/" ? "/" : "-") + normalizeNumber(rolled[3], region) : "";
        return normalizeNumber(rolled[1], region) + range + (rolled[4] || "");
      }
      return formatLine(text, formats, region);
    }

    return (rawLine, item = {}) => {
      if (rawLine.length > 4096) return null;
      const line = clean(rawLine);
      const split = line.indexOf(":");
      if (split >= 0 && line.slice(0, split) === note) return "";
      if (line.replace(/:+$/, "") === requirements) return "Requirements:";
      if (line.startsWith(requires + ":")) {
        const required = line.slice(requires.length + 1).split(/[,，、]\s*/).map(part => {
          const digits = part.match(/\d+/g);
          if (digits?.length !== 1) return null;
          const stat = lookup(part.replace(digits[0], "").trim());
          if (stat === "Level") return "Level " + digits[0];
          return ["Str", "Dex", "Int"].includes(stat) ? digits[0] + " " + stat : null;
        });
        if (required.every(Boolean)) return "Requires: " + required.join(", ");
      }
      const direct = lookup(line);
      if (direct) return direct;
      const skill = formatLine(line, skillFormats, region, data.skills);
      if (skill) return skill;
      const formatted = formatLine(line, formats, region);
      if (formatted) return formatted;
      const unidentified = /^(.+?)\s*(\([^()]+\))$/.exec(line);
      if (unidentified && lookup(unidentified[1]) === "Unidentified") {
        const tier = formatLine(unidentified[2], formats, region);
        if (tier?.startsWith("(Tier ")) return "Unidentified " + tier;
      }
      if (split < 0) return null;
      const label = line.slice(0, split), rawValue = line.slice(split + 1);
      let english = lookup(label);
      if (!english) {
        // Trade sometimes uses a different label than the client. Accept a
        // known type only if the same listing also confirms the displayed roll.
        const props = [...(item.properties || []), ...(item.requirements || []), ...(item.additionalProperties || [])];
        const prop = props.find(p => p.name && clean(p.name) === label &&
          p.values?.length === 1 && clean(String(p.values[0][0])) === rawValue.replace(/ \(augmented\)$/, ""));
        if (prop) english = prop.type === 12 ? (game === "poe2" ? "Critical Hit Chance" : "Critical Strike Chance") : typedLabels[prop.type];
      }
      if (!english) return null;
      if (!rawValue) return english + ":";
      if (english === "Sockets") {
        if (/^(?:DV|[RGBWASJ])(?:[ -](?:DV|[RGBWASJ]))*$/.test(rawValue)) return "Sockets: " + rawValue;
        const groups = item.sockets;
        if (!groups?.length || rawValue.split(/[ -]/).length !== groups.length) return null;
        let sockets = "";
        for (const [i, socket] of groups.entries()) {
          const colour = game === "poe1" ? socket.sColour : ({ rune: "S", jewel: "J" })[socket.type];
          if (!/^(?:DV|[RGBWASJ])$/.test(colour)) return null;
          if (i) sockets += game === "poe1" && socket.group === groups[i - 1].group ? "-" : " ";
          sockets += colour;
        }
        return "Sockets: " + sockets;
      }
      if (english === "Radius") {
        const radius = /^(.+?)\s*(\(\d+\))$/.exec(rawValue);
        if (radius && lookup(radius[1])) return "Radius: " + lookup(radius[1]) + " " + radius[2];
      }
      // A dot can be a decimal point in trade text even in comma locales.
      // Remove thousands-group dots only on inherently integral properties.
      if (decimalComma.has(region) && /^(Armour|Evasion Rating|Energy Shield|Ward|Runic Ward|Spirit)$/.test(english)) {
        const grouped = /^(\d{1,3}(?:\.\d{3})+)( \(augmented\))?$/.exec(rawValue);
        if (grouped) return english + ": " + grouped[1].replace(/\./g, "") + (grouped[2] || "");
      }
      const value = valueText(rawValue);
      return value === null ? null : english + ": " + value;
    };
  }

  const readers = new Map();
  PTB.pobFields = async function (region, game) {
    if (!/^(en|kr|jp|de|fr|es|br|ru|th|tw)$/.test(region) || !/^(poe1|poe2)$/.test(game)) {
      throw Error("Unknown item field catalog");
    }
    const key = game + "/" + region;
    if (!readers.has(key)) {
      const url = chrome.runtime.getURL("src/assets/pob-fields/" + key + ".json");
      readers.set(key, fetch(url).then(response => {
        if (!response.ok) throw Error("Item field catalog unavailable");
        return response.json();
      }).then(data => createReader(data, region, game)).catch(error => {
        readers.delete(key);
        throw error;
      }));
    }
    return readers.get(key);
  };
})();
