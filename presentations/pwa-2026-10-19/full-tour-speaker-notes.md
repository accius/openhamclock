# Speaker Notes — Penn Wireless Association Talk (Monday, October 19, 2026, 7:00 PM ET)

Long-form script, one section per slide, with prepared answers for the usual
questions at the end. The same text, condensed, lives in the deck's speaker view
(press `S`). Stage directions are in _[brackets]_; everything else is meant to
be spoken. Fill in the `[BRACKETS]` placeholders on slide 1 before Monday. This one is hybrid: share the browser window on Zoom, not the
screen, and watch the chat during Q&A.

Target: 40 minutes scripted, then Q&A. The timing column in the README is the
budget; the demo is the only place to make up time.

---

## Slide 1 — Title (0:30)

> Good evening, and thanks for having me — in the room and on Zoom. I'm Chris Hetherington, K0CJH,
> [LICENSED SINCE YEAR], and I operate from [LOCATION]. I'm the developer
> behind OpenHamClock. Over the next forty minutes I want to cover four
> things: what it is, why you'd want it running in your shack, how you bend
> it to the way you operate, and what's about to ship. There's a live demo in
> the middle, and we'll keep time for questions at the end. The site is live
> right now at openhamclock.com, so if you have a laptop or a phone open,
> follow along, and if you're on Zoom, open it in another window.

_Don't read the title. Make eye contact with the back row in the first ten
seconds._

## Slide 2 — In one breath (1:30)

> In one breath: OpenHamClock is everything happening on the air, on one
> screen, in any browser. The DX cluster, parks and summits, PSKReporter,
> DXpeditions, contests. Propagation that's actually computed for your
> location, not a screenshot from somewhere else. Satellites, APRS, space
> weather, and a logbook that knows what you still need. And when you click a
> spot, your radio tunes. It's free and open source.

_Hands check, fast, don't dwell:_

> Who runs the original HamClock on a Pi today? Who has a cluster page or
> PSKReporter bookmarked? Who has more than four browser tabs open in the
> shack right now? Right. That's the problem this solves.

## Slide 3 — For WB0OEW (1:00)

> Before anything new, I want to acknowledge where this comes from. Elwood
> Downey, WB0OEW, built the original HamClock, the little dashboard you've
> seen on Raspberry Pis everywhere. Elwood became a Silent Key early this
> year. OpenHamClock is not a fork of his code; it's a ground-up rewrite for
> the web. But the goal is exactly his: one screen that tells an operator
> what's happening in the world. The dedication in the license file is real.

_[Pause a beat, then advance.]_

## Slide 4 — Why: the eight-tab problem (1:30)

> So why would you run it? Because the shack has an eight-tab problem. Think
> about what's open when you sit down: a cluster page, PSKReporter, some
> VOACAP site, the POTA app, SOTAwatch, a satellite tracker, SWPC, a weather
> app, your logger, and your rig control program. None of them know about
> each other.
>
> OpenHamClock puts all of that on one map with your station in the middle.
> The spot, the great-circle path, the prediction for that path, and whether
> you've worked that station before, all in one row. Click it, the radio
> tunes, log it. And it scales from a wall display on a Pi down to your phone.
> The value isn't one feature. It's that everything shares the same map and
> the same logbook.

## Slide 5 — How it fits together (2:00)

> Quick architecture, because it explains the install options later. Three
> pieces. The browser is the dashboard, and it does more than you'd think: the
> propagation engine runs in your browser as WebAssembly, so predictions are
> computed on your machine. The server talks to the cluster, the Reverse
> Beacon Network, POTA, NOAA, NASA, the satellite databases, and caches all of
> it so a thousand users don't make a thousand requests. That server is either
> openhamclock.com or your own box. And Rig Bridge is a small optional program
> on the PC next to your radio for CAT control, WSJT-X, your rotator, an APRS
> TNC, and soon hardware sensors.
>
> Two things to know. The hosted site runs our own DX cluster node now, so
> we're not at the mercy of public nodes; it aggregates the RBN skimmers and
> human spots and balances the modes so SSB and CW survive the FT8 flood. And
> there are no accounts and no tracking. Your settings live in your browser;
> you can sync them or share them with a code if you want.

## Slide 6 — Ninety seconds (1:30)

