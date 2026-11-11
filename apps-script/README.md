# Apps Script (the server)

These files run in the Google Sheet's Apps Script project (Extensions → Apps Script). They are kept here
for history and for the tests; GitHub does not run them. After changing one, paste it into the Apps Script
editor and deploy a **New version** of the same deployment (Deploy → Manage deployments → Edit).

| File | What it does |
|---|---|
| Code.gs | The app's API (training plan, drill library, login), and the script's own web address, which forwards to the app |
| Grupper.gs | Training groups: players, saved groups and signups (tabs Spillere, Grupper, Tilmeldte) |
| Statistik.gs | Usage statistics (tab Statistik) |
| Kampnaerhed.gs | Suggests and applies the Kampnærhed rating of drills |
| FaImport.gs, TiimImport.gs, TiimDanish.gs, FckImport.gs, FckData.gs | Importers for England Football, NFF (tiim.no) and FCK drills |
| FokusForslag.gs, FokusTrim.gs, TagReport.gs, TagStructure.gs | Tools for tidying the drills' tags |

**Not in this repository:** the importers' data files (FaData1–11, TiimData1–4, TiimDA1–3) contain the
drills' texts from England Football and NFF. The repository is public, so they stay only in the Apps Script
project. The passwords are not in any file: they are Script Properties (DRILLS_PASSWORD, and optionally
GROUPS_PASSWORD).
