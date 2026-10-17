# Caffora: security notes

Caffora is a set of static files plus the browser's own storage. There is no server, no database, no login endpoint and
no cookie. That removes whole families of attacks, and the rest are handled in the code or are outside what any web page
can control. This file says which is which, so nothing is claimed that isn't true.

## 1. Nothing to attack: no server-side code exists

| Threat | Status |
| --- | --- |
| SQL injection, NoSQL injection, LDAP injection | No query language is used. Data is stored as validated objects in IndexedDB. |
| Command injection, server-side template injection | No server, no shell, no template engine. |
| Path traversal | Nothing serves files from user input. The only paths the app builds (the data repo, branch and `photos/<sha>.jpg`) are checked against strict patterns first, and `../` is refused. |
| HTTP parameter pollution | The app reads no URL parameters. The route is matched against `#/word` only. |
| Credential stuffing, password spraying | There is no account system to stuff or spray. The only secret is your passcode, which is checked on your device (see Brute force below). |
| Session hijacking, cookie theft | There are no sessions and the app sets no cookies. |

## 2. Handled in the code

**Cross-site scripting and malicious JavaScript injection**
- No `innerHTML` anywhere. Everything you type or sync is shown as text, never as markup.
- A strict Content-Security-Policy in `index.html`: scripts only from this site, no inline scripts, no `eval`, no inline
  event handlers, `connect-src` limited to this site and `api.github.com`, `form-action 'none'`, `base-uri 'none'`, `object-src 'none'`.
- Trusted Types are required: in browsers that support it, any attempt to write HTML or script into the page throws. The one allowed
  policy (`caffora-sw`) can only vouch for `sw.js`.
- Because `connect-src` is limited, even injected code could not send your data to another host.

**Unicode and encoding attacks**
- All text is normalised (NFC) and stripped of control, zero-width, bidirectional-override and "tag" characters, then length-capped.
- Every record is checked on save and on import: types, ranges, dates, enums and ids. Unknown fields are dropped.
- Lookalike characters (a Cyrillic "а" for a Latin "a") cannot be told apart by any filter. They are harmless here because names are only ever displayed.

**Data coming back from GitHub is treated as hostile**
- The repo file is validated like user input. `__proto__`/`constructor` keys are ignored, bad tombstones are dropped, invalid records are skipped.
- Photos must be real JPEGs under 4 MB, named by their own hash. Anything else is ignored.
- The sync token must be a fine-grained token. Classic tokens (they reach every repo you own) are refused.

**Supply chain**
- There is no build step, no npm at runtime and no CDN. The only third-party code is two vendored files:
  - `vendor/d3.min.js` sha256 `f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539`
  - `vendor/topojson-client.min.js` sha256 `25cd02ae486cc5063e0215a4e4cfb15de83700c87ac48bac4d57dc6aaf3ebb89`
- Verify them any time with `sha256sum vendor/*`. Do not add scripts from other hosts: the CSP will block them.

**Man-in-the-middle and adversary-in-the-middle**
- The app redirects to HTTPS and sets `upgrade-insecure-requests`. Turn on "Enforce HTTPS" in the Pages settings.
- The GitHub token is only ever sent to `https://api.github.com`, with credentials omitted and no referrer.
- A lookalike (phishing) site is the same risk as a MITM. See Phishing below.

**Brute force and guessing**
- Passcode: at least 12 characters, with a check against common and patterned choices.
- PBKDF2-SHA256 with 600,000 rounds turns the passcode into a key. The token is sealed with AES-GCM, so a wrong passcode fails authentication.
- On screen, five wrong tries start a wait that grows with each batch and survives a reload.
- **The honest limit:** the `caffora.config.json` file on your site is public, so someone can download it and guess offline,
  with no limit on tries. Only the strength of your passcode stops that. Four random words (for example "river lamp orbit cedar")
  would take one high-end graphics card centuries. A word you'd find in a dictionary would not survive an hour.
  Never reuse this passcode anywhere else.

**Phishing and credential harvesting**
- The lock screen prints the address it is running on ("Only enter your passcode at ..."). Check it.
- Install the app to your home screen and open it from there, rather than from links in messages.
- The token is typed in exactly one place, Settings, and never on the lock screen. A real Caffora never asks for your GitHub password.
- No web page can stop someone building a lookalike. A passkey login would be the next step if you want phishing-proof sign-in.

**Shoulder surfing**
- The passcode box hides what you type. Quick peek is view-only. Auto-lock re-locks the app, and a privacy screen covers the app
  while it is in the background, so the phone's app switcher shows nothing.

**Clickjacking**
- The page refuses to run inside a frame (GitHub Pages cannot send `X-Frame-Options`, so the page checks for itself).

**Clipboard theft**
- The app never writes to the clipboard and only reads what you paste into a field.

## 3. Cannot be stopped from inside a web page

Keyloggers, form grabbers, infostealer malware, remote-access trojans and malicious browser extensions work on the
device or the browser, underneath any page. A web page cannot see them or block them, and anyone who says their website can is wrong.
What Caffora does to limit the damage if one gets in:

- The token is encrypted on the device and is in memory only while you are signed in.
- A fine-grained token can only touch the one data repo, so a stolen token cannot reach your other code or your site.
- The data repo is a git repo: a tampered file can be rolled back from its history.

What you can do:

- Create the token with an expiry (90 days) and a calendar reminder to replace it.
- Keep the device and browser updated, install extensions only from people you trust, and consider a separate browser
  profile with no extensions for Caffora.
- Turn on two-factor authentication or a passkey for your GitHub account.
- For the Pages repo: protect the `main` branch and review changes. Never give the token access to it.

## 4. Known limits

- Beans and brews are not end-to-end encrypted, on the device or in the repo. A private repo protects them, and your phone's
  screen lock protects the device. The passcode keeps people from using or changing the app, not from reading browser storage
  with developer tools on an unlocked machine.
- A forgotten passcode cannot be recovered (by design).