> Getting started is genuinely ninety seconds. Open the site, enter your
> callsign and grid, or let it use your location. Pick a layout; Modern is a
> good first one. Set a DX target by typing a call or clicking the map. That's
> it; you're operating. Units, time zone, your propagation mode and power are
> a few more clicks when you want them. Everything else in this talk is
> layered on when and if you want it. Nothing is required.

## Slide 7 — The big picture (1:30)

> Here's what it looks like. This is the dockable layout, the one I'd push
> most people toward after a day. Callsign and clocks up top, UTC and local.
> Space weather across the header: SFI, K, sunspot number, solar wind, and a
> one-word verdict. Down the left, your station panel with sunrise, sunset and
> local weather, and live solar imagery from NASA. The map in the middle with
> the terminator and the great-circle paths of the last few minutes of spots.
> The DX cluster and the DXpedition calendar on the right. Band buttons along
> the bottom filter the whole map. Every panel docks, undocks, resizes and can
> be swapped for any of eighty-odd others. We'll come back to that.

## Slide 8 — The map (2:00)

> The map is the application, and you get three projections. Flat is the
> everyday one, with eleven basemaps. Azimuthal is centered on you, so a
> straight line out from the middle is the true beam heading, which is how a
> rotator thinks. And the 3D globe puts satellites at their actual altitude
> with great-circle arcs that look like great circles.
>
> On all three: the gray line updates live with the three twilight bands,
> short and long path to your DX, and more than thirty layers: aurora, D-layer
> absorption, MUF, the VOACAP heatmap, grid squares, zones, weather radar,
> lightning, earthquakes, wildfires, live aircraft, NASA's city lights. Click
> anywhere and you get distance, bearing, grid, local time and the nearest
> city, with a one-click set-as-DX.

## Slide 9 — Spots (2:30)

> The DX cluster has looked the same since 1989, and this is the version you
> wish you'd had. A real mode column. Filter by band, mode, continent, zone,
> grid, your own watch list, and keep an exclude list for calls you never want
> to see again.
>
> The badges are the part I use most: the panel checks your logbook and tags
> each spot NEW if you've never worked the entity, BAND if you need the band
> slot, DUPE if you've already got him on this band and mode. Hover a row and
> the path draws on the map; click it and it becomes your DX, tunes the radio,
> and offers to log it. Click the callsign and you get his name, QTH, grid,
> and the local time at his end, which is half of deciding whether to sit in a
> pileup. And the headphones icon on every row opens the nearest live KiwiSDR
> tuned to that frequency, so you can hear the station with no radio in front
> of you. Below the cluster, PSKReporter runs live over MQTT.

## Slide 10 — Activations (1:30)

> Between DX openings, the same map covers the portable world. POTA, SOTA,
> WWFF and WWBOTA each get their own markers and panel, with the same filters,
> click-to-tune and badges. Set an audio alert and you can be in the garage
> and still hear when an activator shows up on seventeen meters. Two dedicated
> layouts: Activator, which self-spots to POTA and shows who's hunting you,
> and Hunter, which is everything portable sorted by what you still need. And
> since this club runs the PA QSO Party: the contest filter and the Contest
> layout were built for exactly that firehose, and the POTA layer makes Tyler
> and the other state parks easy to pick out when your members are activating.

## Slide 11 — Propagation (2:30)

> Most propagation tools are screenshots of somebody else's prediction.
> OpenHamClock runs the ITU-R P.533 engine, the physics VOACAP is built on,
> compiled to WebAssembly, in your browser, for your station. The chart shows
> per-band reliability from you to your DX across the day with your mode,
> power and antenna. And it runs each mode at its real decode threshold: FT8
> at minus nineteen dB, CW at plus five, SSB at plus ten. That's why FT8
> bands here are open when other tools say closed. Bucks County to Tokyo,
> fifteen meters, late morning: zero on SSB, about sixty on FT8. That matches
> what you hear.
>
> World heatmap, MUF map, live ionosonde readings, band conditions, and
> band-opening alerts that fire when the spots say a band has opened toward
> Europe or Asia from here. The solar side has everything: SFI, sunspots, K
> and A, X-ray flux so you see the flare before the band drops, solar wind and
> Bz, live NASA imagery, SWPC alerts.
>
> The panel on the right, Prediction Check, is new this week. It puts the
> model's prediction for your DE-to-DX path next to what's actually being
> spotted on that path, and says in plain words whether the band is open,
> marginal or closed.

