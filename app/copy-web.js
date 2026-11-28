/* Copies the app (../index.html, the manifest and the icons) into www/, which Capacitor puts inside the iOS and
   Android apps. The app is the same file as on GitHub Pages; only the service worker is left out (the app's files
   are on the phone already). Run before "cap sync" (npm run sync does both). */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), www = path.join(__dirname, 'www');
fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(path.join(www, 'icons'), { recursive: true });
['index.html', 'manifest.webmanifest'].forEach(f => fs.copyFileSync(path.join(root, f), path.join(www, f)));
fs.readdirSync(path.join(root, 'icons')).forEach(f => fs.copyFileSync(path.join(root, 'icons', f), path.join(www, 'icons', f)));
console.log('Copied the app into www/');
