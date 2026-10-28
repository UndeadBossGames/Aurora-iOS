"""Aurora for iPhone: the download engine.

Runs yt-dlp (https://github.com/yt-dlp/yt-dlp) inside the app's embedded Python, so the iPhone can
save music and video from YouTube, SoundCloud and 1000+ other sites without a computer.

iOS has no ffmpeg, so:
  * music is saved in a format iOS plays natively (M4A/AAC, or MP3),
  * best-quality video is downloaded as separate video + audio streams and the app merges them
    with AVFoundation (the native side handles the "merge" event),
  * YouTube's JavaScript challenges are solved with Apple WebKit (yt-dlp-apple-webkit-jsi plugin).

The native side talks to this module with JSON strings:
  start(job) -> starts a download in a background thread
  poll()     -> returns and clears the queued events
  cancel(id), search(query), version(), update(), selftest()
"""
import copy
import hashlib
import json
import os
import queue
import sys
import threading
import time
import traceback
import zipfile

# A newer yt-dlp downloaded from inside the app ("Check for update") wins over the bundled one.
_UPDATE_DIR = os.path.join(os.path.expanduser('~'), 'Library', 'aurora-ytdlp')
_UPDATE_ZIP = os.path.join(_UPDATE_DIR, 'yt-dlp.zip')
if os.path.isfile(_UPDATE_ZIP):
    sys.path.insert(0, _UPDATE_ZIP)

try:
    import certifi  # bundled CA certificates for HTTPS
    os.environ.setdefault('SSL_CERT_FILE', certifi.where())
except Exception:  # pragma: no cover
    pass

import yt_dlp  # noqa: E402
from yt_dlp.utils import DownloadCancelled  # noqa: E402

EVENTS = queue.Queue()
JOBS = {}
LOCK = threading.Lock()


def _emit(**ev):
    EVENTS.put(ev)


def _rel(path, root, prefix):
    return prefix + '/' + os.path.relpath(path, root).replace(os.sep, '/')


def _load(arg):
    if not arg:
        return {}
    try:
        return json.loads(arg)
    except Exception:
        return {}


def _clean_error(e):
    msg = str(e).strip() or e.__class__.__name__
    if msg.startswith('ERROR: '):
        msg = msg[7:]
    # strip yt-dlp's colour codes and "[youtube] id:" prefixes
    import re
    msg = re.sub(r'\x1b\[[0-9;]*m', '', msg)
    return msg[:600]


class _Logger:
    """Collects warnings/errors for the job and forwards interesting status lines."""

    def __init__(self, job_id=None):
        self.job_id = job_id
        self.lines = []

    def debug(self, msg):
        if msg.startswith('[debug] '):
            return
        self.info(msg)

    def info(self, msg):
        pass

    def warning(self, msg):
        self.lines.append('WARNING: ' + str(msg))
        self.lines = self.lines[-20:]

    def error(self, msg):
        self.lines.append(str(msg))
        self.lines = self.lines[-20:]


def _base_opts(logger):
    return {
        'quiet': True,
        'no_warnings': False,
        'noprogress': True,
        'logger': logger,
        'noplaylist': True,
        # as fast as the connection allows: no rate limit, parallel fragments, big chunks
        'concurrent_fragment_downloads': 8,
        'http_chunk_size': 10 * 1024 * 1024,
        'retries': 10,
        'fragment_retries': 10,
        'extractor_retries': 3,
        'socket_timeout': 30,
        'windowsfilenames': True,
        'trim_file_name': 140,
        'updatetime': False,
        'overwrites': False,
        'continuedl': True,
        # fetch YouTube's challenge-solver scripts from GitHub if the bundled ones are stale
        'remote_components': ['ejs:github'],
    }


# ---------------------------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------------------------
AUDIO_SPEC = 'ba[ext=m4a]/ba[acodec^=mp4a]/ba[ext=mp3]/ba[acodec=mp3]/b[ext=mp4]/ba/b'
VIDEO_ONLY_SPEC = 'bv[ext=mp4][vcodec^=avc1]{h}/bv[ext=mp4][vcodec^=avc]{h}'
AUDIO_ONLY_SPEC = 'ba[ext=m4a]/ba[acodec^=mp4a]'
SINGLE_SPEC = 'b[ext=mp4][protocol^=http]{h}/b[ext=mp4]{h}/b[ext=mp4][protocol^=http]/b[ext=mp4]/b{h}/b'


def _height_filter(fmt):
    return {'video-1080': '[height<=1080]', 'video-720': '[height<=720]'}.get(fmt, '')


