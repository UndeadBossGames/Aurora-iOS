// Aurora for iPhone: native music playback, the way Spotify does it.
//
// The web player can't keep playing reliably once the app is in the background (iOS suspends web
// pages), so songs play through AVQueuePlayer instead. The app sends the song plus the next ones
// in line; this engine then works on its own: it moves on to the next song, keeps the lock screen /
// Control Center / CarPlay "Now Playing" card up to date, and answers AirPods, headphone and
// lock-screen controls (play, pause, skip, back, scrub) even while the app is closed. The web UI
// is told what happened and catches up when it's back.
//
// Also: smooth live scrubbing (seeks are coalesced so dragging the bar plays as it moves),
// phone-call/Siri interruptions (resume afterwards) and "headphones unplugged = pause".
import Foundation
import Capacitor
import AVFoundation
import MediaPlayer
import UIKit
import UserNotifications
import AVKit
import CoreImage

@objc(AuroraAudioPlugin)
public class AuroraAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AuroraAudioPlugin"
    public let jsName = "AuroraAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "loadItem", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seek", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setQueue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "standDown", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "state", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signing", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remind", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "route", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setIcon", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "voices", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "djVoice", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "qr", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getIcon", returnType: CAPPluginReturnPromise),
    ]

    struct Item {
        let key: String
        let url: URL
        let title: String
        let artist: String
        let album: String
        let art: String
        let end: Double       // where the sound stops (silent ending that couldn't be cut), 0 = whole file
        let duration: Double
        let intro: String       // the DJ's line before this song (spoken on-device)
        let introAudio: String  // or a ready-made recording of it (e.g. an ElevenLabs voice)

        init?(_ o: [String: Any]) {
            guard let key = o["key"] as? String, let u = o["url"] as? String, let url = AuroraAudioPlugin.fileURL(u) else { return nil }
            self.key = key
            self.url = url
            title = o["title"] as? String ?? ""
            artist = o["artist"] as? String ?? ""
            album = o["album"] as? String ?? ""
            art = o["art"] as? String ?? ""
            end = (o["end"] as? NSNumber)?.doubleValue ?? 0
            duration = (o["duration"] as? NSNumber)?.doubleValue ?? 0
            intro = o["intro"] as? String ?? ""
            introAudio = o["introAudio"] as? String ?? ""
        }
    }

    private let player = AVQueuePlayer()
    private var current: Item?
    private var currentPI: AVPlayerItem?
    private var nextUp: (item: Item, pi: AVPlayerItem)?
    private var upcoming: [Item] = []
    private var history: [Item] = []
    private var repeatOne = false
    private var rate: Float = 1
    private var wantPlay = false
    private var resumeAfterInterruption = false
    private var lastPlaying: Bool?
    private var seeking = false
    private var pendingSeek: Double?
    private var timeObs: Any?
    private var endObs: Any?
    private var statusObs: NSKeyValueObservation?
    private var controlObs: NSKeyValueObservation?
    private var commandsOn = false
    private var artwork: (key: String, art: MPMediaItemArtwork)?
    private var musicVolume: Float = 1
    private let speech = AVSpeechSynthesizer()
    private var voicePlayer: AVAudioPlayer?
    private var djVoiceId = ""
    private var djRate: Float = 0.52
    private var speaking = false
    private var speechDelegate: SpeechDelegate?

    // MARK: setup

    override public func load() {
        player.automaticallyWaitsToMinimizeStalling = false
        player.actionAtItemEnd = .advance
        timeObs = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main) { [weak self] _ in
            self?.tick()
        }
        controlObs = player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async { self?.stateChanged() }
        }
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(itemEnded(_:)), name: .AVPlayerItemDidPlayToEndTime, object: nil)
        nc.addObserver(self, selector: #selector(itemFailed(_:)), name: .AVPlayerItemFailedToPlayToEndTime, object: nil)
        nc.addObserver(self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        nc.addObserver(self, selector: #selector(routeChanged(_:)), name: AVAudioSession.routeChangeNotification, object: nil)
        nc.addObserver(self, selector: #selector(becameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        DispatchQueue.main.async { self.setupCommands() }
    }

    private func activateSession() {
        let s = AVAudioSession.sharedInstance()
        // .longFormAudio = music/podcast app routing (AirPlay, CarPlay, AirPods hand-off), like Spotify
        if s.category != .playback || s.routeSharingPolicy != .longFormAudio {
            try? s.setCategory(.playback, mode: .default, policy: .longFormAudio, options: [])
        }
        try? s.setActive(true)
    }

    /// capacitor://localhost/_capacitor_file_/var/... -> file:///var/...
    static func fileURL(_ s: String) -> URL? {
        var str = s
        if let q = str.firstIndex(of: "?"), str.contains("_capacitor_file_") { str = String(str[..<q]) }
        if let r = str.range(of: "/_capacitor_file_") {
            let p = String(str[r.upperBound...])
            return URL(fileURLWithPath: p.removingPercentEncoding ?? p)
        }
        if str.hasPrefix("/") { return URL(fileURLWithPath: str) }
        return URL(string: str)
    }

    private func emit(_ type: String, _ data: [String: Any] = [:]) {
        var ev = data
        ev["type"] = type
        notifyListeners("audio", data: ev)
    }

    private var inForeground: Bool { UIApplication.shared.applicationState == .active }
    private var now: Double { let t = player.currentTime().seconds; return t.isFinite ? max(0, t) : 0 }
    private var length: Double {
        let d = currentPI?.duration.seconds ?? 0
        let full = d.isFinite && d > 0 ? d : (current?.duration ?? 0)
        if let e = current?.end, e > 0, full > 0, e < full - 0.5 { return e }
        return full
    }
    private var isPlaying: Bool { player.timeControlStatus != .paused || (player.rate != 0) }

    // MARK: JS API

    @objc func loadItem(_ call: CAPPluginCall) {
        var opts: [String: Any] = [:]
        for (k, v) in call.options ?? [:] { if let key = k as? String { opts[key] = v } }
        guard let item = Item(opts) else { call.reject("Bad item"); return }
        let startAt = call.getDouble("startAt") ?? 0
        let play = call.getBool("play") ?? false
        DispatchQueue.main.async {
            if let c = self.current, c.key != item.key { self.pushHistory(c) }
            self.setCurrent(item, startAt: startAt, play: play)
            call.resolve()
        }
    }

    @objc func play(_ call: CAPPluginCall) { DispatchQueue.main.async { self.doPlay(); call.resolve() } }
    @objc func pause(_ call: CAPPluginCall) { DispatchQueue.main.async { self.doPause(); call.resolve() } }

    @objc func seek(_ call: CAPPluginCall) {
        let t = call.getDouble("time") ?? 0
        let scrub = call.getBool("scrub") ?? false
        DispatchQueue.main.async { self.seek(to: t, scrub: scrub); call.resolve() }
    }

    @objc func setRate(_ call: CAPPluginCall) {
        let r = Float(call.getDouble("rate") ?? 1)
        DispatchQueue.main.async {
            self.rate = r > 0 ? r : 1
            if #available(iOS 16.0, *) { self.player.defaultRate = self.rate }
            if self.isPlaying { self.player.rate = self.rate }
            self.updateNowPlaying()
            call.resolve()
        }
    }

    @objc func setVolume(_ call: CAPPluginCall) {
        let v = Float(call.getDouble("volume") ?? 1)
        DispatchQueue.main.async { self.musicVolume = max(0, min(1, v)); if !self.speaking { self.player.volume = self.musicVolume }; call.resolve() }
    }

    /// The songs that come after the current one (already in play order, shuffle included).
    @objc func setQueue(_ call: CAPPluginCall) {
        let raw = (call.getArray("items") ?? []).compactMap { $0 as? [String: Any] }
        let items = raw.compactMap { Item($0) }
        let one = call.getBool("repeatOne") ?? false
        DispatchQueue.main.async {
            self.upcoming = items
            self.repeatOne = one
            self.player.actionAtItemEnd = one ? .none : .advance
            self.prepareNext()
            call.resolve()
        }
    }

    /// A video is playing in the web player instead: step aside so the two don't fight over controls.
    @objc func standDown(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.wantPlay = false
            self.player.pause()
            self.player.removeAllItems()
            self.removeEndBoundary()
            self.current = nil; self.currentPI = nil; self.nextUp = nil; self.upcoming = []
            self.setCommands(false)
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            call.resolve()
        }
    }

    @objc func state(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(self.snapshot()) }
    }

    private func snapshot() -> [String: Any] {
        ["key": current?.key ?? "", "time": now, "duration": length, "playing": isPlaying]
    }

    // MARK: playback

    private func makeItem(_ it: Item) -> AVPlayerItem {
        let pi = AVPlayerItem(url: it.url)
        pi.audioTimePitchAlgorithm = .timeDomain   // sped-up/slowed-down speech and music still sound natural
        return pi
    }

    private func setCurrent(_ it: Item, startAt: Double, play: Bool) {
        // only take over the audio when actually playing: just opening Aurora mustn't stop a podcast
        if play { activateSession() }
        setCommands(true)
        player.pause()
        player.removeAllItems()
        nextUp = nil
        let pi = makeItem(it)
        current = it
        currentPI = pi
        watch(pi)
        player.insert(pi, after: nil)
        installEndBoundary()
        if startAt > 0.05 { player.seek(to: CMTime(seconds: startAt, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) }
        wantPlay = play
        if play { player.playImmediately(atRate: rate) }
        prepareNext()
        updateNowPlaying()
        loadArtwork(it)
        if play { introduce(it) }
    }

    private func watch(_ pi: AVPlayerItem) {
        statusObs = pi.observe(\.status, options: [.new]) { [weak self] item, _ in
            DispatchQueue.main.async {
                guard let self = self, item === self.currentPI else { return }
                if item.status == .readyToPlay {
                    self.emit("loaded", ["key": self.current?.key ?? "", "duration": self.length])
                    self.updateNowPlaying()
                } else if item.status == .failed {
                    self.emit("error", ["key": self.current?.key ?? "", "message": item.error?.localizedDescription ?? "Can't play this file"])
                }
            }
        }
    }

    private func doPlay() {
        guard let it = current else { emit("remote", ["cmd": "play"]); return }
        activateSession()
        if player.currentItem == nil { setCurrent(it, startAt: 0, play: true); return }
        if length > 0 && now >= length - 0.2 { player.seek(to: .zero) }
        wantPlay = true
        player.playImmediately(atRate: rate)
        updateNowPlaying()
    }

    private func doPause() {
        wantPlay = false
        player.pause()
        updateNowPlaying()
    }

    /// Seeks are coalesced: while one is running, only the newest target is kept, so dragging the
    /// bar keeps playing from wherever the finger is instead of queuing up hundreds of jumps.
    private func seek(to t: Double, scrub: Bool) {
        if seeking { pendingSeek = t; return }
        seeking = true
        let tol = scrub ? CMTime(seconds: 0.04, preferredTimescale: 600) : .zero
        player.seek(to: CMTime(seconds: max(0, t), preferredTimescale: 600), toleranceBefore: tol, toleranceAfter: tol) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.seeking = false
                if let p = self.pendingSeek { self.pendingSeek = nil; self.seek(to: p, scrub: scrub); return }
                self.updateNowPlaying()
                self.emit("seeked", ["time": self.now])
            }
        }
    }

    private func pushHistory(_ it: Item) {
        history.append(it)
        if history.count > 100 { history.removeFirst(history.count - 100) }
    }

    /// Queue the next song right behind the current one, so it starts without a gap.
    private func prepareNext() {
        for i in player.items() where i !== currentPI { player.remove(i) }
        nextUp = nil
        guard !repeatOne, let n = upcoming.first, let cur = currentPI else { return }
        let pi = makeItem(n)
        if player.canInsert(pi, after: cur) {
            player.insert(pi, after: cur)
            nextUp = (n, pi)
        }
    }

    /// The queue moved on by itself (or a remote "next"): make the new song current.
    private func adoptNext(_ it: Item, _ pi: AVPlayerItem) {
        if let c = current { pushHistory(c) }
        if upcoming.first?.key == it.key { upcoming.removeFirst() }
        current = it
        currentPI = pi
        nextUp = nil
        watch(pi)
        installEndBoundary()
        prepareNext()
        updateNowPlaying()
        loadArtwork(it)
        emit("advanced", ["key": it.key, "url": it.url.absoluteString, "playing": wantPlay, "at": Date().timeIntervalSince1970 * 1000])
        if pi.status == .readyToPlay { emit("loaded", ["key": it.key, "duration": length]) }
        if wantPlay { introduce(it) }
    }

    private func goNext(fromRemote: Bool) {
        if let n = nextUp {
            player.advanceToNextItem()
            adoptNext(n.item, n.pi)
            if wantPlay { player.playImmediately(atRate: rate) }
        } else if let n = upcoming.first {
            if let c = current { pushHistory(c) }
            upcoming.removeFirst()
            setCurrent(n, startAt: 0, play: wantPlay || fromRemote)
            emit("advanced", ["key": n.key, "url": n.url.absoluteString, "playing": wantPlay, "at": Date().timeIntervalSince1970 * 1000])
        } else if fromRemote {
            emit("remote", ["cmd": "next"])   // end of what we know: the app decides (repeat all, etc.)
        } else {
            reachedEnd()
        }
    }

    private func goPrevious() {
        if now > 3 || history.isEmpty { seek(to: 0, scrub: false); return }
        let p = history.removeLast()
        if let c = current { upcoming.insert(c, at: 0) }
        setCurrent(p, startAt: 0, play: true)
        emit("advanced", ["key": p.key, "url": p.url.absoluteString, "playing": true, "at": Date().timeIntervalSince1970 * 1000])
    }

    private func reachedEnd() {
        wantPlay = false
        player.pause()
        player.seek(to: .zero)
        updateNowPlaying()
        emit("ended", ["key": current?.key ?? ""])
    }

    @objc private func itemEnded(_ n: Notification) {
        DispatchQueue.main.async {
            guard let pi = n.object as? AVPlayerItem else { return }
            if pi === self.currentPI {
                if self.repeatOne { self.player.seek(to: .zero); self.player.playImmediately(atRate: self.rate); return }
                if let nx = self.nextUp, self.player.currentItem === nx.pi {
                    self.adoptNext(nx.item, nx.pi)      // AVQueuePlayer already moved on, gapless
                } else {
                    self.goNext(fromRemote: false)
                }
            }
        }
    }

    @objc private func itemFailed(_ n: Notification) {
        DispatchQueue.main.async {
            guard let pi = n.object as? AVPlayerItem, pi === self.currentPI else { return }
            self.emit("error", ["key": self.current?.key ?? "", "message": (pi.error?.localizedDescription) ?? "Playback failed"])
        }
    }

    // songs whose silent ending couldn't be cut from the file: move on where the sound stops
    private func installEndBoundary() {
        removeEndBoundary()
        guard let it = current, it.end > 0 else { return }
        let t = CMTime(seconds: it.end, preferredTimescale: 600)
        endObs = player.addBoundaryTimeObserver(forTimes: [NSValue(time: t)], queue: .main) { [weak self] in
            guard let self = self, let d = self.currentPI?.duration.seconds, d.isFinite, it.end < d - 0.5, self.current?.key == it.key else { return }
            if self.repeatOne { self.player.seek(to: .zero); return }
            self.goNext(fromRemote: false)
        }
    }

    private func removeEndBoundary() {
        if let o = endObs { player.removeTimeObserver(o); endObs = nil }
    }

    // MARK: events for the web UI

    private func tick() {
        // while the app is in the background its web page is asleep: don't pile up messages for it
        guard inForeground, current != nil else { return }
        emit("time", ["time": min(now, length > 0 ? length : now), "duration": length, "playing": isPlaying])
    }

    private func stateChanged() {
        let p = isPlaying
        if p != lastPlaying {
            lastPlaying = p
            emit("state", ["playing": p, "time": now])
            updateNowPlaying()
        }
    }

    @objc private func becameActive() {
        DispatchQueue.main.async { if self.current != nil { self.emit("sync", self.snapshot()) } }
    }

    // MARK: interruptions (calls, Siri, alarms) and headphones

    @objc private func interrupted(_ n: Notification) {
        guard let info = n.userInfo, let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        DispatchQueue.main.async {
            if type == .began {
                self.resumeAfterInterruption = self.wantPlay
                self.updateNowPlaying()
            } else {
                let opts = AVAudioSession.InterruptionOptions(rawValue: (info[AVAudioSessionInterruptionOptionKey] as? UInt) ?? 0)
                if opts.contains(.shouldResume) && self.resumeAfterInterruption { self.doPlay() }
                self.resumeAfterInterruption = false
            }
        }
    }

    @objc private func routeChanged(_ n: Notification) {
        let raw = n.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt ?? 0
        DispatchQueue.main.async {
            // headphones unplugged / AirPods taken out: pause, like every music app
            if AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable, self.current != nil { self.doPause() }
            self.emit("route", Self.routeInfo())
        }
    }

    /// Where the sound is going right now: "AirPods Pro", "Living Room" (AirPlay), "This iPhone"...
    static func routeInfo() -> [String: Any] {
        guard let out = AVAudioSession.sharedInstance().currentRoute.outputs.first else { return ["name": "This iPhone", "kind": "phone"] }
        let kind: String
        switch out.portType {
        case .bluetoothA2DP, .bluetoothHFP, .bluetoothLE: kind = "bluetooth"
        case .airPlay: kind = "airplay"
        case .headphones, .usbAudio: kind = "headphones"
        case .carAudio: kind = "car"
        case .HDMI: kind = "tv"
        default: kind = "phone"
        }
        return ["name": kind == "phone" ? "This iPhone" : out.portName, "kind": kind]
    }

    @objc func route(_ call: CAPPluginCall) { DispatchQueue.main.async { call.resolve(Self.routeInfo()) } }

    /// Shows iOS's own "where to play" list (AirPods, speakers, AirPlay, Apple TV...).
    @objc func pickRoute(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController?.view else { call.resolve(["ok": false]); return }
            let picker = AVRoutePickerView(frame: CGRect(x: -100, y: -100, width: 1, height: 1))
            picker.prioritizesVideoDevices = false
            host.addSubview(picker)
            if let b = picker.subviews.compactMap({ $0 as? UIButton }).first { b.sendActions(for: .touchUpInside) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { picker.removeFromSuperview() }
            call.resolve(["ok": true])
        }
    }

    // MARK: lock screen, Control Center, AirPods, headphones, CarPlay

    private func setupCommands() {
        let cc = MPRemoteCommandCenter.shared()
        cc.playCommand.addTarget { [weak self] _ in self?.doPlay(); return .success }
        cc.pauseCommand.addTarget { [weak self] _ in self?.doPause(); return .success }
        cc.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self = self else { return .commandFailed }
            self.isPlaying ? self.doPause() : self.doPlay()
            return .success
        }
        cc.nextTrackCommand.addTarget { [weak self] _ in self?.goNext(fromRemote: true); return .success }
        cc.previousTrackCommand.addTarget { [weak self] _ in self?.goPrevious(); return .success }
        cc.changePlaybackPositionCommand.addTarget { [weak self] e in
            guard let self = self, let e = e as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self.seek(to: e.positionTime, scrub: false)
            return .success
        }
        for c in [cc.skipForwardCommand, cc.skipBackwardCommand, cc.seekForwardCommand, cc.seekBackwardCommand, cc.ratingCommand, cc.likeCommand, cc.dislikeCommand, cc.bookmarkCommand] {
            c.isEnabled = false
        }
        setCommands(false)
    }

    private func setCommands(_ on: Bool) {
        guard on != commandsOn else { return }
        commandsOn = on
        let cc = MPRemoteCommandCenter.shared()
        for c in [cc.playCommand, cc.pauseCommand, cc.togglePlayPauseCommand, cc.nextTrackCommand, cc.previousTrackCommand, cc.changePlaybackPositionCommand] {
            c.isEnabled = on
        }
        if on { UIApplication.shared.beginReceivingRemoteControlEvents() }
    }

    private func updateNowPlaying() {
        guard let it = current else { return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: it.title,
            MPMediaItemPropertyArtist: it.artist,
            MPMediaItemPropertyAlbumTitle: it.album,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: now,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? Double(rate) : 0.0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
            MPNowPlayingInfoPropertyIsLiveStream: false,
        ]
        if length > 0 { info[MPMediaItemPropertyPlaybackDuration] = length }
        if let a = artwork, a.key == it.key { info[MPMediaItemPropertyArtwork] = a.art }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func loadArtwork(_ it: Item) {
        if artwork?.key == it.key { return }
        artwork = nil
        guard !it.art.isEmpty, let url = Self.fileURL(it.art) else { return }
        let apply: (UIImage) -> Void = { [weak self] img in
            DispatchQueue.main.async {
                guard let self = self, self.current?.key == it.key else { return }
                let art = MPMediaItemArtwork(boundsSize: img.size) { _ in img }
                self.artwork = (it.key, art)
                self.updateNowPlaying()
            }
        }
        if url.isFileURL {
            DispatchQueue.global(qos: .utility).async { if let img = UIImage(contentsOfFile: url.path) { apply(img) } }
        } else {
            URLSession.shared.dataTask(with: url) { data, _, _ in if let d = data, let img = UIImage(data: d) { apply(img) } }.resume()
        }
    }

    // MARK: signing (free Apple ID installs expire after 7 days)

    /// Reads the app's own provisioning profile: when it was signed and when iOS will stop opening it.
    @objc func signing(_ call: CAPPluginCall) {
        guard let path = Bundle.main.path(forResource: "embedded", ofType: "mobileprovision"),
              let data = FileManager.default.contents(atPath: path),
              let start = data.range(of: Data("<?xml".utf8)),
              let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex),
              let plist = try? PropertyListSerialization.propertyList(from: data.subdata(in: start.lowerBound..<end.upperBound), options: [], format: nil) as? [String: Any],
              let exp = plist["ExpirationDate"] as? Date else {
            call.resolve(["ok": false])   // simulator / App Store build: nothing expires
            return
        }
        let created = plist["CreationDate"] as? Date
        let ent = plist["Entitlements"] as? [String: Any] ?? [:]
        let days = created.map { exp.timeIntervalSince($0) / 86400 } ?? 0
        call.resolve([
            "ok": true,
            "expires": exp.timeIntervalSince1970 * 1000,
            "created": (created?.timeIntervalSince1970 ?? 0) * 1000,
            "team": plist["TeamName"] as? String ?? "",
            "profile": plist["Name"] as? String ?? "",
            "free": days > 0 && days < 8,     // free Apple ID: 7 days; paid developer account: a year
            "devMode": ent["get-task-allow"] as? Bool ?? false,
        ])
    }

    /// Local reminders before the app expires (a day before, and 3 hours before).
    @objc func remind(_ call: CAPPluginCall) {
        let expires = (call.getDouble("expires") ?? 0) / 1000
        let ask = call.getBool("ask") ?? true
        let center = UNUserNotificationCenter.current()
        let ids = ["aurora-resign-24h", "aurora-resign-3h", "aurora-resign-now"]
        center.removePendingNotificationRequests(withIdentifiers: ids)
        guard expires > 0 else { call.resolve(["ok": false]); return }
        let schedule = {
            let plan: [(String, Double, String, String)] = [
                (ids[0], expires - 86400, "Aurora expires tomorrow", "Re-sign Aurora with Sideloadly in the next 24 hours to keep using it. Your music and settings stay."),
                (ids[1], expires - 3 * 3600, "Aurora expires in 3 hours", "Plug your iPhone into your PC and re-install Aurora with Sideloadly."),
                (ids[2], expires, "Aurora needs re-signing", "Re-install Aurora with Sideloadly to open it again. Nothing is lost."),
            ]
            let nowT = Date().timeIntervalSince1970
            for (id, at, title, body) in plan where at > nowT + 30 {
                let c = UNMutableNotificationContent()
                c.title = title
                c.body = body
                c.sound = .default
                let trig = UNTimeIntervalNotificationTrigger(timeInterval: at - nowT, repeats: false)
                center.add(UNNotificationRequest(identifier: id, content: c, trigger: trig))
            }
        }
        center.getNotificationSettings { s in
            if s.authorizationStatus == .authorized || s.authorizationStatus == .provisional {
                schedule(); call.resolve(["ok": true])
            } else if ask && s.authorizationStatus == .notDetermined {
                center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
                    if granted { schedule() }
                    call.resolve(["ok": granted])
                }
            } else {
                call.resolve(["ok": false, "denied": s.authorizationStatus == .denied])
            }
        }
    }

    // MARK: home screen icon

    @objc func getIcon(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["supported": UIApplication.shared.supportsAlternateIcons, "name": UIApplication.shared.alternateIconName ?? ""])
        }
    }

    /// name: "AppIcon-sunset" etc., or empty for the original icon. iOS shows its own little confirmation.
    @objc func setIcon(_ call: CAPPluginCall) {
        let name = call.getString("name") ?? ""
        DispatchQueue.main.async {
            guard UIApplication.shared.supportsAlternateIcons else { call.resolve(["ok": false, "error": "This iPhone can't change app icons"]); return }
            UIApplication.shared.setAlternateIconName(name.isEmpty ? nil : name) { err in
                call.resolve(err == nil ? ["ok": true] : ["ok": false, "error": err!.localizedDescription])
            }
        }
    }

    // MARK: AI DJ voice

    final class SpeechDelegate: NSObject, AVSpeechSynthesizerDelegate, AVAudioPlayerDelegate {
        var done: (() -> Void)?
        func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) { done?() }
        func speechSynthesizer(_ s: AVSpeechSynthesizer, didCancel u: AVSpeechUtterance) { done?() }
        func audioPlayerDidFinishPlaying(_ p: AVAudioPlayer, successfully flag: Bool) { done?() }
    }

    /// The most natural voices installed on this iPhone, best first (Premium > Enhanced > default).
    static func rankedVoices() -> [AVSpeechSynthesisVoice] {
        let all = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix("en") }
        func q(_ v: AVSpeechSynthesisVoice) -> Int {
            if #available(iOS 16.0, *), v.quality == .premium { return 3 }
            return v.quality == .enhanced ? 2 : 1
        }
        let novelty = ["Albert", "Bad News", "Bahh", "Bells", "Boing", "Bubbles", "Cellos", "Good News", "Jester", "Organ", "Superstar", "Trinoids", "Whisper", "Wobble", "Zarvox", "Fred", "Junior", "Ralph", "Kathy"]
        return all.filter { v in !novelty.contains(where: { v.name.hasPrefix($0) }) && !v.identifier.contains("eloquence") }
            .sorted { a, b in
                if q(a) != q(b) { return q(a) > q(b) }
                let us = (a.language == "en-US" ? 1 : 0) - (b.language == "en-US" ? 1 : 0)
                return us != 0 ? us > 0 : a.name < b.name
            }
    }

    @objc func voices(_ call: CAPPluginCall) {
        let list: [[String: Any]] = Self.rankedVoices().map { v in
            var quality = v.quality == .enhanced ? "enhanced" : "default"
            if #available(iOS 16.0, *), v.quality == .premium { quality = "premium" }
            return ["id": v.identifier, "name": v.name, "lang": v.language, "quality": quality]
        }
        call.resolve(["voices": list])
    }

    @objc func djVoice(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.djVoiceId = call.getString("voice") ?? ""
            self.djRate = Float(call.getDouble("rate") ?? 0.52)
            call.resolve()
        }
    }

    /// Say something now (the DJ's opening line, a preview of a voice...).
    @objc func speak(_ call: CAPPluginCall) {
        let text = call.getString("text") ?? ""
        let audio = call.getString("audio") ?? ""
        DispatchQueue.main.async {
            self.say(text: text, audio: audio, duck: call.getBool("duck") ?? true) { call.resolve(["ok": true]) }
        }
    }

    private func introduce(_ it: Item) {
        guard !it.intro.isEmpty || !it.introAudio.isEmpty else { return }
        say(text: it.intro, audio: it.introAudio, duck: true, done: nil)
    }

    /// Speak over the music: it dips while the DJ talks and comes back up after, like a radio host.
    private func say(text: String, audio: String, duck: Bool, done: (() -> Void)?) {
        stopSpeaking()
        activateSession()
        speaking = true
        if duck { ramp(to: musicVolume * 0.22, over: 0.35) }
        let d = SpeechDelegate()
        d.done = { [weak self] in
            DispatchQueue.main.async {
                guard let self = self, self.speechDelegate === d else { return }
                self.speaking = false
                self.speechDelegate = nil
                self.ramp(to: self.musicVolume, over: 0.9)
                done?()
            }
        }
        speechDelegate = d
        if !audio.isEmpty, let url = Self.fileURL(audio), let p = try? AVAudioPlayer(contentsOf: url) {
            p.delegate = d
            voicePlayer = p
            p.volume = 1
            p.play()
            return
        }
        guard !text.isEmpty else { d.done?(); return }
        speech.delegate = d
        speech.usesApplicationAudioSession = true
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(identifier: djVoiceId) ?? Self.rankedVoices().first ?? AVSpeechSynthesisVoice(language: "en-US")
        u.rate = djRate
        u.pitchMultiplier = 1.0
        u.preUtteranceDelay = 0.15
        u.postUtteranceDelay = 0.1
        speech.speak(u)
    }

    private func stopSpeaking() {
        if speech.isSpeaking { speech.stopSpeaking(at: .immediate) }
        voicePlayer?.stop()
        voicePlayer = nil
        speechDelegate = nil
        if speaking { speaking = false; player.volume = musicVolume }
    }

    private var rampTimer: Timer?
    private func ramp(to target: Float, over seconds: Double) {
        rampTimer?.invalidate()
        let start = player.volume, steps = max(1, Int(seconds / 0.03))
        var i = 0
        rampTimer = Timer.scheduledTimer(withTimeInterval: 0.03, repeats: true) { [weak self] t in
            guard let self = self else { t.invalidate(); return }
            i += 1
            let f = Float(i) / Float(steps)
            self.player.volume = start + (target - start) * min(1, f * f * (3 - 2 * f))
            if i >= steps { t.invalidate() }
        }
    }

    // MARK: QR codes (Jam invites)

    @objc func qr(_ call: CAPPluginCall) {
        let text = call.getString("text") ?? ""
        guard let f = CIFilter(name: "CIQRCodeGenerator") else { call.resolve(["ok": false]); return }
        f.setValue(Data(text.utf8), forKey: "inputMessage")
        f.setValue("M", forKey: "inputCorrectionLevel")
        guard let img = f.outputImage else { call.resolve(["ok": false]); return }
        let scaled = img.transformed(by: CGAffineTransform(scaleX: 12, y: 12))
        let ctx = CIContext()
        guard let cg = ctx.createCGImage(scaled, from: scaled.extent), let png = UIImage(cgImage: cg).pngData() else { call.resolve(["ok": false]); return }
        call.resolve(["ok": true, "src": "data:image/png;base64," + png.base64EncodedString()])
    }
}
