# Speaker Notes: OpenHamClock Guided Tour (Penn Wireless, October 19, 2026)

About 35 minutes, then questions. The full spoken script for every slide is in
the speaker view (press `S`). This file has the prep, the demo and the Q&A.

**Before the talk:** open openhamclock.com in a second tab of the same window
and let it run a few minutes so spots fill in. On Zoom, share the browser
window, not the screen. Press `L` on slide 23 to jump to the live site.

**About the screenshots:** captured from the live site on the morning of the
talk, as W3SK in FN20 with the DX target on Tokyo (the default). Say once on
slide 2 that tonight's live numbers will differ. Read tonight's real numbers
aloud during the demo.

**Rig control:** one mention only (slide 22). If asked, offer to help after the
meeting.

## Live demo (slide 23, ~5 minutes)

1. Header: read tonight's SFI and K aloud. Good night or not?
2. Solar pane: flip to X-ray (any flares?), then indices (K forecast bars).
3. Click a spot in the cluster: the DX target, beam heading and map path change.
4. Propagation: read the chart for that path. Switch SSB → FT8 and watch it
   change. Flip to the bands view.
5. Band bar: click 20 m to filter the map. Click ALL to restore it.
6. Map: Azimuthal; point out the beam heading. Back to Flat.
7. Ctrl+K, type "classic"; then Ctrl+K, "modern".

## Likely questions

**"The band report says GOOD but the prediction says 0%. Which is right?"**
Both. N0NBH's report is general (the band is open somewhere); the chart is your
specific path at your mode and power. Slide 15.

**"Why does FT8 show bands open that SSB doesn't?"** The model is run at each
mode's real decode threshold. FT8 decodes far below the noise.

**"Where does the data come from?"** NOAA SWPC (SFI, K, SSN, X-ray), N0NBH /
HamQSL (A, solar wind, geomag word, band conditions), NASA SDO (sun images),
the DX cluster and RBN (spots), PSKReporter, POTA/SOTA/WWFF/WWBOTA APIs, NG3K
(DXpeditions), WA7BNM (contests), Open-Meteo (weather).

**"Is VR QUIET green?"** Only the exact word QUIET is green; ACTIVE and STORM
are red; everything else (VR QUIET, INACTIVE, UNSETTLD) is amber.

**"How do I get the NEW/BAND tags?"** Import your ADIF into the Logbook pane, or
sync from a logging service under Integrations.

**"Does it cost anything / need an account?"** Free, open source, no account.
Settings stay in your browser.

**"Will it run on a Pi on the shack wall?"** Yes. The Pi setup script boots
into a full-screen display. Offer to help.

**"Is this the same as HamClock?"** Same idea, separate program, built for the
web. If your HamClock Pi makes you happy, keep it.
