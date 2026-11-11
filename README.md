# Pasbygger

Training plans, a drill library and training groups for youth football coaches. The app is `index.html`
(served by GitHub Pages); its data comes from a Google Sheet through the Apps Script files in
[`apps-script/`](apps-script/).

## What is where
- `index.html`, `sw.js`, `manifest.webmanifest`, `icons/`: the app that phones open.
- `apps-script/`: the server, pasted into the sheet's Apps Script project (see its README).
- `tests/`: automated tests of the app and the server (see *Testing* below).

## Setup
1. Paste the files from `apps-script/` into the Apps Script project, then go to Deploy → Manage deployments → edit → New version.
   "Who has access" must be **Anyone**.
2. Copy the Web app URL (ends in `/exec`) into `API_URL` near the top of the script in `index.html`.
3. Upload this folder to GitHub and turn on GitHub Pages (Settings → Pages → Deploy from branch → main, root).
4. Open the address on the phone → Share → "Føj til hjemmeskærm" (iPhone) or ⋮ → "Installer app" (Android).

## Updating
- Change the page: edit `index.html` and upload it. Phones get it the next time the app opens with a connection.
- Change the icons or manifest: also raise the number in `CACHE` in `sw.js`.
- Change a file in `apps-script/`: paste it into Apps Script and deploy a New version of the same deployment,
  so the URL stays the same.
- The script's own web address (the `/exec` URL opened in a browser) forwards to the app. If the app moves to
  another address, change `APP_PAGE_URL` in `apps-script/Code.gs`.

## Testing
Run the tests before uploading a change:

```
npm install
npx playwright install chromium
npm test
```

- `tests/algorithm.test.js`: the grouping rules (bands, even sizes, the slider, Max-niveau, Kampe til sidst),
  run on the code exactly as it is in `index.html`.
- `tests/server.test.js`: the Apps Script files in a simulated Google Sheet (login, players, groups, signups).
- `tests/app.test.js`: the app in a real browser at phone size, with the server simulated.

The tests use made-up players and never touch the real sheet.
