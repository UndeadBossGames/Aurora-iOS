// Aurora for iPhone: cuts the silent ending off downloads.
// Many uploads keep going after the music stops (an outro screen, a long fade to nothing, a silent
// tail). This listens to the whole audio track, finds the last moment you can hear anything and cuts
// the file there (no re-encoding: the audio and video are copied as they are, so quality is the same).
import Foundation
import AVFoundation

enum SilenceTrim {
    struct Result {
        let trimmed: Bool          // the file was rewritten
        let end: Double            // last audible moment + a short tail (seconds)
        let duration: Double       // length of the file now
        let size: Int
    }

    /// Anything quieter than this counts as silence (-50 dBFS, RMS over 50 ms).
    static let threshold: Float = 0.0032
    /// Only cut when at least this much silence is at the end.
    static let minSilence: Double = 1.5
    /// Keep a little of the fade after the last sound.
    static let tail: Double = 0.35

    /// When the audio really ends, in seconds; nil if the file has no audio or can't be read.
    static func lastSound(of url: URL) async throws -> (last: Double, total: Double)? {
        let asset = AVURLAsset(url: url)
        guard let track = try await asset.loadTracks(withMediaType: .audio).first else { return nil }
        let total = try await asset.load(.duration).seconds
        guard total.isFinite, total > 0 else { return nil }

        let reader = try AVAssetReader(asset: asset)
        // a small, mono, 8 kHz copy is plenty to tell sound from silence and decodes fast
        let rate = 8000.0
        let out = AVAssetReaderTrackOutput(track: track, outputSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: rate,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 32,
            AVLinearPCMIsFloatKey: true,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
        ])
        out.alwaysCopiesSampleData = false
        guard reader.canAdd(out) else { return nil }
        reader.add(out)
        guard reader.startReading() else { throw reader.error ?? NSError(domain: "Aurora", code: 10) }

        let window = Int(rate * 0.05)       // 50 ms
        var sumSq: Float = 0
        var count = 0
        var index = 0                       // samples read so far
        var lastLoud = -1                   // sample index where the last loud window ended
        while let buf = out.copyNextSampleBuffer() {
            guard let block = CMSampleBufferGetDataBuffer(buf) else { continue }
            let total = CMBlockBufferGetDataLength(block)
            var offset = 0
            while offset < total {
                // a block buffer can be split into several memory chunks
                var length = 0
                var ptr: UnsafeMutablePointer<Int8>?
                guard CMBlockBufferGetDataPointer(block, atOffset: offset, lengthAtOffsetOut: &length, totalLengthOut: nil, dataPointerOut: &ptr) == kCMBlockBufferNoErr,
                      let raw = ptr, length > 0 else { break }
                let n = length / MemoryLayout<Float>.size
                let start = index
                raw.withMemoryRebound(to: Float.self, capacity: n) { s in
                    for i in 0..<n {
                        let v = s[i]
                        sumSq += v * v
                        count += 1
                        if count == window {
                            if (sumSq / Float(count)).squareRoot() > threshold { lastLoud = start + i + 1 }
                            sumSq = 0; count = 0
                        }
                    }
                }
                index += n
                offset += length
            }
        }
        if count > 0, (sumSq / Float(count)).squareRoot() > threshold { lastLoud = index }
        if reader.status == .failed { throw reader.error ?? NSError(domain: "Aurora", code: 11) }
        if lastLoud < 0 { return (0, total) }   // completely silent
        return (Double(lastLoud) / rate, total)
    }

    /// Cuts the silent ending off `url` in place (MP4/M4A/MOV). Other formats are measured but not
    /// rewritten; the app then stops playback at `end` instead.
    static func trim(_ url: URL) async -> Result? {
        let size0 = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue ?? 0
        guard let found = try? await lastSound(of: url) else { return nil }
        let total = found.total
        // nothing audible at all (or almost): leave it alone, it's probably not a song
        if found.last < 3 { return Result(trimmed: false, end: total, duration: total, size: size0) }
        let end = min(total, found.last + tail)
        if total - end < minSilence { return Result(trimmed: false, end: total, duration: total, size: size0) }

        let ext = url.pathExtension.lowercased()
        let type: AVFileType? = ["mp4", "m4v"].contains(ext) ? .mp4 : ext == "m4a" ? .m4a : ext == "mov" ? .mov : nil
        guard let fileType = type else { return Result(trimmed: false, end: end, duration: total, size: size0) }

        let asset = AVURLAsset(url: url)
        guard let ex = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else {
            return Result(trimmed: false, end: end, duration: total, size: size0)
        }
        let tmp = url.deletingLastPathComponent().appendingPathComponent(".trim-\(UUID().uuidString).\(ext)")
        ex.outputURL = tmp
        ex.outputFileType = fileType
        ex.timeRange = CMTimeRange(start: .zero, end: CMTime(seconds: end, preferredTimescale: 48000))
        ex.shouldOptimizeForNetworkUse = true
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in ex.exportAsynchronously { c.resume() } }
        guard ex.status == .completed else {
            try? FileManager.default.removeItem(at: tmp)
            return Result(trimmed: false, end: end, duration: total, size: size0)
        }
        do {
            _ = try FileManager.default.replaceItemAt(url, withItemAt: tmp)
        } catch {
            try? FileManager.default.removeItem(at: tmp)
            return Result(trimmed: false, end: end, duration: total, size: size0)
        }
        let newDur = (try? await AVURLAsset(url: url).load(.duration).seconds) ?? end
        let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue ?? size0
        return Result(trimmed: true, end: newDur, duration: newDur, size: size)
    }
}
