#!/usr/bin/env bash
# Downloads Python for iOS (BeeWare's Python-Apple-support) and the pure-Python packages
# Aurora's downloader needs: yt-dlp, its YouTube challenge scripts (yt-dlp-ejs),
# the Apple WebKit challenge solver plugin, and CA certificates. Runs on the macOS CI runner.
set -euo pipefail
cd "$(dirname "$0")/.."
PY_TAG="${PY_TAG:-3.14-b10}"
PY_ASSET="Python-3.14-iOS-support.${PY_TAG#*-}.tar.gz"
rm -rf build-py && mkdir -p build-py/support
curl -fsSL -o build-py/py.tgz "https://github.com/beeware/Python-Apple-support/releases/download/${PY_TAG}/${PY_ASSET}"
tar -xzf build-py/py.tgz -C build-py/support
XC=$(find build-py/support -maxdepth 3 -name 'Python.xcframework' -type d | head -1)
[ -n "$XC" ] || { echo "Python.xcframework not found in ${PY_ASSET}" >&2; find build-py/support -maxdepth 3 >&2; exit 1; }
mv "$XC" build-py/Python.xcframework
echo "Python.xcframework:"; ls build-py/Python.xcframework build-py/Python.xcframework/build

# packages (pure Python only; compiled extras are optional for yt-dlp and are removed)
python3 -m pip install --quiet --upgrade pip
python3 -m pip install --quiet --target build-py/pkgs-all "yt-dlp[default]" yt-dlp-apple-webkit-jsi
mkdir -p build-py/app_packages
for p in yt_dlp yt_dlp_ejs yt_dlp_plugins certifi mutagen; do
  if [ -e "build-py/pkgs-all/$p" ]; then cp -R "build-py/pkgs-all/$p" build-py/app_packages/; else echo "warning: $p not installed"; fi
done
find build-py/app_packages \( -name '*.so' -o -name '*.dylib' -o -name '__pycache__' \) -prune -exec rm -rf {} +
echo "app_packages:"; ls build-py/app_packages
python3 - <<'PY'
import re, pathlib
v = pathlib.Path('build-py/app_packages/yt_dlp/version.py').read_text()
print('yt-dlp', re.search(r"__version__\s*=\s*'([^']+)'", v).group(1))
PY
