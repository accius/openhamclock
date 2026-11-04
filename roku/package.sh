#!/usr/bin/env bash
# Package the OpenHamClock Roku channel for sideloading.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf dist && mkdir -p dist
python3 - "$PWD" <<'EOF'
import os, sys, zipfile
root = sys.argv[1]
out = os.path.join(root, "dist", "openhamclock-roku.zip")
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    z.write(os.path.join(root, "manifest"), "manifest")
    for folder in ("source", "components", "images"):
        d = os.path.join(root, folder)
        for base, _, files in os.walk(d):
            for f in sorted(files):
                p = os.path.join(base, f)
                z.write(p, os.path.relpath(p, root))
print("wrote", out, f"({os.path.getsize(out)} bytes)")
EOF
echo "Sideload: enable dev mode on the Roku, then"
echo "  curl --digest -u rokudev:PASS -F 'mysubmit=Install' \\"
echo "       -F 'archive=@dist/openhamclock-roku.zip' http://ROKU_IP/plugin_install"
