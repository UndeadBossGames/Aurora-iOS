# 🌌 Aurora for iPhone

Aurora, the music player, on your iPhone. Same look, same profiles, same Store themes as [Aurora for PC](https://github.com/UndeadBossGames/Aurora), rebuilt for a phone: a bottom tab bar, a mini player and a full-screen Now Playing view.

> **Not on the App Store.** Aurora for iPhone is installed from your PC with Sideloadly. See **[docs/INSTALL-iPhone.md](docs/INSTALL-iPhone.md)**.

| | |
|---|---|
| **Phone layout** | Home, Search, Library, Together and You tabs. Tap the mini player for the full-screen player; swipe down to close it. |
| **Background playback** | Music keeps playing with the screen locked, with lock-screen controls. |
| **Profiles** | Every profile has its own songs, Favorites, playlists and look. |
| **Transfer songs** | Copy or move downloaded songs from one profile to another, or share them with every profile (You → your profile → Transfer songs). |
| **Get music on** | iTunes File Sharing from your PC, the Files app, or "Add music" in the Library. Anything in *Files → On My iPhone → Aurora* is picked up automatically. |
| **Listen Together & Friends** | Join your friends' sessions from your phone and hear the same song at the same second. |
| **Store** | All 15 themes, fonts, profile effects and player effects. |

Link downloads (YouTube, SoundCloud…) and Discord Connection need Aurora for PC: iOS doesn't allow the tools they use.

## How it's built
- `web/`: Aurora's UI, copied from the desktop repo with `bash scripts/sync-desktop.sh ../Aurora`.
- `ios-shim/`: the iPhone layer. `native-ios.js` gives the UI the same `window.native` API Electron gives it on Windows (files, settings, artwork), and `mobile.css` / `mobile.js` make the phone layout.
- `scripts/build-www.js` combines them into `www/`, which [Capacitor](https://capacitorjs.com) wraps in a native iOS app.
- `.github/workflows/ios.yml` builds an unsigned `Aurora-iOS-x.y.z.ipa` on GitHub's macOS servers for every tag (no Mac needed) and attaches it to the Release. Sideloadly signs it with your own Apple ID when you install it.
