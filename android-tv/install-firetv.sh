#!/usr/bin/env bash
# Network-install the OpenHamClock TV build on a Fire TV / Android TV.
# Fire TV: Settings > My Fire TV > About > click Fire TV Stick 7x for
# Developer Options, then enable ADB Debugging (and "Install unknown apps"
# for the Downloader method below).
set -euo pipefail
cd "$(dirname "$0")"

APK="app/build/outputs/apk/debug/app-debug.apk"
if [ ! -f "${APK}" ]; then
  echo "No APK found — build it first: bash build.sh"
  exit 1
fi

TV_IP="${1:-}"
if [ -z "${TV_IP}" ]; then
  read -rp "Fire TV / Android TV IP address: " TV_IP
fi

adb connect "${TV_IP}:5555"
adb install -r "${APK}"
echo
echo "Installed. On Fire TV find it under Settings > Applications >"
echo "Manage Installed Applications > OpenHamClock (sideloaded apps do not"
echo "appear on the home-screen app grid; a sideload launcher helps)."
