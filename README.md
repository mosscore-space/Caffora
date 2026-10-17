# Caffora

A coffee journal as an installable, offline-first web app (PWA): Brews, Beans, Grinders, Stats, Map and Settings.
Everything is stored on the device (IndexedDB). There is no server and no account. Optionally, it syncs to a GitHub repo of your own (see below).

## Run it

PWAs and ES modules need http(s), so don't open `index.html` from the file system.

    cd caffora
    python3 -m http.server 8080        # or: npx serve .
    # open http://localhost:8080

## Put it online (so you can install it on your phone)

Upload the folder as-is to any static HTTPS host (Netlify drop, GitHub Pages, Cloudflare Pages).
All paths are relative, so it works at the site root or in a sub-folder.

- Android / Chrome: open the site, then menu > Install app.
- iPhone / Safari: Share > Add to Home Screen.
- Desktop Chrome / Edge: install icon in the address bar.

After the first load it works fully offline, including the map.

## Host the app on GitHub Pages

1. Create a repo for the app (public is fine, it holds no personal data), upload the contents of this folder to its root, and commit.
2. Repo > Settings > Pages > Deploy from a branch > `main` / `/ (root)`. Your app will be at `https://<you>.github.io/<repo>/`.
3. Open that address on your phone and install it (see above).

## Set it up once, then open it from any browser

1. **Host the app** on GitHub Pages (above). Turn on "Enforce HTTPS" in the Pages settings.
2. **Make a data repo.** Create a new **private** repo, for example `caffora-data`, with "Add a README" ticked.
3. **Make a token.** GitHub > Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token.
   Repository access: only the data repo. Permissions: **Contents: Read and write**. Set an expiry. Classic tokens are refused.
4. **Connect.** In Caffora, open Settings > Backup & sync, enter `your-name/caffora-data`, paste the token, press Connect and sync.
5. **Set a passcode.** Settings > Passcode (12+ characters, ideally four random words).
6. **Export the sign-in file.** Settings > Open it from any browser > Download `caffora.config.json`. Upload that file to the root of
   your Pages repo (Add file > Upload files, next to `index.html`) and commit.

From then on, opening your site on any browser or device goes straight to the lock screen. Enter the passcode and your data loads
from GitHub. The file only holds the repo name and your token encrypted with the passcode. Read `SECURITY.md` for what that does and
does not protect. If you change the passcode or the token, Settings will say the file is out of date; download and upload it again.

How sync behaves:

- It syncs a few seconds after each change, when you open the app, and when you come back online. "Sync now" does it on demand.
  Each sync is one commit; the repo holds `caffora.json` and `photos/<hash>.jpg`.
- Syncing merges the two sides. If two devices change the same bean or brew, the most recent edit wins. Deleting something on one
  device deletes it everywhere. Edits made offline are pushed when you reconnect.
- "Disconnect" only makes the device forget the token. Nothing is deleted locally or on GitHub.

## Passcode and Quick peek

Settings > Passcode locks the app. After that, each launch shows a lock screen with two choices:

- **Sign in to edit**: enter your passcode to add, change and delete things, and to use sync. On a browser that has never seen your
  data, this is also what loads it from GitHub.
- **Quick peek**: a view-only mode for showing someone around. There are no add, edit or delete buttons, and Settings only offers themes.
  A bar at the top says "Viewing only" and signs you in when tapped.

"Lock when I leave the app" (Settings > Passcode) sends the app back to the lock screen after it has been out of sight for the time you choose.
On a phone, the menu (three dots, top right) has Lock now, Sync now and Settings.

What this is, and isn't: it keeps casual snoopers from editing, and it encrypts your GitHub token with a key made from the passcode.
It does not encrypt your beans and brews on the device, so use your phone's own screen lock for that. A forgotten passcode cannot be
recovered. "Forgot passcode?" erases this device's data so you can start over, then connect GitHub again to get your data back.
Anyone who opens the hosted address on their own device only sees their own, empty copy of the app.

## Updating

The service worker serves cached files and refreshes them in the background, so a new version appears on the
second launch. To force a clean update, change `VERSION` at the top of `sw.js`.

## Phone layout and themes

Below 900 px wide the app switches to a phone layout: a centred title bar with search and a menu, accent-striped cards,
and a five-tab bottom bar (Settings moves into the menu). Themes (Settings): Espresso (default on phones), Matcha, Mocha
(default on larger screens), Macchiato, Frappé, Latte, and Match device.

## What's in the folder

    index.html, manifest.webmanifest, sw.js
    css/app.css                 themes (Catppuccin Latte, Frappé, Macchiato, Mocha) and all styles
    js/                         app code (no build step; validate.js cleans all data, auth.js and sync.js do sign-in and GitHub)
    SECURITY.md                 what is protected, how, and what no web page can protect
    data/lists.json             your varietals, processings, flavor notes, brew methods and countries
    data/world.topo.json        countries and regions for the map (Natural Earth, public domain)
    data/region-aliases.json    famous coffee regions mapped to map regions (Yirgacheffe, Kona, Antigua...)
    icons/                      app icons and the 60 brew-method icons
    vendor/, fonts/             d3, topojson-client, Fraunces and Figtree (bundled, so it works offline)