class _Job:
    def __init__(self, data):
        self.id = data['id']
        self.url = data['url']
        self.format = data.get('format') or 'video-best'
        self.playlist = bool(data.get('playlist'))
        self.root = data['root']          # absolute Documents folder
        self.lib_root = data['libRoot']   # absolute Library folder
        self.dir = os.path.join(self.root, data.get('dir') or 'Music/Downloads')
        self.meta = data.get('meta') or {}
        self.source = data.get('source') or ''
        self.cancelled = False
        self.logger = _Logger(self.id)
        self.base = 0.0       # progress range for multi-part downloads
        self.span = 100.0
        self.last_emit = 0.0

    # progress hook shared by all parts
    def hook(self, d):
        if self.cancelled:
            raise DownloadCancelled('Cancelled')
        if d.get('status') != 'downloading':
            return
        now = time.monotonic()
        if now - self.last_emit < 0.25:
            return
        self.last_emit = now
        total = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
        got = d.get('downloaded_bytes') or 0
        frac = (got / total) if total else None
        if frac is None and d.get('fragment_count'):
            frac = (d.get('fragment_index') or 0) / max(1, d['fragment_count'])
        pct = self.base + self.span * min(1.0, frac or 0.0)
        speed = d.get('speed')
        eta = d.get('eta')
        _emit(type='progress', jobId=self.id, progress=round(pct, 1),
              speed=_fmt_speed(speed), eta=_fmt_eta(eta))

    def opts(self, **extra):
        o = _base_opts(self.logger)
        o['progress_hooks'] = [self.hook]
        o['outtmpl'] = {'default': os.path.join(self.dir, '%(title).140B [%(id)s].%(ext)s')}
        o.update(extra)
        return o


def _fmt_speed(b):
    if not b:
        return ''
    for unit in ('B/s', 'KiB/s', 'MiB/s', 'GiB/s'):
        if b < 1024:
            return f'{b:.1f}{unit}' if unit != 'B/s' else f'{int(b)}B/s'
        b /= 1024
    return f'{b:.1f}TiB/s'


def _fmt_eta(s):
    if s is None:
        return ''
    s = int(s)
    return f'{s // 3600}:{(s % 3600) // 60:02d}:{s % 60:02d}' if s >= 3600 else f'{s // 60:02d}:{s % 60:02d}'


def _download_with(job, info, spec, suffix=''):
    """Download one format of an already-extracted video. Returns the file path."""
    extra = {'format': spec}
    if suffix:
        extra['outtmpl'] = {'default': os.path.join(job.dir, '%(title).140B [%(id)s]' + suffix + '.%(ext)s')}
    with yt_dlp.YoutubeDL(job.opts(**extra)) as ydl:
        res = ydl.process_ie_result(copy.deepcopy(info), download=True)
    reqs = (res or {}).get('requested_downloads') or []
    path = reqs[0].get('filepath') if reqs else None
    if not path or not os.path.exists(path):
        raise RuntimeError('The download finished but the file is missing.')
    return path


def _save_cover(job, info, key):
    url = job.meta.get('cover') or info.get('thumbnail')
    if not url:
        thumbs = [t for t in (info.get('thumbnails') or []) if t.get('url')]
        url = thumbs[-1]['url'] if thumbs else None
    if not url:
        return None, None
    try:
        with yt_dlp.YoutubeDL({'quiet': True, 'logger': _Logger()}) as ydl:
            r = ydl.urlopen(url)
            data = r.read()
            ctype = r.headers.get('Content-Type', '') if hasattr(r, 'headers') else ''
        ext = '.png' if 'png' in ctype else '.webp' if 'webp' in ctype else '.jpg'
        folder = os.path.join(job.lib_root, 'aurora-covers')
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, key + ext)
        with open(path, 'wb') as f:
            f.write(data)
        return _rel(path, job.lib_root, 'lib'), (url if url.startswith('https://') else None)
    except Exception:
        return None, (url if url.startswith('https://') else None)


def _track(job, info, path, kind):
    key = hashlib.sha1(path.encode('utf-8', 'replace')).hexdigest()[:16]
    cover, cover_url = _save_cover(job, info, key)
    meta = job.meta
    return {
        'path': _rel(path, job.root, 'docs'),
        'title': meta.get('title') or info.get('track') or info.get('title') or os.path.basename(path),
        'artist': meta.get('artist') or info.get('artist') or info.get('uploader') or info.get('channel') or 'Unknown artist',
        'album': info.get('album') or ('Spotify downloads' if job.source == 'Spotify' else (info.get('extractor_key') or 'Downloads')),
        'duration': float(info.get('duration') or 0),
        'kind': kind,
        'source': job.source or info.get('extractor_key') or 'web',
        'url': info.get('webpage_url') or job.url,
        'size': os.path.getsize(path) if os.path.exists(path) else 0,
        'cover': cover,
        'coverUrl': cover_url,
    }


