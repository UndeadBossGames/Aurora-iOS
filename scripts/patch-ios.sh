#!/usr/bin/env bash
# Runs on macOS (GitHub Actions) right after `npx cap add ios`.
# Adds what Aurora needs on top of Capacitor's stock iOS project.
set -euo pipefail
cd "$(dirname "$0")/.."
APP=ios/App/App
PLIST="$APP/Info.plist"
PB=/usr/libexec/PlistBuddy
set_key() { $PB -c "Delete :$1" "$PLIST" >/dev/null 2>&1 || true; $PB -c "Add :$1 $2 $3" "$PLIST"; }

# Name on the home screen
set_key CFBundleDisplayName string Aurora
# Music keeps playing with the screen locked or in another app
$PB -c "Delete :UIBackgroundModes" "$PLIST" >/dev/null 2>&1 || true
$PB -c "Add :UIBackgroundModes array" "$PLIST"
$PB -c "Add :UIBackgroundModes:0 string audio" "$PLIST"
# Aurora's folder shows up in iTunes/Finder File Sharing and in the Files app
set_key UIFileSharingEnabled bool true
set_key LSSupportsOpeningDocumentsInPlace bool true
# Light status bar on the dark UI
set_key UIStatusBarStyle string UIStatusBarStyleLightContent
set_key UIViewControllerBasedStatusBarAppearance bool false
set_key ITSAppUsesNonExemptEncryption bool false
# Phone layout is portrait
$PB -c "Delete :UISupportedInterfaceOrientations" "$PLIST" >/dev/null 2>&1 || true
$PB -c "Add :UISupportedInterfaceOrientations array" "$PLIST"
$PB -c "Add :UISupportedInterfaceOrientations:0 string UIInterfaceOrientationPortrait" "$PLIST"

# Background audio needs the "playback" audio session
DELEGATE="$APP/AppDelegate.swift"
if ! grep -q AVAudioSession "$DELEGATE"; then
  perl -0pi -e 's/import UIKit\n/import UIKit\nimport AVFoundation\n/' "$DELEGATE"
  perl -0pi -e 's/(didFinishLaunchingWithOptions[^{]*\{\n)/$1        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)\n        try? AVAudioSession.sharedInstance().setActive(true)\n/' "$DELEGATE"
fi
grep -q 'setCategory(.playback' "$DELEGATE" || { echo "patch-ios: could not add the audio session to AppDelegate.swift" >&2; exit 1; }

# App icon and launch screen
ICONSET="$APP/Assets.xcassets/AppIcon.appiconset"
for f in "$ICONSET"/*.png; do cp assets/AppIcon-1024.png "$f"; done
SPLASH="$APP/Assets.xcassets/Splash.imageset"
if [ -d "$SPLASH" ]; then for f in "$SPLASH"/*.png; do cp assets/splash-2732.png "$f"; done; fi

echo "patch-ios: done"
$PB -c Print "$PLIST" | head -60
