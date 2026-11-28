# Pasbygger som app (App Store og Google Play)

Appen er den samme `index.html` som på GitHub Pages, pakket med [Capacitor](https://capacitorjs.com) til iOS og
Android. Den taler stadig med det samme Google-ark gennem Apps Script, så ændringer i ark og server gælder for både
webappen og appen.

- `app/android/` og `app/ios/`: de to app-projekter (genereret af Capacitor; ret kun her, hvis det er nødvendigt).
- `app/assets/`: kilder til ikoner og startskærm. Kør `npm run icons` efter at have skiftet dem.
- `app/copy-web.js`: kopierer appen ind i `app/www/` (bruges af `npm run sync`).
- App-id: `dk.pasbygger.app` (i `capacitor.config.json`). Vælg det endelige id, før appen kommer i butikkerne:
  det kan ikke ændres bagefter.

## Prøv Android-appen nu

1. På GitHub: **Actions → Android-app → Run workflow**.
2. Når kørslen er færdig (ca. 5 minutter): hent **pasbygger-test.apk** under *Artifacts*.
3. Åbn filen på en Android-telefon og tillad installation fra ukendte kilder.

## iPhone (TestFlight)

Kræver en Mac med Xcode og en Apple Developer-konto (99 $ om året).

1. `cd app && npm ci && npm run ios` (åbner projektet i Xcode).
2. Vælg dit team under *Signing & Capabilities*.
3. *Product → Archive → Distribute App → TestFlight*.
4. Inviter dig selv som intern tester i App Store Connect.

Uden Mac kan en byggetjeneste i skyen (fx Codemagic eller GitHub Actions med en macOS-maskine) gøre det samme, men
den skal have Apples certifikat og profil.

## Google Play (intern test)

1. Opret en Google Play-udviklerkonto (25 $ én gang).
2. Lav en upload-nøgle én gang:
   `keytool -genkey -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000`.
   Gem filen og koderne et sikkert sted – uden dem kan appen ikke opdateres.
3. Gem dem på GitHub under *Settings → Secrets and variables → Actions*:
   `ANDROID_KEYSTORE_BASE64` (filen som base64: `base64 -w0 upload.jks`), `ANDROID_KEYSTORE_PASSWORD`,
   `ANDROID_KEY_ALIAS` og `ANDROID_KEY_PASSWORD`.
4. Kør **Android-app** igen og hent **pasbygger-release.aab**. Upload den under *Test → Intern test* i Play Console.

## Ny version

Ændringer i `index.html` kommer først med i appen, når den bygges og uploades igen. Hæv versionen først:
`versionCode` og `versionName` i `android/app/build.gradle` og *Version/Build* i Xcode.

## Til butikkernes formularer

- **Privatlivspolitik:** https://1shpshp1.github.io/pasbygger/privatliv.html (udfyld kontaktadressen først).
- **Dataindsamling:** navne og niveauvurderinger af spillere (indtastet af trænere), brug af appen uden id. Ingen
  sporing, ingen reklamer, intet salg af data.
- **Login til Apples gennemgang:** Apple skal have en trænerkode for at kunne prøve appen. Lav en særskilt kode til
  det (scriptegenskaben `GROUPS_PASSWORD`) og skift den bagefter.
- **Sletning af konto:** appen har ingen personlige konti, så kravet om sletning i appen gælder ikke endnu.
