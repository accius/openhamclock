# OpenHamClock for Roku

Native SceneGraph channel — **Roku has no WebView**, so this is not a wrapper:
it renders a TV dashboard from the hosted site's public JSON API at
**https://openhamclock.com/api**.

What you get on screen (1080p):

- Header with live UTC clock
- Map-lite: dark equirectangular world map (`images/map.png`, rendered from
  Natural Earth 110m coastline) with a runtime-computed day/night shade
  (48-column terminator from the subsolar point) and a sun marker
- Latest 20 DX cluster spots (`/api/dxcluster/spots`), D-pad scrollable
- Solar strip: SFI / Kp / SSN (`/api/solar-indices`)
- Daytime N0NBH band conditions (`/api/n0nbh`)
- Status line with last-update time

Refresh: data 60s, clock 1s, terminator 5min. `Back` exits (system default).

## Sideload (no store needed)

1. Enable dev mode: Home ×3, Up ×2, Right, Left, Right, Left, Right → note
   the IP and set a password.
2. Package and install:

```bash
cd roku
bash package.sh
curl --digest -u rokudev:PASS -F 'mysubmit=Install' \
     -F 'archive=@dist/openhamclock-roku.zip' http://ROKU_IP/plugin_install
```

3. The channel appears at the end of the home grid while sideloaded.

## Files

| Path                            | Purpose                                           |
| ------------------------------- | ------------------------------------------------- |
| `manifest`                      | Channel metadata, icons, splash screens           |
| `source/main.brs`               | Entry point — opens `MainScene`                   |
| `components/MainScene.xml/.brs` | Layout + clock, terminator math, rendering        |
| `components/ApiTask.xml/.brs`   | Background HTTP fetcher (never blocks UI)         |
| `images/map.png`                | Base map — regenerate with `images/render-map.py` |
| `images/mm_icon_*`              | Channel icons from the official logo              |
| `images/splash_screen_*`        | Splash screens from the official OG art           |

## Publishing notes

Store submission (vanity code / public channel) additionally needs a deep
linking / universal search feed, a content disclaimer if you add more feeds,
and Roku certification — the sideloaded package is otherwise identical.