def _run(job):
    try:
        os.makedirs(job.dir, exist_ok=True)
        _emit(type='status', jobId=job.id, status='downloading', statusText='Finding the media…')

        # Playlists / albums: list the entries and let the app queue them in parallel.
        if job.playlist:
            with yt_dlp.YoutubeDL({**_base_opts(job.logger), 'noplaylist': False, 'extract_flat': 'in_playlist'}) as ydl:
                flat = ydl.extract_info(job.url, download=False, process=True)
            if flat and flat.get('_type') in ('playlist', 'multi_video') and flat.get('entries'):
                entries = []
                for e in flat['entries']:
                    if not e:
                        continue
                    u = e.get('webpage_url') or e.get('url')
                    if not u:
                        continue
                    if not u.startswith('http') and e.get('ie_key') == 'Youtube':
                        u = 'https://www.youtube.com/watch?v=' + u
                    entries.append({'url': u, 'title': e.get('title') or u, 'thumbnail': (e.get('thumbnails') or [{}])[-1].get('url')})
                _emit(type='expand', jobId=job.id, title=flat.get('title') or 'Playlist', entries=entries)
                return

        with yt_dlp.YoutubeDL(job.opts()) as ydl:
            info = ydl.extract_info(job.url, download=False)
        if info and info.get('_type') in ('playlist', 'multi_video'):
            entries = [e for e in (info.get('entries') or []) if e]
            if not entries:
                raise RuntimeError('Nothing to download at that link.')
            info = entries[0]
        if job.cancelled:
            raise DownloadCancelled('Cancelled')
        _emit(type='start', jobId=job.id, title=info.get('title') or job.url, thumbnail=info.get('thumbnail'))

        want_video = job.format.startswith('video')
        h = _height_filter(job.format)
        if not want_video:
            job.base, job.span = 0.0, 100.0
            path = _download_with(job, info, AUDIO_SPEC)
            _emit(type='file', jobId=job.id, track=_track(job, info, path, 'audio'))
            _emit(type='done', jobId=job.id)
            return

        # Best quality: separate H.264 video + AAC audio, merged by the app (no ffmpeg on iOS).
        formats = info.get('formats') or []
        has_split = any((f.get('vcodec') or 'none') != 'none' and (f.get('acodec') or 'none') == 'none' for f in formats) \
            and any((f.get('acodec') or 'none') != 'none' and (f.get('vcodec') or 'none') == 'none' for f in formats)
        if has_split:
            try:
                job.base, job.span = 0.0, 82.0
                vpath = _download_with(job, info, VIDEO_ONLY_SPEC.format(h=h) + '/' + VIDEO_ONLY_SPEC.format(h=''), '.video')
                job.base, job.span = 82.0, 18.0
                apath = _download_with(job, info, AUDIO_ONLY_SPEC, '.audio')
                out = vpath.replace('.video.', '.', 1)
                if out == vpath:
                    out = os.path.splitext(vpath)[0] + '.merged.mp4'
                out = os.path.splitext(out)[0] + '.mp4'
                track = _track(job, info, out, 'video')
                _emit(type='merge', jobId=job.id, video=vpath, audio=apath, out=out, track=track)
                return  # the app emits "file" + "done" after merging
            except DownloadCancelled:
                raise
            except Exception as e:  # no matching split formats: fall back to a single file
                job.logger.warning(f'split download failed, using single file: {e}')
        job.base, job.span = 0.0, 100.0
        path = _download_with(job, info, SINGLE_SPEC.format(h=h))
        _emit(type='file', jobId=job.id, track=_track(job, info, path, 'video'))
        _emit(type='done', jobId=job.id)
    except DownloadCancelled:
        _emit(type='cancelled', jobId=job.id)
    except Exception as e:
        err = _clean_error(e)
        tail = [line for line in job.logger.lines if not line.startswith('WARNING')]
        if tail and err in ('', 'None'):
            err = _clean_error(tail[-1])
        _emit(type='error', jobId=job.id, error=err)
    finally:
        with LOCK:
            JOBS.pop(job.id, None)


def start(arg):
    data = _load(arg)
    job = _Job(data)
    with LOCK:
        JOBS[job.id] = job
    threading.Thread(target=_run, args=(job,), name='aurora-dl-' + job.id, daemon=True).start()
    return json.dumps({'ok': True})


def cancel(arg):
    data = _load(arg)
    with LOCK:
        job = JOBS.get(data.get('id'))
    if job:
        job.cancelled = True
    return json.dumps({'ok': bool(job)})


def poll(arg=None):
    out = []
    while True:
        try:
            out.append(EVENTS.get_nowait())
        except queue.Empty:
            break
    return json.dumps(out)


