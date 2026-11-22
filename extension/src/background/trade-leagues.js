// The trade site's ordered catalog is game-specific; PoE1 also lists console realms.
const leagueRequests = new Map();
PTB.tradeLeagues = async function (game, force = false) {
  if (!["poe1", "poe2"].includes(game)) throw Error("Invalid game");
  const key = "ptbTradeLeagues-" + game;
  const cached = (await chrome.storage.local.get(key))[key];
  if (!force && cached && Date.now() - cached.at < 3600000) return cached;
  if (!leagueRequests.has(game)) {
    const api = game === "poe1" ? "trade" : "trade2";
    const request = (async () => {
      const response = await fetch("https://poe.kakaogames.com/api/" + api + "/data/leagues", {
        credentials: "omit", cache: "reload", signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw Error("League catalog unavailable");
      const { result } = await response.json();
      const leagues = result.filter((l) => l.realm === (game === "poe1" ? "pc" : "poe2") && typeof l.id === "string")
        .map(({ id, text }) => ({ id, text }));
      if (!leagues.length) throw Error("Empty league catalog");
      const latest = leagues.find(({ id }) => !/^(?:Standard$|Hardcore\b|HC\b|Ruthless\b|SSF\b)/i.test(id))?.id || "";
      const catalog = { leagues, latest, at: Date.now() };
      await chrome.storage.local.set({ [key]: catalog });
      return catalog;
    })().finally(() => leagueRequests.delete(game));
    leagueRequests.set(game, request);
  }
  try {
    return await leagueRequests.get(game);
  } catch (error) {
    if (!force && cached) return cached;
    throw error;
  }
};
