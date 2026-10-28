# Working on Aurora for iPhone

## Workflow rules (requested by the owner)
- **Commit every change** as its own commit with a clear message, so any update can be rolled back. Same rules as the desktop repo (UndeadBossGames/Aurora).
- Release: bump `version` in `package.json`, add a `CHANGELOG.md` entry, commit, tag `vX.Y.Z`, push the tag. GitHub Actions (macOS) builds `Aurora-iOS-X.Y.Z.ipa` and attaches it to the Release.
- **Every GitHub release gets a nice, flashy description**: catchy title ("📱 Aurora for iPhone X.Y: <headline>"), a one-line intro, emoji section headers, **bold** feature names, and an "Installing / Updating" section.
- **Never publish to the App Store.** Distribution is the .ipa on GitHub Releases, installed with Sideloadly.
- Never rewrite published history; undo with `git revert`.

## Layout
- `web/` is a copy of the desktop `src/renderer`. Change shared UI in the desktop repo first, then run `bash scripts/sync-desktop.sh ../Aurora` and commit.
- `ios-shim/native-ios.js` implements `window.native` with Capacitor plugins (Filesystem, FilePicker, CapacitorHttp). Paths are stored relative (`docs/...`, `lib/...`) because the app container moves on reinstall.
- `ios-shim/mobile.css` + `mobile.js`: phone layout. Desktop features iOS can't support (yt-dlp downloads, Discord IPC) are hidden here.
- `ios/` is generated in CI (`npx cap add ios --packagemanager SPM` + `scripts/patch-ios.sh`); it is not committed.