# ---------------------------------------------------------------------------------------------
# Search (Discover)
# ---------------------------------------------------------------------------------------------
def search(arg):
    a = _load(arg)
    q = str(a.get('q') or '').strip()
    if not q:
        return json.dumps({'ok': True, 'results': []})
    sc = a.get('source') == 'soundcloud'
    n = max(1, min(12 if sc else 30, int(a.get('limit') or 18)))
    logger = _Logger()
    opts = {**_base_opts(logger), 'skip_download': True, 'ignoreerrors': True}
    if not sc:
        opts['extract_flat'] = 'in_playlist'
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            data = ydl.extract_info(f"{'scsearch' if sc else 'ytsearch'}{n}:{q}", download=False)
    except Exception as e:
        return json.dumps({'ok': False, 'error': _clean_error(e)})
    out = []
    for e in (data or {}).get('entries') or []:
        if not e:
            continue
        vid = e.get('id')
        url = e.get('webpage_url') or e.get('url') or (None if sc else f'https://www.youtube.com/watch?v={vid}')
        thumbs = [t for t in (e.get('thumbnails') or []) if t and t.get('url')]
        thumb = (e.get('thumbnail') or (thumbs[-1]['url'] if thumbs else None)) if sc else f'https://i.ytimg.com/vi/{vid}/hqdefault.jpg'
        if not url or e.get('live_status') == 'is_live':
            continue
        out.append({'id': vid, 'url': url, 'source': 'SoundCloud' if sc else 'YouTube', 'title': e.get('title') or e.get('track') or 'Untitled',
                    'channel': e.get('channel') or e.get('uploader') or e.get('artist') or '', 'duration': float(e.get('duration') or 0),
                    'views': int(e.get('view_count') or 0), 'thumbnail': thumb, 'live': False})
    return json.dumps({'ok': True, 'results': out})


# ---------------------------------------------------------------------------------------------
# Info, updates and self-test
# ---------------------------------------------------------------------------------------------
def _plugins():
    found = []
    for name in ('yt_dlp_plugins.extractor.ytjsc', 'yt_dlp_ejs'):
        try:
            __import__(name)
            found.append(name)
        except Exception as e:
            found.append(f'{name} (failed: {e.__class__.__name__}: {e})')
    return found


def version(arg=None):
    return json.dumps({
        'ok': True, 'python': sys.version.split()[0], 'ytdlp': yt_dlp.version.__version__,
        'updated': os.path.isfile(_UPDATE_ZIP), 'plugins': _plugins(), 'platform': sys.platform,
    })


def update(arg=None):
    """Download the newest yt-dlp release; it's used the next time Aurora starts."""
    url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp'
    try:
        os.makedirs(_UPDATE_DIR, exist_ok=True)
        tmp = _UPDATE_ZIP + '.part'
        with yt_dlp.YoutubeDL({'quiet': True, 'logger': _Logger()}) as ydl:
            data = ydl.urlopen(url).read()
        with open(tmp, 'wb') as f:
            f.write(data)
        with zipfile.ZipFile(tmp) as z:
            ver = z.read('yt_dlp/version.py').decode('utf-8', 'replace')
        import re
        m = re.search(r"__version__\s*=\s*'([^']+)'", ver)
        new = m.group(1) if m else '?'
        if new == yt_dlp.version.__version__:
            os.remove(tmp)
            return json.dumps({'ok': True, 'version': new, 'changed': False})
        os.replace(tmp, _UPDATE_ZIP)
        return json.dumps({'ok': True, 'version': new, 'changed': True})
    except Exception as e:
        return json.dumps({'ok': False, 'error': _clean_error(e)})


def selftest(arg=None):
    """Used by the CI simulator test: checks Python, yt-dlp, plugins and one YouTube lookup."""
    a = _load(arg)
    out = json.loads(version())
    t0 = time.time()
    try:
        logger = _Logger()
        with yt_dlp.YoutubeDL({**_base_opts(logger), 'skip_download': True}) as ydl:
            info = ydl.extract_info(a.get('url') or 'https://www.youtube.com/watch?v=jNQXAC9IVRw', download=False)
        fmts = info.get('formats') or []
        out['youtube'] = {'ok': True, 'title': info.get('title'), 'formats': len(fmts),
                          'split': sum(1 for f in fmts if (f.get('acodec') or 'none') == 'none'),
                          'warnings': logger.lines[-6:], 'seconds': round(time.time() - t0, 1)}
    except Exception as e:
        out['youtube'] = {'ok': False, 'error': _clean_error(e), 'trace': traceback.format_exc()[-1500:], 'seconds': round(time.time() - t0, 1)}
    return json.dumps(out)
