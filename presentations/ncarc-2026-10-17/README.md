# OpenHamClock — Northern Colorado Amateur Radio Club (Saturday, October 17, 2026, 10:30 AM MT)

A ~40-minute Reveal.js deck about OpenHamClock for a general ham radio club
audience: what it is, why you would run it, how to shape it to the way you
operate, a live demo, and a "coming soon" section covering everything that is
merged on Staging for the next monthly release. In-person talk, Loveland, CO, after the 9 AM club meeting.

Screenshots live in [`../shared-2026-10/`](../shared-2026-10/) and are shared
with the companion deck [`pwa-2026-10-19`](../pwa-2026-10-19/) — the two decks differ
only in their title, local flavour and closing slide. Copy both folders if you
take this deck elsewhere.

## Run it

A single self-contained HTML file with Reveal.js loaded from CDN. No build step.

```bash
cd presentations/ncarc-2026-10-17
open index.html              # macOS
xdg-open index.html          # Linux
start index.html             # Windows
```

For the projector open it in Chrome / Edge / Safari and press `F` for
fullscreen.

## Presenting

| Key                 | Action                                                                     |
| ------------------- | -------------------------------------------------------------------------- |
| `Space` / `→`       | Next slide                                                                 |
| `←` / `Shift+Space` | Previous slide                                                             |
| `S`                 | Open **speaker view** in a new window (notes + timer + next-slide preview) |
| `F`                 | Fullscreen                                                                 |
| `Esc`               | Slide overview                                                             |
| `B` / `.`           | Black out the screen                                                       |
| `L`                 | Open **openhamclock.com** in a new tab (the live-demo slide)               |
| `?`                 | Reveal.js help                                                             |

Every slide has condensed speaker notes (press `S`). The long-form script with
prepared Q&A answers is in [`speaker-notes.md`](./speaker-notes.md).

## Before the talk

1. **Warm up the demo tab.** Open <https://openhamclock.com> in a second tab of
   the same browser window, enter your callsign and grid, switch to the
   Dockable layout, and leave it running for a few minutes so the cluster,
   solar imagery and PSKReporter have data.
2. **Check the coming-soon screenshots still match.** They were captured from
   Staging on 2026-10-14. If the release has shipped by the talk, say so on
   slide 20 ("this shipped last week") and keep going.
3. Fill in the two `[BRACKETS]` placeholders on slide 1 (licensed since, QTH).
4. Turn off notifications. Bring an HDMI adapter and the speaker-view laptop.

## The live-demo slide

Slide 18 is a "switch to the live site" slide — OpenHamClock blocks iframe
embedding on purpose. Press `L` (or click the button), switch tabs, run the
five-step demo in the speaker notes (map → spot → filters → propagation
SSB→FT8 → layouts → Ctrl+K), switch back. Five minutes. Do not change
settings you will forget to undo.

## Slide-by-slide timing

| #   | Slide                                    | Length   |
| --- | ---------------------------------------- | -------- |
| 1   | Title                                    | 0:30     |
| 2   | In one breath + hands check              | 1:30     |
| 3   | For WB0OEW                               | 1:00     |
| 4   | Why: the eight-tab problem               | 1:30     |
| 5   | How it fits together                     | 2:00     |
| 6   | Ninety seconds to operating              | 1:30     |
| 7   | The big picture (hero)                   | 1:30     |
| 8   | The map — three projections, layers      | 2:00     |
| 9   | Spots — cluster, filters, badges, PSK    | 2:30     |
| 10  | Activations — POTA/SOTA/WWFF/WWBOTA      | 1:30     |
| 11  | Propagation + solar + Prediction Check   | 2:30     |
| 12  | Satellites · APRS · EmComm               | 2:00     |
| 13  | Logbook & awards                         | 1:30     |
| 14  | Rig Bridge                               | 2:00     |
| 15  | Make it yours 1 — layouts                | 1:30     |
| 16  | Make it yours 2 — panels/themes/profiles | 2:00     |
| 17  | Make it yours 3 — alerts & kiosk         | 1:30     |
| 18  | **LIVE DEMO**                            | **5:00** |
| 19  | Install options                          | 1:30     |
| 20  | Coming soon — intro + numbers            | 1:00     |
| 21  | Coming soon — time shift & planners      | 1:30     |
| 22  | Coming soon — things nobody has          | 2:00     |
| 23  | Coming soon — remote, kiosk, Pi hardware | 1:30     |
| 24  | Coming soon — weather & sky              | 1:00     |
| 25  | Coming soon — cluster & satellites       | 1:00     |
| 26  | Get involved                             | 1:00     |
| 27  | Thanks + Q&A                             | rest     |

Scripted total: ~40 min, then Q&A.

## Trim for a 25-minute slot

Drop slides 5, 12, 17 and 24, cut the demo to 3 minutes, and present slides
21–25 as one pass ("here are the headlines") — lands at ~25 min.

## License

Same as the project (MIT). Re-use for any non-malicious purpose; attribution
appreciated but not required.
