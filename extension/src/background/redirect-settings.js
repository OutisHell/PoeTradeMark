// All surfaces change one field at a time through the worker so concurrent edits compose.
let pendingRedirectSetting = Promise.resolve();
PTB.redirectSettings = function (patch, reinstall = false) {
  const operation = pendingRedirectSetting.then(async () => {
    const active = await PTB.tradeRegion.getPreference();
    const { ptbRedirectSettings: saved } = await chrome.storage.local.get("ptbRedirectSettings");
    const remembered = Object.hasOwn(PTB.tradeRegion.regions, saved?.code) ? saved.code : "";
    const current = { code: active || remembered, enabled: Boolean(active || saved?.enabled) };
    if (saved?.profiles) current.profiles = saved.profiles;
    if (!patch) {
      if (reinstall && current.enabled) await PTB.tradeRegion.setPreference(current.code, current.profiles);
      return { ...current, configured: Boolean(active || saved) };
    }
    const { profile, code = current.code, enabled = current.enabled } = patch;
    const next = { ...current, code, enabled };
    if ((next.code !== "" && !Object.hasOwn(PTB.tradeRegion.regions, next.code)) || typeof next.enabled !== "boolean") {
      throw new Error("Invalid redirect setting");
    }
    if (profile) {
      const { game } = profile;
      if (game !== "poe1" && game !== "poe2") throw Error("Invalid game");
      const { league = "", status = "" } = { ...current.profiles?.[game], ...profile };
      if (typeof league !== "string" || league.length > 160 || /[\/\\?#\x00-\x1f]/.test(league) ||
          (status !== "" && !PTB.tradeRegion.statuses.includes(status))) throw Error("Invalid search preference");
      next.profiles = { ...current.profiles, [game]: { league, status } };
    }
    const updateRules = next.enabled !== current.enabled || (next.enabled && (code !== current.code || profile));
    if (updateRules) await PTB.tradeRegion.setPreference(next.enabled ? code : "", next.enabled ? next.profiles : undefined);
    try {
      await chrome.storage.local.set({ ptbRedirectSettings: next });
    } catch (error) {
      if (updateRules) await PTB.tradeRegion.setPreference(current.enabled ? current.code : "", current.enabled ? current.profiles : undefined);
      throw error;
    }
    return { ...next, configured: true };
  });
  pendingRedirectSetting = operation.catch(() => {});
  return operation;
};