## Slide 12 — Satellites · APRS · EmComm (2:00)

> The rest of the hobby lives here too. Satellites: live SGP4 tracking with
> footprints and tracks on every projection, a 24-hour pass list for your
> location, AMSAT status, SatNOGS transponder data, and an EME layout with a
> satellite relay planner. APRS from the internet or from a TNC on your own
> radio through Rig Bridge. And the EmComm layout is a full emergency
> communications dashboard: NWS alerts, FEMA shelters, Winlink gateways, a net
> roster that fills from RF check-ins, an event log, and after-action
> reports. It was built alongside real EOC operators who filed about twenty
> issues in two weeks. If your ARES group wants a common operating picture,
> this is it.

## Slide 13 — Logbook & awards (1:30)

> The logbook turns this from a dashboard you watch into a station you
> operate. It lives in your browser, imports and exports ADIF, logs straight
> from any spot. Once your log is in, the whole dashboard knows what you need:
> DXCC, WAZ, WAS and VUCC progress, and those NEW and BAND badges on every
> spot. It syncs with Wavelog and Cloudlog both ways, pushes to QRZ Logbook,
> pulls LoTW confirmations. N1MM, DXLog and N3FJP QSOs show up on the map as
> you type them. A shared group log for Field Day, and a Contest layout with
> a rate meter, multipliers and a dupe sheet.

## Slide 14 — Rig Bridge (2:00)

> Click a spot and your radio tunes, with the right mode, while the other guy
> is still spinning his VFO. That's Rig Bridge, a small program next to the
> radio. Direct USB to Yaesu, Kenwood, Elecraft and Icom, no hamlib needed;
> also rigctld, flrig, TCI, the Flex over SmartSDR, and an RTL-SDR for
> receive. It drives rotators and draws your heading on the map. WSJT-X and
> friends stream decodes onto the map and you can reply from the dashboard. It
> handles an APRS TNC, Winlink and MeshCom. The cloud relay lets you run the
> shack from a hotel room. And the band plan is overlaid on the frequency
> display, so it warns you before you transmit where your license class
> doesn't allow.

## Slide 15 — Make it yours 1: layouts (1:30)

> Now the part people underestimate: shaping it to you. Thirteen layouts.
> Classic looks like the HamClock you know. Modern is the default. Dockable
> lets you build your own from any panel. Compact for four-by-three monitors;
> Tablet for a landscape tablet by the rig. Clock is a big clock with an idle
> mode. Then the operating ones: Contest, EmComm, EME, Activator, Hunter,
> Weather, Air Traffic. Switch any time.

## Slide 16 — Make it yours 2: panels, themes, profiles (2:00)

> Inside the dockable layout there are more than eighty panels; press the plus
> and they're listed by group. Drag them into tabs, resize, tear off. Save
> presets: one for the Monday night net, one for contest weekends, one for the
> wall display. Fourteen themes, from a light one for a sunny room to Retro to
> Star Trek LCARS, plus an editor for your own. Profiles are the whole
> configuration with share codes: set up a layout for the club and hand it to
> a new member as one string. Control-K opens a command palette; every layer
> and panel has a single-key shortcut. And the basics: font and header size,
> twelve or twenty-four hour, units, time zone, sixteen languages, and a
> screen-reader text view of the entire map.

## Slide 17 — Make it yours 3: alerts & kiosk (1:30)

> Alerts: every feed can have its own tone, plus browser notifications, plus
> true push for severe space weather with the browser closed. Watch lists use
> a compact grammar: twenty meters and a new DXCC, forty CW and
> a prefix. And the wall: the Pi script boots into a fullscreen kiosk, scene
> rotation cycles layouts on a timer, a display schedule sleeps the screen at
> night, a wake lock keeps a tablet on. It's an offline-capable web app, so it
> installs like an app and survives an internet blip.

## Slide 18 — LIVE DEMO (5:00)

