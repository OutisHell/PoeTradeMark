PTB.recentAction = async function (action, ...args) {
  if (chrome.extension.inIncognitoContext) return null;
  const response = await chrome.runtime.sendMessage({ cmd: "ptb-recent", action, args });
  if (response?.error) throw Error(response.error);
  return response?.value;
};

// Recent searches use the same card builders and scroll container as bookmarks.
PTB.historyIconPaths = [
  ["path", { d: "M3 11a9 9 0 1 1 2.7 7M3 4v7h7M12 7v5l3 2" }],
];

PTB.readRecentView = async function (game) {
  const [history, canSave] = await Promise.all([PTB.recentAction("list", game), PTB.storage.hasCollection(game)]);
  const bookmarks = await PTB.localizeBookmarkList(history.entries.map(entry => ({
    ...entry.bookmark, recentId: entry.id, canSave,
  })));
  return { bookmarks, game, enabled: history.enabled };
};

PTB.recentJumpUrl = function (mark) {
  const href = PTB.buildTradeUrl(mark);
  return PTB.tradeRegion.tradeUrl(href, mark.realm)
    ? chrome.runtime.getURL("src/region/query.html") + "?manual=" + mark.realm + "&" + href : href;
};

PTB.recentSaveButton = function (mark, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = "☆";
  button.title = PTB.i18n.t(mark.canSave ? "bookmarkButton" : "collectionStart");
  button.setAttribute("aria-label", button.title + " · " + mark.title);
  button.disabled = !mark.canSave;
  button.onclick = async () => {
    button.disabled = true;
    try { await PTB.recentAction("promote", mark.game, mark.recentId); }
    catch (error) { button.disabled = false; button.title = error.message; }
  };
  return button;
};

PTB.renderRecentView = function (list, controls, view, buildRow, backToBookmarks, matches, chooseGame) {
  const t = PTB.i18n.t;
  const back = document.createElement("button");
  back.type = "button";
  back.textContent = "❮";
  back.title = t("backToBookmarks");
  back.setAttribute("aria-label", back.title);
  back.onclick = backToBookmarks;
  const title = document.createElement("strong");
  title.textContent = t("recentHeading");
  const settings = document.createElement("details");
  settings.className = "ptb-recent-settings";
  const more = document.createElement("summary");
  more.textContent = "⋯";
  more.title = t("recentRecording");
  more.setAttribute("aria-label", more.title);
  const menu = document.createElement("div");
  const label = document.createElement("label");
  const check = document.createElement("input");
  check.type = "checkbox";
  check.checked = view.enabled;
  check.onchange = () => PTB.recentAction("setEnabled", check.checked).catch(console.error);
  label.append(check, " " + t("recentRecording"));
  const hint = document.createElement("small");
  hint.textContent = t("recentHint");
  const clear = document.createElement("button");
  clear.type = "button";
  clear.textContent = t("recentClear");
  clear.disabled = !view.bookmarks.length;
  clear.onclick = () => PTB.recentAction("clear", view.game).catch(console.error);
  menu.append(label, hint, clear);
  settings.append(more, menu);
  controls.hidden = false;
  delete controls.dataset.ptbState;
  controls.replaceChildren(back, title);
  if (chooseGame) {
    const games = document.createElement("select");
    games.setAttribute("aria-label", t("profileGame"));
    for (const code of ["poe1", "poe2"]) games.add(new Option(code === "poe1" ? "PoE 1" : "PoE 2", code));
    games.value = view.game;
    games.onchange = () => chooseGame(games.value);
    controls.append(games);
  }
  controls.append(settings);
  const rows = matches ? view.bookmarks.filter(matches) : view.bookmarks;
  if (rows.length) list.replaceChildren(...rows.map(mark => buildRow(mark)));
  else {
    const empty = document.createElement("p");
    empty.className = "ptb-bm-empty";
    empty.textContent = t(view.bookmarks.length ? "recentNoMatch" : "recentEmpty");
    list.replaceChildren(empty);
  }
};
