# OpenHamClock for Android TV

Native Leanback wrapper that shows **https://openhamclock.com/** full-screen on
Android TV, Google TV, Fire TV sticks/boxes, and generic AOSP boxes.

- Zero framework dependencies — plain `WebView`, no AndroidX needed.
- Leanback launcher banner + phone launcher icon (sideload-friendly).
- D-pad arrows / SELECT pass straight to the page for map and panel navigation.
- `BACK` steps through page history; double-press exits.
- `MENU` / `INFO` / `GUIDE` reloads the dashboard.
- Offline error screen with a D-pad-focusable **Retry** button.
- `FLAG_KEEP_SCREEN_ON` so the shack TV never sleeps mid-pileup.
- Auto-starts on boot for dedicated displays (remove `BootReceiver` from
  `AndroidManifest.xml` if you don't want that).
- Appends `OpenHamClockTV/1.0` to the WebView user agent for server-log filtering.

## Build

Requirements: JDK 17 + Android SDK (platform 34, build-tools 34.0.0).

```bash
cd android-tv
bash build.sh
# -> app/build/outputs/apk/debug/app-debug.apk
```

`build.sh` downloads Gradle 8.7 to `/tmp/opencode` if `gradle` isn't on `PATH`,
and writes `local.properties` from `$ANDROID_HOME` (or `~/Android/Sdk`).

Or open the `android-tv/` folder in Android Studio and Run on your TV device.

## Sideload

```bash
adb connect <tv-ip>:5555        # network debugging; skip on USB
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Fire TV: enable Apps from Unknown Sources, then install via
[Downloader](https://www.aftvnews.com/downloader/) or `adb`.

## Fire TV installer

Fire OS is Android, so the same APK works on Fire TV sticks/boxes
(Fire OS 5+, i.e. all of them). Either sideload the APK through the
Downloader app, or push it over the network:

```bash
cd android-tv
bash install-firetv.sh <fire-tv-ip>   # prompts if IP omitted
```

Sideloaded apps don't appear on the Fire TV home-screen grid — open them
from Settings → Applications → Manage Installed Applications, or install a
sideload launcher. No code changes needed: the manifest declares both the
`LEANBACK_LAUNCHER` and regular `LAUNCHER` categories and marks
touchscreen/leanback features as not required, so Fire OS accepts it.

On first launch, sign-up-free: set your callsign/grid on the site itself and
the TV keeps the cookies. For a shack display, enable the site's
Settings → **Prevent sleep** and **Scene rotation** too.

## TV remote map

| Key                 | Action                               |
| ------------------- | ------------------------------------ |
| D-pad / SELECT      | Navigate page, scroll map            |
| Back                | Page back, else double-press to exit |
| Menu / Info / Guide | Reload dashboard                     |
| Play/Pause etc.     | Passed to page (media panels)        |

## Point it at your own server

Edit `MainActivity.java`:

```java
private static final String HOME_URL = "http://your-pi:3000/";
```

Rebuild. Cleartext (`http://`) LAN URLs also need
`android:usesCleartextTraffic="true"` in the manifest.

## Release notes

- `debug` builds use `com.openhamclock.tv.debug`; release builds use
  `com.openhamclock.tv`. Uninstall one before installing the other.
- App icon (`ic_launcher.png`) and Leanback banner (`tv_banner.png`, 320×180)
  are the official OpenHamClock artwork from `public/icons/`. If the logo is
  ever refreshed, re-export from those sources.
- Play Store release additionally needs: signed `assembleRelease`, a privacy
  policy URL, Leanback screenshots, and a content rating questionnaire.
- Keep Android System WebView updated on the TV — the dashboard's 3D globe
  needs current WebGL; without it the site falls back to the flat map.
