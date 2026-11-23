importScripts("../common/url.js", "../common/trade-region.js", "redirect-settings.js", "trade-search.js", "trade-leagues.js", "../common/storage.js", "../common/backup.js", "recent-searches.js");

// Refresh saved redirect rules from versions which only switched the hostname.
chrome.runtime.onInstalled?.addListener(() => PTB.redirectSettings(null, true).catch(console.error));

let pendingBookmarkWrite = Promise.resolve();
function queueWrite(operation) {
  const write = pendingBookmarkWrite.then(operation);
  pendingBookmarkWrite = write.catch(() => {});
  return write;
}
async function maintainHistory() {
  await queueWrite(() => PTB.recentSearches.prune());
  if (!await chrome.alarms.get("ptb-expire-searches")) {
    await chrome.alarms.create("ptb-expire-searches", { periodInMinutes: 60 });
  }
}
chrome.runtime.onInstalled?.addListener(() => maintainHistory().catch(console.error));
chrome.runtime.onStartup?.addListener(() => maintainHistory().catch(console.error));
chrome.alarms?.onAlarm.addListener(alarm => {
  if (alarm.name === "ptb-expire-searches") queueWrite(() => PTB.recentSearches.prune()).catch(console.error);
});

// Manual choices may go through the site's login/challenge and return without
// our URL marker. Keep the tab-specific exemption through that round trip.
const sessionRules = chrome.declarativeNetRequest;
function removeManualRule(tabId) {
  return sessionRules.updateSessionRules({ removeRuleIds: [tabId + 1] });
}
chrome.tabs?.onRemoved?.addListener(tabId => {
  removeManualRule(tabId).catch(console.error);
  chrome.storage.session.remove("ptbVisit:" + tabId).catch(console.error);
});
chrome.tabs?.onUpdated?.addListener(async (tabId, change) => {
  if (!change.url) return;
  const [rule] = await sessionRules.getSessionRules({ ruleIds: [tabId + 1] });
  if (!rule || new RegExp(rule.condition.regexFilter).test(change.url)) return;
  const url = new URL(change.url);
  if (url.href.startsWith(chrome.runtime.getURL("src/region/query.html") + "?")) return;
  // Login can run on a different regional host and return to the selected site.
  if (/^\/(?:login|account\/login|oauth|auth|cdn-cgi)(?:\/|$)/.test(url.pathname)) return;
  await removeManualRule(tabId);
});

// 콘텐츠 스크립트는 CORS 때문에 poe.ninja를 직접 못 친다. 여기(확장 origin)에서만 fetch.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;
  if (msg.cmd === "ptb-recent" && ["record", "promote", "list", "clear", "setEnabled"].includes(msg.action)) {
    if (_sender.tab?.incognito) { sendResponse({ value: null }); return; }
    if (msg.action === "record") {
      const mark = msg.args?.[0];
      if (!mark || !_sender.tab || _sender.frameId !== 0 || PTB.gameFromUrl(_sender.url) !== mark.game ||
          new URL(_sender.url).host !== mark.host || !["search", "exchange"].includes(mark.type)) {
        sendResponse({ value: null });
        return;
      }
    }
    const work = queueWrite(() => PTB.recentSearches[msg.action](...msg.args));
    work.then(value => sendResponse({ value }), e => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.cmd === "ptb-preferred-link") {
    PTB.preferredTradeUrl(msg.href, msg.settings).then(sendResponse, () => sendResponse(null));
    return true;
  }
  if (msg.cmd === "ptb-claim-visit" && _sender.tab && _sender.frameId === 0) {
    const key = "ptbVisit:" + _sender.tab.id;
    chrome.storage.session.get(key).then(async stored => {
      const visit = stored[key];
      const destination = visit?.destination ?? visit?.href;
      if (!visit || visit.token !== msg.token || destination !== msg.href || new URL(destination).origin !== _sender.origin) return null;
      await chrome.storage.session.remove(key);
      return { id: visit.id, href: visit.href };
    }).then(sendResponse, () => sendResponse(null));
    return true;
  }
  if (msg.cmd === "ptb-trade-ready" && _sender.tab && _sender.frameId === 0) {
    const id = _sender.tab.id;
    sessionRules.getSessionRules({ ruleIds: [id + 1] }).then(async ([rule]) => {
      if (rule && new RegExp(rule.condition.regexFilter).test(_sender.url)) await removeManualRule(id);
    }).then(() => sendResponse(true), () => sendResponse(false));
    return true;
  }
  if (msg.cmd === "ptb-named-selection") {
    PTB.namedTradeSelection(_sender.url, msg.title).then(sendResponse, () => sendResponse(false));
    return true;
  }
  if (msg.cmd === "ptb-trade-leagues" || msg.cmd === "ptb-save-trade-snapshot") {
    const task = msg.cmd === "ptb-trade-leagues" ? Promise.resolve().then(() => PTB.tradeLeagues(msg.game, msg.force === true)) :
      PTB.tradeSnapshot(msg.href).then((patch) => PTB.redirectSettings(patch));
    task.then((value) => sendResponse({ value }), (error) => sendResponse({ error: error.message }));
    return true;
  }
  if (msg.cmd === "ptb-redirect-settings") {
    PTB.redirectSettings(msg.patch).then(
      (settings) => sendResponse({ settings }),
      (error) => sendResponse({ error: error.message })
    );
    return true;
  }
  if (msg.cmd === "ptb-localize-search" && new URL(msg.href).origin === _sender.origin) {
    PTB.localizeTradeSearch(msg.href).then((url) => sendResponse({ url }), () => sendResponse({ unavailable: true }));
    return true;
  }
  if (msg.cmd === "ptb-bookmark-write" && Object.hasOwn(PTB.bookmarkChanges, msg.action)) {
    const write = queueWrite(() => PTB.bookmarkChanges[msg.action](...msg.args));
    write.then(
      (result) => sendResponse({ ok: true, result }),
      (error) => sendResponse({ ok: false, error: error.message })
    );
    return true;
  }
  if (msg.cmd === "ptb-ping") {
    sendResponse({ ok: true });
    return;
  }
  if (msg.cmd !== "ptb-rates-fetch") return;
  const url = String(msg.url || "");
  if (
    url.indexOf("https://poe.ninja/poe2/api/economy/") !== 0 &&
    url.indexOf("https://poe.ninja/poe1/api/economy/") !== 0
  ) {
    sendResponse({ ok: false, error: "bad-url" });
    return;
  }
  fetch(url, { credentials: "omit" })
    .then((res) => {
      if (!res.ok) throw new Error("http " + res.status);
      return res.json();
    })
    .then((json) => sendResponse({ ok: true, json: json }))
    .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
  return true;
});
