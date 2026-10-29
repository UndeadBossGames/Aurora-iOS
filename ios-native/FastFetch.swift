// Aurora for iPhone: the fast downloader.
// yt-dlp (in Python) finds the media; this downloads it natively with URLSession, splitting each
// file into 4 MB pieces fetched over many connections at once. That's much faster than a single
// Python connection: it runs at the full speed of your Wi-Fi or 5G, and it also gets around
// sites (like YouTube) that slow down any one connection.
import Foundation

final class FastFetch: NSObject {
    struct Part {
        let url: URL
        let headers: [String: String]
        let path: URL
        var size: Int64
        let chunk: Int64
    }

    static let shared = FastFetch()

    private let session: URLSession
    private let lock = NSLock()
    private var tasks: [String: [Task<Void, Never>]] = [:]
    private var cancelled = Set<String>()

    override init() {
        let cfg = URLSessionConfiguration.default
        cfg.httpMaximumConnectionsPerHost = 24
        cfg.timeoutIntervalForRequest = 30
        cfg.timeoutIntervalForResource = 60 * 60 * 6
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        cfg.urlCache = nil
        cfg.allowsCellularAccess = true
        cfg.allowsExpensiveNetworkAccess = true
        cfg.allowsConstrainedNetworkAccess = true
        cfg.waitsForConnectivity = false
        cfg.httpShouldUsePipelining = true
        session = URLSession(configuration: cfg)
        super.init()
    }

    /// Progress over all parts of a job.
    final class Meter {
        let total: Int64
        private(set) var done: Int64 = 0
        private var samples: [(TimeInterval, Int64)] = []
        private let lock = NSLock()
        private var lastEmit: TimeInterval = 0
        init(total: Int64) { self.total = max(total, 1) }
        func add(_ n: Int64) { lock.lock(); done += n; lock.unlock() }
        /// (fraction, bytes per second, seconds left) at most 4 times a second
        func sample() -> (Double, Double, Double?)? {
            lock.lock(); defer { lock.unlock() }
            let now = Date().timeIntervalSince1970
            if now - lastEmit < 0.25 { return nil }
            lastEmit = now
            samples.append((now, done))
            samples.removeAll { now - $0.0 > 3 }
            var speed = 0.0
            if let first = samples.first, now - first.0 > 0.2 { speed = Double(done - first.1) / (now - first.0) }
            let eta: Double? = speed > 1 ? Double(total - done) / speed : nil
            return (min(1, Double(done) / Double(total)), speed, eta)
        }
    }

    func cancel(job: String) {
        lock.lock()
        cancelled.insert(job)
        let list = tasks[job] ?? []
        lock.unlock()
        list.forEach { $0.cancel() }
    }

    private func isCancelled(_ job: String) -> Bool { lock.lock(); defer { lock.unlock() }; return cancelled.contains(job) }
    private func forget(_ job: String) { lock.lock(); tasks[job] = nil; cancelled.remove(job); lock.unlock() }

    /// Downloads all parts at the same time. Calls progress(fraction, bytes/s, eta) and then done(error).
    func run(job: String, parts input: [Part], progress: @escaping (Double, Double, Double?) -> Void, done: @escaping (Error?) -> Void) {
        let main = Task { [weak self] in
            guard let self = self else { return }
            do {
                // learn every file's size first (needed to split it into pieces)
                var parts = input
                for i in parts.indices where parts[i].size <= 0 {
                    parts[i].size = (try? await self.probeSize(parts[i])) ?? -1
                }
                let total = parts.reduce(Int64(0)) { $0 + max($1.size, 0) }
                let meter = Meter(total: total > 0 ? total : 1)
                let ticker = Task {
                    while !Task.isCancelled {
                        try? await Task.sleep(nanoseconds: 250_000_000)
                        if let s = meter.sample() { progress(s.0, s.1, s.2) }
                    }
                }
                defer { ticker.cancel() }
                try await withThrowingTaskGroup(of: Void.self) { group in
                    for p in parts {
                        group.addTask { try await self.fetch(job: job, part: p, meter: meter) }
                    }
                    try await group.waitForAll()
                }
                if self.isCancelled(job) { throw CancellationError() }
                progress(1, 0, 0)
                done(nil)
            } catch {
                done(self.isCancelled(job) ? (CancellationError() as Error) : error)
            }
            self.forget(job)
        }
        lock.lock(); tasks[job, default: []].append(main); lock.unlock()
    }

