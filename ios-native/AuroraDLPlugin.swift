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
        lock.lock(); active.insert(id); lock.unlock()
        beginBackgroundWork()
        startPolling()
        work.async {
            let r = AuroraPython.call("start", arg: json)
            call.resolve(["json": r])
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
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
        if ["done", "error", "cancelled", "expand"].contains(type) { finish(jobId) }
        notify(ev)
    }

    private func notify(_ ev: [String: Any]) {
        notifyListeners("dl", data: ev)
        if ProcessInfo.processInfo.environment["AURORA_SELFTEST"] != nil { selfTestEvent(ev) }
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

    private func runSelfTest() {
        work.async {
            self.selftest["started"] = Date().timeIntervalSince1970
            if let err = AuroraPython.start() { self.selftest["startError"] = err; self.selftest["finished"] = true; self.writeSelfTest(); return }
            self.selftest["version"] = AuroraPython.call("version", arg: "{}")
            self.writeSelfTest()
            self.selftest["lookup"] = AuroraPython.call("selftest", arg: "{}")
            self.writeSelfTest()
            let job: [String: Any] = ["id": "selftest", "url": "https://www.youtube.com/watch?v=jNQXAC9IVRw", "format": "video-best", "dir": "Music/Downloads",
                                      "root": self.docs.path, "libRoot": self.library.path]
            let json = String(data: try! JSONSerialization.data(withJSONObject: job), encoding: .utf8)!
            self.lock.lock(); self.active.insert("selftest"); self.lock.unlock()
            self.selftest["download"] = AuroraPython.call("start", arg: json)
            self.selftest["events"] = [[String: Any]]()
            self.writeSelfTest()
            self.startPolling()
        }
    }

    private func selfTestEvent(_ ev: [String: Any]) {
        guard (ev["jobId"] as? String) == "selftest" else { return }
        var list = selftest["events"] as? [[String: Any]] ?? []
        if (ev["type"] as? String) != "progress" || list.count < 40 { list.append(ev) }
        selftest["events"] = list
        let type = ev["type"] as? String ?? ""
        // YouTube often blocks cloud servers ("confirm you're not a bot"); then check the whole
        // pipeline with a SoundCloud song instead, so the CI run still proves downloads work.
        if type == "error", selftest["fallback"] == nil {
            selftest["youtubeError"] = ev["error"] ?? "?"
            selftest["fallback"] = "soundcloud"
            selftest["events"] = [[String: Any]]()
            writeSelfTest()
            let job: [String: Any] = ["id": "selftest", "url": "https://soundcloud.com/forss/flickermood", "format": "audio-m4a", "dir": "Music/Downloads",
                                      "root": docs.path, "libRoot": library.path]
            let json = String(data: try! JSONSerialization.data(withJSONObject: job), encoding: .utf8)!
            lock.lock(); active.insert("selftest"); lock.unlock()
            work.async {
                self.selftest["download2"] = AuroraPython.call("start", arg: json)
                self.startPolling()
            }
            return
        }
        if ["done", "error", "cancelled"].contains(type) {
            if type == "done", let file = list.first(where: { ($0["type"] as? String) == "file" }), let track = file["track"] as? [String: Any], let p = track["path"] as? String {
                let abs = docs.appendingPathComponent(String(p.dropFirst("docs/".count)))
                let asset = AVURLAsset(url: abs)
                let sem = DispatchSemaphore(value: 0)
                Task {
                    let v = (try? await asset.loadTracks(withMediaType: .video).count) ?? -1
                    let a = (try? await asset.loadTracks(withMediaType: .audio).count) ?? -1
                    let d = (try? await asset.load(.duration).seconds) ?? -1
                    self.selftest["mergedFile"] = ["videoTracks": v, "audioTracks": a, "seconds": d, "bytes": track["size"] ?? 0]
                    sem.signal()
                }
                sem.wait()
            }
            selftest["finished"] = true
        }
        writeSelfTest()
    }
}
