#!/usr/bin/env bash
# Build a debuggable sideload APK for the OpenHamClock Android TV wrapper.
set -euo pipefail
cd "$(dirname "$0")"

GRADLE_VERSION="8.7"
GRADLE_DIR="/tmp/opencode/gradle-${GRADLE_VERSION}"
GRADLE_BIN=""

if command -v gradle >/dev/null 2>&1; then
  GRADLE_BIN="gradle"
else
  if [ ! -x "${GRADLE_DIR}/bin/gradle" ]; then
    echo "Downloading Gradle ${GRADLE_VERSION}…"
    mkdir -p /tmp/opencode
    curl -fsSL -o /tmp/opencode/gradle.zip \
      "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip"
    rm -rf "${GRADLE_DIR}"
    unzip -q /tmp/opencode/gradle.zip -d /tmp/opencode
  fi
  GRADLE_BIN="${GRADLE_DIR}/bin/gradle"
fi

# Point Gradle at the Android SDK (env var wins, then the standard location).
if [ -z "${ANDROID_HOME:-}" ]; then
  if [ -d "$HOME/Android/Sdk" ]; then
    export ANDROID_HOME="$HOME/Android/Sdk"
  elif [ -d "$HOME/Library/Android/sdk" ]; then
    export ANDROID_HOME="$HOME/Library/Android/sdk"
  fi
fi
if [ -n "${ANDROID_HOME:-}" ] && [ ! -f local.properties ]; then
  echo "sdk.dir=${ANDROID_HOME}" > local.properties
fi

"${GRADLE_BIN}" assembleDebug --console=plain

APK="app/build/outputs/apk/debug/app-debug.apk"
echo
echo "Built: android-tv/${APK}"
echo "Sideload: adb install -r ${APK}"