    private func request(_ p: Part, range: ClosedRange<Int64>?) -> URLRequest {
        var r = URLRequest(url: p.url)
        r.httpMethod = "GET"
        for (k, v) in p.headers where k.lowercased() != "accept-encoding" { r.setValue(v, forHTTPHeaderField: k) }
        r.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        if let range = range { r.setValue("bytes=\(range.lowerBound)-\(range.upperBound)", forHTTPHeaderField: "Range") }
        r.timeoutInterval = 30
        return r
    }

    /// Asks for the first byte; the Content-Range header tells the full size (and that ranges work).
    private func probeSize(_ p: Part) async throws -> Int64 {
        let (_, resp) = try await session.data(for: request(p, range: 0...0))
        guard let h = resp as? HTTPURLResponse else { return -1 }
        if h.statusCode == 206, let cr = h.value(forHTTPHeaderField: "Content-Range"), let slash = cr.lastIndex(of: "/"),
           let total = Int64(cr[cr.index(after: slash)...]) { return total }
        return -1
    }

    private func fetch(job: String, part p: Part, meter: Meter) async throws {
        let fm = FileManager.default
        try fm.createDirectory(at: p.path.deletingLastPathComponent(), withIntermediateDirectories: true)
        let tmp = p.path.appendingPathExtension("part")
        try? fm.removeItem(at: tmp)

        // No size or no range support: one plain (still native, still fast) download.
        if p.size <= 0 {
            let (file, resp) = try await session.download(for: request(p, range: nil))
            if let h = resp as? HTTPURLResponse, !(200...299).contains(h.statusCode) { throw URLError(.badServerResponse) }
            let n = (try? fm.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.int64Value ?? 0
            meter.add(n)
            try? fm.removeItem(at: p.path)
            try fm.moveItem(at: file, to: p.path)
            return
        }

        fm.createFile(atPath: tmp.path, contents: nil)
        let out = try FileHandle(forWritingTo: tmp)
        try out.truncate(atOffset: UInt64(p.size))
        let writer = Writer(out)
        defer { try? out.close() }

        // pieces of 4 MB (YouTube serves pieces of up to ~10 MB at full speed)
        let piece: Int64 = p.chunk > 0 ? min(p.chunk, 4 << 20) : (4 << 20)
        var ranges: [ClosedRange<Int64>] = []
        var start: Int64 = 0
        while start < p.size { let end = min(p.size - 1, start + piece - 1); ranges.append(start...end); start = end + 1 }
        let workers = min(8, ranges.count)
        let pieces = Pieces(ranges)

        try await withThrowingTaskGroup(of: Void.self) { group in
            for _ in 0..<workers {
                group.addTask {
                    while let r = pieces.take() {
                        if Task.isCancelled || self.isCancelled(job) { throw CancellationError() }
                        var attempt = 0
                        while true {
                            do {
                                let (data, resp) = try await self.session.data(for: self.request(p, range: r))
                                guard let h = resp as? HTTPURLResponse, h.statusCode == 206 || (h.statusCode == 200 && r.lowerBound == 0 && Int64(data.count) == p.size) else {
                                    throw URLError(.badServerResponse)
                                }
                                let expected = r.upperBound - r.lowerBound + 1
                                let body = h.statusCode == 200 ? data.subdata(in: Int(r.lowerBound)..<Int(r.upperBound + 1)) : data
                                if Int64(body.count) != expected { throw URLError(.networkConnectionLost) }
                                try writer.write(body, at: r.lowerBound)
                                meter.add(expected)
                                break
                            } catch {
                                if error is CancellationError || self.isCancelled(job) { throw CancellationError() }
                                attempt += 1
                                if attempt >= 6 { throw error }
                                try await Task.sleep(nanoseconds: UInt64(400_000_000 * attempt))
                            }
                        }
                    }
                }
            }
            try await group.waitForAll()
        }
        try out.synchronize()
        try? out.close()
        try? fm.removeItem(at: p.path)
        try fm.moveItem(at: tmp, to: p.path)
    }
}

/// Writes pieces into the file one at a time (the workers finish in any order).
private final class Writer {
    private let handle: FileHandle
    private let lock = NSLock()
    init(_ handle: FileHandle) { self.handle = handle }
    func write(_ data: Data, at offset: Int64) throws {
        lock.lock(); defer { lock.unlock() }
        try handle.seek(toOffset: UInt64(offset))
        try handle.write(contentsOf: data)
    }
}

/// The pieces of one file still to download (shared by the workers).
private final class Pieces {
    private var list: [ClosedRange<Int64>]
    private var next = 0
    private let lock = NSLock()
    init(_ list: [ClosedRange<Int64>]) { self.list = list }
    func take() -> ClosedRange<Int64>? {
        lock.lock(); defer { lock.unlock() }
        if next >= list.count { return nil }
        next += 1
        return list[next - 1]
    }
}
