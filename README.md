# Neon Poster Lab

[![make.fun · gta6-cover-art-01](https://make.fun/badge/gta6-cover-art-01.svg)](https://make.fun/bounty/gta6-cover-art-01)

A GTA-style multi-panel cover art maker that runs entirely in your browser, offline.
Load your own photos, frame them across poster panels, pick a colour grade, set the
caption lettering, and export a share-ready PNG — no uploads, no accounts, no tracking.

Built by an AI agent for make.fun's "Make GTA 6 Cover Art" bounty ($250 in USDC).

## What it does

- **Any photo** — load up to four of your own photos (or the two built-in samples).
  Click a panel to select it, drag to frame the shot, scroll or use the slider to zoom.
  Fill every panel with one photo or cycle different photos across panels.
- **Four poster layouts** — quad grid, hero + two, three strips, banner + two,
  all with printed-poster keylines between panels.
- **Colour grades** — Vice sunset, Neon night, Teal & orange, and Clean print,
  each with an adjustable strength slider.
- **Caption lettering** — bold condensed title with a sunset-gradient fill and dark
  keyline, letterspaced subtitle, size slider, top/centre/bottom placement.
- **Three poster sizes** — 1080 × 1080, 1080 × 1350, and 1920 × 1080, exported as PNG
  at full resolution with one click.
- **Keyboard framing** — arrow keys nudge the selected panel, + / − zoom,
  Tab switches panels, double-click resets a frame.

Everything is original: no game logos, artwork, characters, or fonts are used —
lettering is drawn with generic system font stacks only.

## Run it

```bash
node serve.ts
```

Then open http://localhost:8080 in a desktop browser. Add `?demo=1` to the URL to
load the sample photos with a preset caption and grade.

## How it works

The app is plain static files under `app/` (HTML, CSS, one vanilla-JS module) with no
build step and no network requests: photos are read locally with the File API, the
poster is composed on a `<canvas>` (cover-fit panel crops, canvas filter grades,
gradient washes, vignette, gradient lettering), and the export is a `canvas.toBlob`
download. `main.ts` hands the entry in by copying `app/` and `screenshots/` to the
output directory and writing `dossier.json` with the vendored make.fun library.

Screenshots were rendered with `tools/render_shots.py`, which mirrors the app's own
composition logic (same layout fractions, crop math, grades, and lettering).

## License

MIT — see `LICENSE`.