_[Press `L` or switch to the pre-warmed openhamclock.com tab. Five things,
one minute each. Do not change settings you'll forget to undo.]_

1. **Map.** "Here's the terminator, the gray line, and these arcs are the
   last few minutes of spots." Click a spot on another continent: path,
   distance, bearing. Click the call: who he is, what time it is there.
2. **Filters.** Open the cluster filter. Click a band, then the DXpeditions
   or IOTA toggle. "Watch the list and the map collapse together."
3. **Propagation.** Open the Propagation panel. Flip SSB to FT8. "Same path,
   same hour; watch the bands reopen at FT8's real threshold."
4. **Layouts.** Switch to Classic, then Dockable. Press plus: "there's every
   panel."
5. **Ctrl-K.** Type "aurora", enter. "Anything by typing."

_[Switch back to the deck.]_ "Let me come back to the slides so you leave
with the URLs and what's coming."

## Slide 19 — Install (1:30)

> Four ways, in order of patience. Zero install: openhamclock.com, and you can
> install it as an app from the browser menu. The Raspberry Pi kiosk: one
> command and it reboots into a wall display; a seventy-dollar Pi 400 runs it
> comfortably. Docker on a
> home server. Or clone and run on a Mac, Linux or Windows box; there's an
> Electron desktop build and a one-line Windows installer. If you self-host,
> every upstream call goes through your own backend.

## Slide 20 — Coming soon: intro (1:00)

> Now the coming-soon section, and it's a big one. This month's work had
> one theme: everything a shack display should be able to do, from planning
> tools to hardware hooks to remote control, and then a set of things nobody's
> dashboard does yet. Twenty-two new panels, seven new map
> layers, seven Rig Bridge plugins, a remote-control API with more than thirty
> commands. All merged, tested, in the manual; it ships in the next monthly
> release. If you can't wait, the Staging branch runs it today.

_If the release has shipped by Monday, say "this shipped last week" and
carry on; the slides don't change._

## Slide 21 — Time shift & planners (1:30)

> The most-requested feature, by a mile, was moving time. It's here: drag
> the whole dashboard up to thirty days either way and the terminator, gray
> line, sun and moon, satellites and the propagation hour all follow, with a
> red badge in the header until you come back to now. On top of it, three
> planners: Grayline, EME, and Satellite, each finding the mutual windows
> between you and the far end. Click a window and the map jumps to that
> moment. A proper alarm clock, and every contest has an alarm button. And the
> map gained political boundaries, a nearest-city readout, launch pads, and
> amateur balloons.

## Slide 22 — Things nobody has (2:00)

> Opportunities ranks every spot from the last fifteen minutes by what it does
> for your awards, how many people are spotting it, and the P.533 reliability
> from your station to that one, this hour. The answer to "what should I chase
> right now." The 27-Day Outlook puts NOAA's forecast on the contest calendar.
> Station Benchmark compares how your signal is heard on the Reverse Beacon
> Network against everyone within three hundred kilometers, per band, over a
> week: an honest answer to "is my antenna any good." The beacon monitor is a
> Rig Bridge plugin that follows the NCDXF beacon schedule on a public KiwiSDR
> and logs real signal-to-noise for all eighteen beacons. Spoken alerts read
> the watch-list hit out loud in phonetics. And everything publishes to MQTT
> with Home Assistant discovery, so Kp can be a sensor next to your thermostat.

## Slide 23 — Remote, kiosk, Pi hardware (1:30)

> A remote-control API: everything you can do on the display, over HTTP. Scan the QR code in Settings with your phone and you get a touch
> remote for all of it plus rig tuning; or drive it from a Stream Deck or
> Node-RED. For public displays: demo mode, grayscale, rotating titles, and a
> PIN lock so visitors can't rearrange your hamfest booth. And four new Rig
> Bridge plugins close the Pi hardware gap: GPS, a BME280 sensor, GPIO lines on
> the Pi header so a PTT line lights ON AIR and LEDs follow your
> alarm and satellite passes, and a light sensor for brightness. With the GPS
> following, Rover mode shows your live grid, the distance to the next grid
> line, and VUCC status. Honest caveat: the hardware plugins are new and
> mock-tested; if you have a Pi with sensors, we'd love a field report.

## Slide 24 — Weather & sky (1:00)

> A quick wall of the new weather and sky panes: tropical cyclones with the official NHC cones,
> radiofax charts with the frequencies one click from your rig, NDBC buoys,
> Red Flag fire-weather warnings and NHC hurricane cones that matter on this
> coast, every eclipse through 2040 with what you'll
> see from your QTH, the planets, NOAA's R-S-G scales, space launches. And
> below the pictures: Dst, electron flux, Windy, balloons, HamAlert, live nets
> from NetLogger, IOTA badges, magnetic bearings from the real World Magnetic
> Model, and a message-of-the-day banner for club servers.

## Slide 25 — Cluster & satellites (1:00)

> For the operators: a full watch-list grammar, login commands to
> your own node, a console panel, and a list that stops jumping while you
> read. On satellites: rotator auto-track with pre-positioning and flip mode,
> Doppler tuning on the corrected downlink, a polar sky view, hams.at alerts,
> and stale element sets flagged with a refresh button. That's the next
> release.

## Slide 26 — Get involved (1:00)

> If you take one thing from tonight: try it. The manual is on GitHub and
> under Settings, Help. If something's wrong or missing, file an issue; most of
> what shipped this year started as someone's issue, and releases are monthly.
> The Facebook group is the busiest channel. If you write code, map layers and
> panels are small plugin files, and pull requests go against Staging. And for
> this club: I'd happily set up a shared club profile code, help put a Pi on
> the clubhouse wall, or run a build day. Grab me after, or drop a note in the
> Zoom chat and I'll follow up.

_[Paste openhamclock.com and github.com/accius/openhamclock into the Zoom chat
now.]_

## Slide 27 — Thanks + Q&A

> Thanks again to Penn Wireless for having me tonight. This project exists because dozens of
> people sent pull requests to a brand-new repo and because users keep telling
> us what's wrong. I'm Chris, K0CJH, contact's on the screen. What questions do
> you have?

_[Watch the Zoom chat as well as hands in the room.]_

---

## Prepared Q&A

**"How is this different from the HamClock I already run?"**
Same idea, different foundation. HamClock is a C++ program drawing on a fixed
800×480 canvas; this is a web app that fits any screen, speaks sixteen
languages, and adds a logbook, rig control, EmComm, plugins and the new
intelligence features. If your Pi HamClock makes you happy, keep it; if
you want the extras, the Pi kiosk script runs this on the same hardware.

**"Will it run on my Pi 3?"**
Yes, with the flat map. The 3D globe wants a Pi 4 or 5. A Pi 400 at about
seventy dollars is the no-compromise pick for a wall display.

**"Is it free? Who pays for the hosted site?"**
MIT licensed, free, no ads, no accounts. The hosted site is run by the
project; self-hosting costs you nothing beyond the hardware.

**"What about my privacy?"**
No accounts, no tracking cookies, settings live in your browser. The Active
Users map layer is opt-out in Settings. Self-host and nothing leaves your LAN
except the upstream data fetches your own server makes.

**"Does it work offline / in the field?"**
It installs as a progressive web app and keeps its shell and your settings
offline; live feeds obviously need a connection. The propagation engine runs
locally, so predictions work on a flaky link.

**"Can I use my existing logger?"**
Yes. N1MM, DXLog and N3FJP QSOs appear on the map live; Wavelog and Cloudlog
sync both ways; QRZ Logbook push; LoTW confirmation pull; ADIF in and out of
the native logbook.

**"Why do your FT8 predictions disagree with VOACAP online?"**
We run the same ITU-R P.533 model but at each mode's real decode threshold.
FT8 decodes at −19 dB; most sites run SSB thresholds and bolt a bonus on
afterwards, which can't reopen a band the engine already scored at zero.

**"What radios does Rig Bridge support?"**
Yaesu, Kenwood, Elecraft and Icom over USB CAT directly; anything hamlib
supports via rigctld; flrig; TCI (SunSDR, Thetis); FlexRadio SmartSDR;
RTL-SDR receive. Rotators via rotctld or PstRotator.

**"Where do the DX spots come from?"**
Our own OHC Cluster node for the hosted site, built from RBN skimmers plus
human spots from several networks, mode-balanced. Self-hosters can point at
any telnet node, and the next release lets you send your own login commands.

**"Is the coming-soon stuff real?"**
Merged on the Staging branch, 2,400 automated tests, manual written. The
hardware plugins and the KiwiSDR protocol have not touched real hardware yet,
which is exactly why I'm asking for field reports.

**"Can the club have one on the clubhouse wall?"**
Yes: a Pi, the kiosk script, a shared profile code, a PIN lock. Happy to
help set it up.
