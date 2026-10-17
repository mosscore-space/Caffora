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

## Save your data to another repo (sync)

Your beans, brews, grinders and bag photos can be copied to a second GitHub repo, and loaded on any device.

1. Create a new **private** repo, for example `caffora-data`, with "Add a README" ticked. Keep it separate from the Pages repo.
2. GitHub > Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token.
   Repository access: only that data repo. Permissions: **Contents: Read and write**. Copy the token.
3. In Caffora: Settings > Backup & sync. Enter `your-name/caffora-data`, paste the token, press **Connect and sync**.
4. On another device, open the app, do the same with the same repo and token. Your data is merged in.

How it behaves:

- It syncs a few seconds after each change, when you open the app, and when you come back online. "Sync now" does it on demand.
- Each sync is one commit. The repo holds `caffora.json` (all records) and `photos/<hash>.jpg`.
- If two devices change the same bean or brew, the most recent edit wins. Deleting something on one device deletes it everywhere.
  Edits made offline are pushed when you reconnect.
- The token lives in this browser only. Because it is limited to one repo, the worst a stolen token can do is touch that repo.
- "Disconnect" only makes the device forget the token. Nothing is deleted locally or on GitHub.
- To restore after clearing a browser or getting a new phone: install the app, connect, and everything comes back.

## Passcode and Quick peek

Settings > Passcode locks the app. After that, each launch shows a lock screen with two choices:

- **Sign in to edit**: enter your passcode to add, change and delete things, and to use sync.
- **Quick peek**: a view-only mode for showing someone around. There are no add, edit or delete buttons, and Settings only offers themes.
  A bar at the top says "Viewing only" and signs you in when tapped.

"Lock when I leave the app" (Settings > Passcode) sends the app back to the lock screen after it has been out of sight for the time you choose.
The lock icon in each page header, or "Lock now" in Settings, locks it at once.

What this is, and isn't: it keeps casual snoopers from editing, and it encrypts your GitHub token with a key made from the passcode.
It does not encrypt your beans and brews on the device, so use your phone's own screen lock for that. A forgotten passcode cannot be
recovered. "Forgot passcode?" erases this device's data so you can start over, then connect GitHub again to get your data back.
Anyone who opens the hosted address on their own device only sees their own, empty copy of the app.

## Updating

The service worker serves cached files and refreshes them in the background, so a new version appears on the
second launch. To force a clean update, change `VERSION` at the top of `sw.js`.

## What's in the folder

    index.html, manifest.webmanifest, sw.js
    css/app.css                 themes (Catppuccin Latte, Frappé, Macchiato, Mocha) and all styles
    js/                         app code (no build step)
    data/lists.json             your varietals, processings, flavor notes, brew methods and countries
    data/world.topo.json        countries and regions for the map (Natural Earth, public domain)
    data/region-aliases.json    famous coffee regions mapped to map regions (Yirgacheffe, Kona, Antigua...)
    icons/                      app icons and the 60 brew-method icons
    vendor/, fonts/             d3, topojson-client, Fraunces and Figtree (bundled, so it works offline)
