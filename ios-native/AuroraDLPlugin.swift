// Aurora for iPhone: the native side of the downloader.
// Runs yt-dlp in the embedded Python (see app/aurora_dl.py), forwards progress to the web UI,
// and merges separate video + audio downloads with AVFoundation (there's no ffmpeg on iOS).
import Foundation
import Capacitor
import AVFoundation
import UIKit

@objc(AuroraDLPlugin)
public class AuroraDLPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AuroraDLPlugin"
    public let jsName = "AuroraDL"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "info", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "search", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "haptic", returnType: CAPPluginReturnPromise),
    ]

    private let work = DispatchQueue(label: "aurora.python", qos: .userInitiated, attributes: .concurrent)
    private let pollQueue = DispatchQueue(label: "aurora.python.poll", qos: .utility)
    private var timer: DispatchSourceTimer?
    private var active = Set<String>()
    private let lock = NSLock()
    private var bgTask: UIBackgroundTaskIdentifier = .invalid
    private var selftest: [String: Any] = [:]
    private var jobInfo: [String: [String: Any]] = [:]   // the job sent by the app, kept for retries

    private var docs: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }
    private var library: URL { FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0] }

    override public func load() {
        // warm up Python in the background so the first download starts quickly
        work.async { _ = AuroraPython.start() }
        if ProcessInfo.processInfo.environment["AURORA_SELFTEST"] != nil { runSelfTest() }
        NotificationCenter.default.addObserver(self, selector: #selector(appMovedToBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
    }

    // MARK: JS API

    @objc func info(_ call: CAPPluginCall) {
        work.async {
            if let err = AuroraPython.start() { call.resolve(["ok": false, "error": err]); return }
            call.resolve(["json": AuroraPython.call("version", arg: "{}")])
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        guard var job = call.getObject("job"), let id = job["id"] as? String else { call.reject("Missing job"); return }
        job["root"] = docs.path
        job["libRoot"] = library.path
        guard let data = try? JSONSerialization.data(withJSONObject: job), let json = String(data: data, encoding: .utf8) else { call.reject("Bad job"); return }
        lock.lock(); active.insert(id); jobInfo[id] = job; lock.unlock()
        beginBackgroundWork()
        startPolling()
        work.async {
            let r = AuroraPython.call("start", arg: json)
            call.resolve(["json": r])
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
        FastFetch.shared.cancel(job: id)
        work.async { call.resolve(["json": AuroraPython.call("cancel", arg: "{\"id\":\"\(id)\"}")]) }
    }

    @objc func search(_ call: CAPPluginCall) {
        let q: [String: Any] = ["q": call.getString("q") ?? "", "source": call.getString("source") ?? "youtube", "limit": call.getInt("limit") ?? 18]
        let json = String(data: (try? JSONSerialization.data(withJSONObject: q)) ?? Data(), encoding: .utf8) ?? "{}"
        work.async { call.resolve(["json": AuroraPython.call("search", arg: json)]) }
    }

    @objc func update(_ call: CAPPluginCall) {
        work.async { call.resolve(["json": AuroraPython.call("update", arg: "{}")]) }
    }

    @objc func haptic(_ call: CAPPluginCall) {
        let style = call.getString("style") ?? "light"
        DispatchQueue.main.async {
            switch style {
            case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "error": UINotificationFeedbackGenerator().notificationOccurred(.error)
            case "select": UISelectionFeedbackGenerator().selectionChanged()
            case "medium": UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            default: UIImpactFeedbackGenerator(style: .light).impactOccurred()
            }
            call.resolve()
        }
    }

    // MARK: events from Python

    private func startPolling() {
        pollQueue.async {
            if self.timer != nil { return }
            let t = DispatchSource.makeTimerSource(queue: self.pollQueue)
            t.schedule(deadline: .now() + .milliseconds(150), repeating: .milliseconds(250))
            t.setEventHandler { [weak self] in self?.pollOnce() }
            self.timer = t
            t.resume()
        }
    }

    private func pollOnce() {
        let raw = AuroraPython.call("poll", arg: "{}")
        guard let data = raw.data(using: .utf8), let events = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { return }
        for ev in events { handle(ev) }
        lock.lock(); let idle = active.isEmpty; lock.unlock()
        if idle && events.isEmpty {
            timer?.cancel(); timer = nil
            endBackgroundWork()
        }
    }

    private func finish(_ jobId: String) {
        lock.lock(); active.remove(jobId); lock.unlock()
    }

    private func handle(_ ev: [String: Any]) {
        let type = ev["type"] as? String ?? ""
        let jobId = ev["jobId"] as? String ?? ""
        if type == "merge" {
            guard let v = ev["video"] as? String, let a = ev["audio"] as? String, let o = ev["out"] as? String else { return }
            notify(["type": "status", "jobId": jobId, "status": "downloading", "statusText": "Merging video and audio…", "progress": 99])
            merge(video: URL(fileURLWithPath: v), audio: URL(fileURLWithPath: a), out: URL(fileURLWithPath: o)) { [weak self] err in
                guard let self = self else { return }
                if let err = err {
                    self.notify(["type": "error", "jobId": jobId, "error": "Couldn't merge video and audio: \(err.localizedDescription)"])
                } else {
                    var track = ev["track"] as? [String: Any] ?? [:]
                    let size = (try? FileManager.default.attributesOfItem(atPath: o)[.size] as? NSNumber)?.intValue ?? 0
                    track["size"] = size
                    self.notify(["type": "file", "jobId": jobId, "track": track])
                    self.notify(["type": "done", "jobId": jobId])
                }
                self.finish(jobId)
            }
            return
        }
        if type == "fetch" { fastFetch(ev, jobId: jobId); return }
        if ["done", "error", "cancelled", "expand"].contains(type) { finish(jobId) }
        notify(ev)
    }

    private func notify(_ ev: [String: Any]) {
        notifyListeners("dl", data: ev)
        if ProcessInfo.processInfo.environment["AURORA_SELFTEST"] != nil { selfTestEvent(ev) }
    }

    // MARK: fast native downloads (see FastFetch.swift)

    private func fastFetch(_ ev: [String: Any], jobId: String) {
        let raw = ev["parts"] as? [[String: Any]] ?? []
        var parts: [FastFetch.Part] = []
        for p in raw {
            guard let u = p["url"] as? String, let url = URL(string: u), let path = p["path"] as? String else { continue }
            var headers: [String: String] = [:]
            for (k, v) in (p["headers"] as? [String: Any]) ?? [:] { headers[k] = "\(v)" }
            parts.append(FastFetch.Part(url: url, headers: headers, path: URL(fileURLWithPath: path),
                                        size: (p["size"] as? NSNumber)?.int64Value ?? 0, chunk: (p["chunk"] as? NSNumber)?.int64Value ?? 0))
        }
        let then = ev["then"] as? String ?? "file"
        guard !parts.isEmpty, then != "merge" || parts.count == 2 else { retryWithPython(jobId, reason: "no direct link"); return }
        notify(["type": "status", "jobId": jobId, "status": "downloading", "statusText": "Starting fast download…", "progress": 0])
        let scale = then == "merge" ? 98.0 : 100.0
        FastFetch.shared.run(job: jobId, parts: parts, progress: { [weak self] frac, speed, eta in
            var e: [String: Any] = ["type": "progress", "jobId": jobId, "progress": (frac * scale * 10).rounded() / 10, "speed": Self.fmtSpeed(speed)]
            if let eta = eta { e["eta"] = Self.fmtEta(eta) }
            self?.notify(e)
        }, done: { [weak self] err in
            guard let self = self else { return }
            if let err = err {
                if err is CancellationError { self.notify(["type": "cancelled", "jobId": jobId]); self.finish(jobId); return }
                self.retryWithPython(jobId, reason: err.localizedDescription)
                return
            }
            var track = ev["track"] as? [String: Any] ?? [:]
            if then == "merge" {
                self.handle(["type": "merge", "jobId": jobId, "video": parts[0].path.path, "audio": parts[1].path.path, "out": ev["out"] as? String ?? parts[0].path.path, "track": track])
                return
            }
            track["size"] = (try? FileManager.default.attributesOfItem(atPath: parts[0].path.path)[.size] as? NSNumber)?.intValue ?? 0
            self.notify(["type": "file", "jobId": jobId, "track": track])
            self.notify(["type": "done", "jobId": jobId])
            self.finish(jobId)
        })
    }

    /// The fast path failed (unusual link, expired address...): let yt-dlp download it the classic way.
    private func retryWithPython(_ jobId: String, reason: String) {
        lock.lock(); var job = jobInfo[jobId]; lock.unlock()
        guard job != nil else { notify(["type": "error", "jobId": jobId, "error": "Download failed: \(reason)"]); finish(jobId); return }
        job!["noNative"] = true
        notify(["type": "status", "jobId": jobId, "status": "downloading", "statusText": "Retrying…", "progress": 0])
        guard let data = try? JSONSerialization.data(withJSONObject: job!), let json = String(data: data, encoding: .utf8) else { return }
        work.async {
            _ = AuroraPython.call("start", arg: json)
            self.startPolling()
        }
    }

    static func fmtSpeed(_ b: Double) -> String {
        if b <= 0 { return "" }
        let units = ["B/s", "KB/s", "MB/s", "GB/s"]
        var v = b, i = 0
        while v >= 1000 && i < units.count - 1 { v /= 1000; i += 1 }
        return i == 0 ? "\(Int(v))B/s" : String(format: v < 10 ? "%.1f%@" : "%.0f%@", v, units[i])
    }

    static func fmtEta(_ s: Double) -> String {
        let t = max(0, Int(s.rounded()))
        return t >= 3600 ? String(format: "%d:%02d:%02d", t / 3600, (t % 3600) / 60, t % 60) : String(format: "%02d:%02d", t / 60, t % 60)
    }

    // MARK: merging (H.264 video + AAC audio -> MP4, no re-encoding)

    private func merge(video: URL, audio: URL, out: URL, done: @escaping (Error?) -> Void) {
        Task {
            do {
                let comp = AVMutableComposition()
                let va = AVURLAsset(url: video), aa = AVURLAsset(url: audio)
                let vDur = try await va.load(.duration)
                let aDur = try await aa.load(.duration)
                if let vt = try await va.loadTracks(withMediaType: .video).first,
                   let ct = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) {
                    try ct.insertTimeRange(CMTimeRange(start: .zero, duration: vDur), of: vt, at: .zero)
                    ct.preferredTransform = try await vt.load(.preferredTransform)
                }
                if let at = try await aa.loadTracks(withMediaType: .audio).first,
                   let ca = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
                    let d = CMTimeMinimum(vDur, aDur)
                    try ca.insertTimeRange(CMTimeRange(start: .zero, duration: d), of: at, at: .zero)
                }
                try? FileManager.default.removeItem(at: out)
                guard let ex = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetPassthrough) else {
                    throw NSError(domain: "Aurora", code: 1, userInfo: [NSLocalizedDescriptionKey: "Export isn't available"])
                }
                ex.outputURL = out
                ex.outputFileType = .mp4
                ex.shouldOptimizeForNetworkUse = true
                await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in ex.exportAsynchronously { c.resume() } }
                if ex.status != .completed { throw ex.error ?? NSError(domain: "Aurora", code: 2, userInfo: [NSLocalizedDescriptionKey: "Export failed"]) }
                try? FileManager.default.removeItem(at: video)
                try? FileManager.default.removeItem(at: audio)
                done(nil)
            } catch {
                done(error)
            }
        }
    }

    // MARK: keep downloading for a while when the app is in the background

    private func beginBackgroundWork() {
        DispatchQueue.main.async {
            if self.bgTask != .invalid { return }
            self.bgTask = UIApplication.shared.beginBackgroundTask(withName: "aurora-downloads") { [weak self] in self?.endBackgroundWork() }
        }
    }

    private func endBackgroundWork() {
        DispatchQueue.main.async {
            if self.bgTask == .invalid { return }
            UIApplication.shared.endBackgroundTask(self.bgTask)
            self.bgTask = .invalid
        }
    }

    @objc private func appMovedToBackground() {
        lock.lock(); let busy = !active.isEmpty; lock.unlock()
        if busy { beginBackgroundWork() }
    }

    // MARK: self-test (used by the CI simulator run; writes Documents/selftest.json)

    private func writeSelfTest() {
        if let d = try? JSONSerialization.data(withJSONObject: selftest, options: [.prettyPrinted]) {
            try? d.write(to: docs.appendingPathComponent("selftest.json"))
        }
    }

    // Downloads tried by the CI self-test, one after another. YouTube usually refuses cloud servers
    // ("confirm you're not a bot"), so the others prove the rest of the pipeline: SoundCloud through
    // yt-dlp, and two files from this app's own GitHub repo through the fast native downloader.
    private var selftestQueue: [[String: String]] = [
        ["name": "youtube", "url": "https://www.youtube.com/watch?v=jNQXAC9IVRw", "format": "video-best"],
        ["name": "soundcloud", "url": "https://soundcloud.com/forss/flickermood", "format": "audio-m4a"],
        ["name": "direct-audio", "url": "https://raw.githubusercontent.com/UndeadBossGames/Aurora-iOS/main/assets/selftest/tone.m4a", "format": "audio-m4a"],
        ["name": "direct-video", "url": "https://raw.githubusercontent.com/UndeadBossGames/Aurora-iOS/main/assets/selftest/clip.mp4", "format": "video-best"],
    ]
    private var selftestCurrent: [String: Any] = [:]
    private var selftestStarted: TimeInterval = 0

    private func runSelfTest() {
        work.async {
            self.selftest["started"] = Date().timeIntervalSince1970
            if let err = AuroraPython.start() { self.selftest["startError"] = err; self.selftest["finished"] = true; self.writeSelfTest(); return }
            self.selftest["version"] = AuroraPython.call("version", arg: "{}")
            self.selftest["results"] = [[String: Any]]()
            self.writeSelfTest()
            self.nextSelfTest()
        }
    }

    private func nextSelfTest() {
        guard !selftestQueue.isEmpty else { selftest["finished"] = true; writeSelfTest(); return }
        let t = selftestQueue.removeFirst()
        selftestCurrent = ["name": t["name"] ?? "?", "url": t["url"] ?? "", "events": [[String: Any]]()]
        selftestStarted = Date().timeIntervalSince1970
        let job: [String: Any] = ["id": "selftest", "url": t["url"] ?? "", "format": t["format"] ?? "audio-m4a", "dir": "Music/Downloads",
                                  "root": docs.path, "libRoot": library.path]
        lock.lock(); active.insert("selftest"); jobInfo["selftest"] = job; lock.unlock()
        let json = String(data: try! JSONSerialization.data(withJSONObject: job), encoding: .utf8)!
        work.async {
            _ = AuroraPython.call("start", arg: json)
            self.startPolling()
        }
    }

    private func selfTestEvent(_ ev: [String: Any]) {
        guard (ev["jobId"] as? String) == "selftest" else { return }
        var list = selftestCurrent["events"] as? [[String: Any]] ?? []
        if (ev["type"] as? String) != "progress" || list.count < 25 { list.append(ev) }
        selftestCurrent["events"] = list
        let type = ev["type"] as? String ?? ""
        guard ["done", "error", "cancelled"].contains(type) else { return }
        selftestCurrent["result"] = type
        selftestCurrent["seconds"] = Date().timeIntervalSince1970 - selftestStarted
        selftestCurrent["native"] = list.contains { ($0["statusText"] as? String) == "Starting fast download…" }
        if type == "done", let file = list.first(where: { ($0["type"] as? String) == "file" }), let track = file["track"] as? [String: Any], let p = track["path"] as? String {
            let abs = docs.appendingPathComponent(String(p.dropFirst("docs/".count)))
            let asset = AVURLAsset(url: abs)
            let sem = DispatchSemaphore(value: 0)
            let bytes = track["size"] ?? 0
            Task {
                let v = (try? await asset.loadTracks(withMediaType: .video).count) ?? -1
                let a = (try? await asset.loadTracks(withMediaType: .audio).count) ?? -1
                let d = (try? await asset.load(.duration).seconds) ?? -1
                self.selftestCurrent["file"] = ["bytes": bytes, "videoTracks": v, "audioTracks": a, "seconds": d]
                sem.signal()
            }
            sem.wait()
            if let b = (track["size"] as? NSNumber)?.doubleValue, let secs = selftestCurrent["seconds"] as? Double, secs > 0 { selftestCurrent["MBps"] = b / secs / 1_000_000 }
        }
        var results = selftest["results"] as? [[String: Any]] ?? []
        results.append(selftestCurrent)
        selftest["results"] = results
        writeSelfTest()
        DispatchQueue.global().asyncAfter(deadline: .now() + 1) { self.nextSelfTest() }
    }
}
