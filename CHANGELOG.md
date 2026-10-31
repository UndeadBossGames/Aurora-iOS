# Changelog

Every version is a git tag. To get an older build, download its .ipa from Releases.

## v1.4.0 — 2026-10-30
- **New iPhone layout**, modelled on the standard streaming-app design for iPhone:
  - **Tab bar** with Home, Search, Your Library, Store and Create (+).
  - **Home**: your avatar and All / Music / Videos / Friends filters on top, 8 quick shortcuts, then Jump back in, Recents, Your top mixes, Recommended Stations, albums featuring songs you like, your playlists, a big video card, recently added and your favorite artists.
  - **Search**: a white search box, browse tiles, Discover something new and Browse all. Searching gives live suggestions, results with add buttons, and recent searches you can remove or clear. One tap searches YouTube and SoundCloud.
  - **Your Library**: Playlists / Albums / Artists / Downloaded / Videos filters, sort (Recents, Recently added, Alphabetical, Creator), list or grid view, search, pins.
  - **Side menu**: tap your avatar (or swipe from the left edge) for your profile, Add profile, Listening stats, Recents, Your Updates, Aurora Account, Settings, friends' activity and Listen Together.
  - **Create menu**: Playlist, Listen Together, Download and Add from Files.
  - **Profile page** with a colored header, Edit, share your friend code, settings, your playlists (Manage, See all playlists) and recently played artists.
  - **Playlist and album pages**: big cover, colored header, find in playlist, sort, shuffle and a green play button, Add to this playlist, and recommended songs. Albums are now browsable.
  - **Artist pages**: a big header photo, Follow, Popular songs with your play counts, Popular Releases, Featuring, the artist's radio, Fans also like, Videos and About.
  - **Mini player** tinted with the album's color, showing where it's playing (This iPhone or AirPlay), with add-to-Favorites and play buttons and a thin progress line.
  - **Full-screen player**: "Playing from" header, big artwork (or the video), scrubber, shuffle and repeat, AirPlay picker, share and queue. Underneath it has a Lyrics preview, About the artist, Credits, Up next and More by the artist.
- **Lyrics**: synced lyrics that highlight as the song plays (tap a line to jump there), from the free LRCLIB lyrics database, saved for offline use.
- **Queue**: see Now playing, Next in queue (clear it or remove songs) and Next from the playlist. Swipe right on any song to add it to the queue.
- **Sleep timer** (5 minutes to 1 hour, or end of song) and **playback speed** (0.5× to 2×).
- **Song radio and mixes** made from your own library, plus **Listening stats** (minutes, plays, top artists and songs) and **Recents** by day.
- Song menus are now bottom sheets: Add to playlist, Favorites, queue, radio, Go to artist or album, Share, Credits, Edit, Delete.
- **Silent endings are cut automatically** from new downloads, so songs stop when the music stops. Settings → Downloads → Fix now cleans up songs you already have.
- **Proper cover art**: downloads get the official album cover (from Apple Music's catalog, or Deezer), plus the real song title, artist and album when the match is clear. When there's no official cover, the YouTube thumbnail is cleaned up: black bars and channel logos are cut off, and video frames are placed on a blurred square background. The lock screen, Control Center and every tile now show a clean square picture. Songs already in your library are fixed automatically in the background.
- **Search for any song from the Search tab**: below your own songs, results from YouTube or SoundCloud appear as you type. Tap one to download it as a song or as a video, with progress right on the row.
- **Tap a song to play it** everywhere (the classic layout needed a double tap).
- Prefer the old look? Settings → Appearance → iPhone layout → Classic.

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
