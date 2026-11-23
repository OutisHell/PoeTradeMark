---
title: PoE Trade Mark Privacy Policy
permalink: /
---

# Privacy policy — PoE Trade Mark

PoE Trade Mark is a Chrome extension for bookmarking official Path of Exile and Path of Exile 2 trade searches.

**Last updated:** 2026-11-24

## What data is stored

Bookmarks you save (title, trade URL parts, filter descriptions, icons, optional lowest price), their groups and display order, and your language, preferred trade site, and rate-table preferences are stored in Chrome’s local extension storage on your computer (`chrome.storage.local`). Chrome stores your preferred trade site locally as a redirect rule when you enable automatic redirection.

In versions with **Recent searches**, the extension automatically remembers completed searches on supported PoE trade pages in regular windows. This is enabled by default. Each record includes the time, trade site, game, league, search link and a bookmark summary, which can include the search title, filter conditions, item icon and observed price. Search links can contain values you entered in the trade form. Recent searches stay in this Chrome profile. The extension does not read Chrome’s browsing history, record searches from incognito windows or send recent searches to a server.

The recent searches list shows up to 30 entries per game from the past seven days, with a 256 KiB storage limit per game. In version 1.1.1 and later, visiting a supported trade page in a regular window clears expired entries for both games. Opening a game’s recent searches also clears its expired entries. If you stop using the trade site and recent searches, expired entries may remain on this device until your next visit. Open **Recent searches** to clear one game’s history or turn recording off and clear both games. Promoting a search moves it into your selected bookmark collection, where it stays until you delete it.

Exporting saves the bookmark collection you select. Versions with share codes can also copy a collection to the clipboard at your request. Someone you share a collection with can read its search links, saved filters and the names you gave your bookmarks, groups and collections. Recent search history is excluded. Importing reads the file or code you choose into your local extension storage.

Saving current trade settings records the country, league and trade mode locally. Each game has its own league and trade mode preferences.

Nothing is uploaded to us. There is no account, no analytics, and no advertising.

We use search data only to provide the extension’s trade-search features, in accordance with the [Chrome Web Store User Data Policy, including its Limited Use requirements](https://developer.chrome.com/docs/webstore/program-policies/limited-use).

## Network requests

When you save a bookmark, the extension can infer its title color from listings the trade page has already loaded. It keeps rarities and matching search and result IDs temporarily in tab memory. Saving uses this local data and sends no additional trade search or listing request.

The extension requests the league list for the selected game from the official Korean trade site. It caches the response locally for one hour and can reuse the last list if a refresh fails.

The extension reads the official trade site in your browser (Korea, global Path of Exile, and Taiwan). It fetches currency exchange rates from [poe.ninja](https://poe.ninja/) so listings can be converted. Those requests do not include your bookmarks.

## Permissions

- **storage / unlimitedStorage** — save bookmarks and settings on this device.
- **tabs** — open a saved search in the current tab or a new tab when you click jump.
- **declarativeNetRequestWithHostAccess** — Chrome redirects supported trade pages to your chosen site and applies your league and trade mode preferences to item searches.
- **Host access** to Path of Exile trade sites and poe.ninja — inject the sidebar on trade pages and load rates.

## Contact

[PoE Trade Mark on GitHub](https://github.com/OutisHell/PoeTradeMark)
