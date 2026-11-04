# Presentations

Reveal.js slide decks about OpenHamClock. Use them, fork them, take them to
your club.

Each deck is a folder with a self-contained `index.html` (no build step, all
assets via CDN), a README explaining how to run and customize it, and
printable speaker notes. The October 2026 decks share their screenshots in
`shared-2026-10/` — copy that folder along with the deck.

## Decks

| Folder                                             | Audience                 | Length        | Style                          |
| -------------------------------------------------- | ------------------------ | ------------- | ------------------------------ |
| [`dvra-w2zq-2026-05-13/`](./dvra-w2zq-2026-05-13/) | Ham radio club (general) | ~25 min + Q&A | Tour + live demo               |
| [`sfdxa-2026-07-08/`](./sfdxa-2026-07-08/)         | DX club (via Zoom)       | ~26 min + Q&A | DX-focused tour + live demo    |
| [`ncarc-2026-10-17/`](./ncarc-2026-10-17/)         | Ham radio club (general) | ~40 min + Q&A | Full tour + demo + coming soon |
| [`pwa-2026-10-19/`](./pwa-2026-10-19/)             | Ham radio club (hybrid)  | ~40 min + Q&A | Full tour + demo + coming soon |

## Using a deck

```bash
cd presentations/<deck>
open index.html   # or just drag onto a browser
```

Then press `F` for fullscreen and `S` for the speaker view. Each deck's
README has the rest of the keybindings and a suggested talk timing.

## Contributing a new deck

If you give a talk and want to share your deck:

1. Copy an existing deck folder as your starting point.
2. Rename it `<event-or-club>-YYYY-MM-DD/`.
3. Edit `index.html` — find-and-replace name, callsign, club, date.
4. Update the deck README with audience notes and a slide-by-slide timing.
5. Add a row to the table above and open a PR against `Staging`.

Decks here are MIT licensed (same as the project). Attribution appreciated
but not required.
