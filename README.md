# ØIF U12 træningspas (app)

The app version of the training plan. The data still comes from the Google Sheet through Code.gs.

## Setup
1. Paste the new Code.gs into the Apps Script project, then go to Deploy → Manage deployments → edit → New version.
   "Who has access" must be **Anyone**.
2. Copy the Web app URL (ends in `/exec`) into `API_URL` near the top of the script in `index.html`.
3. Upload this folder to GitHub and turn on GitHub Pages (Settings → Pages → Deploy from branch → main, root).
4. Open the address on the phone → Share → "Føj til hjemmeskærm" (iPhone) or ⋮ → "Installer app" (Android).

## Updating
- Change the page: edit `index.html` and upload it. Phones get it the next time the app opens with a connection.
- Change the icons or manifest: also raise the number in `CACHE` in `sw.js`.
- Change Code.gs: deploy a New version of the same deployment, so the URL stays the same.
