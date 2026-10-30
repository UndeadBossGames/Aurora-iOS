// Builds www/ (what Capacitor ships inside the iPhone app) from web/ (Aurora's shared UI)
// plus the iPhone layer in ios-shim/. No dependencies, runs with plain Node.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const www = path.join(root, 'www');

fs.rmSync(www, { recursive: true, force: true });
fs.cpSync(path.join(root, 'web'), www, { recursive: true });
fs.cpSync(path.join(root, 'ios-shim'), path.join(www, 'ios'), { recursive: true });

const file = path.join(www, 'index.html');
let html = fs.readFileSync(file, 'utf8');
const csp = "default-src 'self' capacitor: data: blob:; img-src * data: blob: capacitor:; media-src * data: blob: capacitor:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src * data: blob: capacitor:; frame-src https:";
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, `<meta http-equiv="Content-Security-Policy" content="${csp}" />`);
html = html.replace('<meta charset="utf-8" />', '<meta charset="utf-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />\n  <meta name="apple-mobile-web-app-capable" content="yes" />\n  <meta name="color-scheme" content="dark" />\n  <meta name="format-detection" content="telephone=no" />');
html = html.replace('<link rel="stylesheet" href="css/theme-aurora.css" />', '<link rel="stylesheet" href="css/theme-aurora.css" />\n  <link rel="stylesheet" href="ios/mobile.css" />\n  <link rel="stylesheet" href="ios/spot.css" />');
html = html.replace('<script src="js/icons.js"></script>', `<script>window.AURORA_IOS_VERSION = ${JSON.stringify(pkg.version)};</script>\n  <script src="ios/native-ios.js"></script>\n  <script src="ios/downloader-ios.js"></script>\n  <script src="js/icons.js"></script>`);
html = html.replace('<script src="js/app.js"></script>', '<script src="js/app.js"></script>\n  <script src="ios/mobile.js"></script>\n  <script src="ios/spot-core.js"></script>\n  <script src="ios/spot-views.js"></script>\n  <script src="ios/spot-player.js"></script>');
html = html.replace('<body>', '<body class="is-ios mobile">');
for (const must of ['ios/downloader-ios.js', 'ios/native-ios.js', 'ios/mobile.js', 'ios/mobile.css', 'ios/spot.css', 'ios/spot-core.js', 'ios/spot-views.js', 'ios/spot-player.js', 'viewport-fit']) if (!html.includes(must)) throw new Error('build-www: could not inject ' + must);
fs.writeFileSync(file, html);
console.log(`www/ ready (Aurora for iPhone ${pkg.version})`);
