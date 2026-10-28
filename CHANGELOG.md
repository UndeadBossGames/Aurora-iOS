# Changelog

Every version is a git tag. To get an older build, download its .ipa from Releases.

## v1.1.0 — 2026-10-28
- **Friends' libraries**: open a friend's profile or library from the Friends page and download any of their songs straight to your iPhone (they need Aurora open on their PC or iPhone). Songs keep their title, artist, album and cover and go to Files → Aurora → Music → From friends
- **Share your library**: friends can browse and download songs from your iPhone too. Turn it off with "Let friends browse and download my songs" on the Friends page

## v1.0.1 — 2026-10-28
- "Choose from Files" no longer filters by file type, so every song in the Files app can be picked (non-media files are skipped)

## v1.0.0 — 2026-10-28
First release of Aurora for iPhone.
- Aurora's UI in a phone layout: bottom tabs (Home, Search, Library, Together, You), a mini player, a full-screen Now Playing view with swipe-down to close, and phone-sized menus and windows
- Background playback with lock-screen controls
- Songs belong to profiles, and **Transfer songs** copies or moves them between profiles (or shares them with everyone)
- Music comes in through iTunes File Sharing, the Files app, or Library → Add music; Aurora picks up new files when it opens
- Profiles, Favorites, playlists, Store themes and effects, profile customization, Friends and Listen Together
- Cloud build: GitHub Actions builds an unsigned .ipa on macOS for every tag, ready for Sideloadly
