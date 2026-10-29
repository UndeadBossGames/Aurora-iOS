# Changelog

Every version is a git tag. To get an older build, download its .ipa from Releases.

## v1.3.0 — 2026-10-29
- **Much faster downloads**: the slow part was yt-dlp downloading in Python over a single connection (and YouTube throttles single connections). Now yt-dlp only finds the media and the app downloads it natively with iOS's own networking, in 4 MB pieces over up to 8 connections per file (video and audio at the same time), so downloads run at your full Wi-Fi or 5G speed. Shows live speed and time left. If a site doesn't allow it, Aurora falls back to the old way automatically
- **Aurora Account**: sign in with the same account name and password as on your PC (Search → Aurora Account, or the button on your profile). Your profile, Favorites, playlists and look come over to the iPhone, and stay in sync both ways
- **Songs from your PC**: the Account page lists every song on your PC that isn't on the iPhone yet. Download one or all, or turn on automatic downloads. Songs copy straight from the PC (full Wi-Fi speed on the same network) or download again from YouTube/SoundCloud when the PC is off
- End-to-end encrypted with a key made from your name and password; the password is never stored or sent. No password reset, so keep it safe

## v1.2.0 — 2026-10-28
- **Video Downloader on iPhone**: paste a link from YouTube, SoundCloud, Spotify, Vimeo, TikTok and 1000+ other sites and save it as video or music, right on the phone. yt-dlp runs inside the app (embedded Python), and best-quality videos are joined with iOS's own AVFoundation, so no computer is needed
- **Fast, uncapped downloads**: no speed limit, 8 parallel pieces per video, 5 downloads at once, and playlists are split so their songs download side by side. Downloads keep going for a while if you leave the app
- **Discover** works on iPhone too: search YouTube or SoundCloud, preview, and download
- **Listen Together on iPhone**: if you don't have the host's song, Aurora gets it straight from the host's PC or phone (over Wi-Fi when you're on the same network), or downloads it, and starts in sync
- **Wi-Fi fast path**: songs from a PC on the same Wi-Fi copy directly at full network speed (friends' libraries and Listen Together)
- **iOS polish**: haptic feedback, long-press menus, swipe from the left edge to go back, swipe gestures on the full-screen player, iOS-style action sheets, a tab bar that steps aside for the keyboard, and aurora:// links so Shortcuts and other apps can send a link to download
- Share sheet / Shortcuts: open `aurora://download?url=<link>` to start a download

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
