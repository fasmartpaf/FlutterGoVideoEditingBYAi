# Attribution — watch-video (MIT)

This directory contains **clean-room TypeScript reimplementations** of algorithmic
ideas from:

- **Repository:** https://github.com/WebDevBar/watch-video
- **License:** MIT License (Copyright (c) 2026 webdevbar)
- **Inspected commit:** `eb90ffae710df6def3c61aa1b3bf7a5743ed8f89` (release v1.1.3, 2026-08-31)
- **Inspected file:** `watch-video` (blob `18ea372978a9e80776376d1100abbe3dc83a43f5`)

## Upstream functions adapted (ideas only — not pasted)

| Upstream | OpenScreen module | Mode |
|----------|-------------------|------|
| `dhash`, `hamming` | `dhash.ts` | Clean-room rewrite |
| `dedupe` | `dedupe.ts` | Clean-room rewrite (+ protected frames) |
| `extract_frames` scene+periodic select | `boundedSampling.ts`, `sceneDetect.ts` | Adapted for **bounded ranges only** |
| `_prep_for_ocr` | `ocrPreprocess.ts` | Clean-room rewrite (ffmpeg + TS) |
| `ocr_frames` + Tesseract | `tesseractEngine.ts` | Optional subprocess adapter |

## OpenScreen-original (not from watch-video)

- `ocrCache.ts` and OpenScreen’s OCR **content-cache** behavior (keyed by media
  identity, mtime, source time, ROI, preprocess version, engine) are **original
  OpenScreen additions**. They are not adapted from watch-video. Upstream only
  uses `@lru_cache` on `fps_mode_args` (ffmpeg flag probe), not result caching.

## Not ported

CLI packaging, yt-dlp acquire, Whisper transcription, contact sheets, markdown
timeline UX, cleanup/manifest product surface, plugin wrappers.

The MIT copyright notice and permission text for the upstream project are
included below for compliance when substantial algorithmic derivation is claimed.

---

MIT License

Copyright (c) 2026 webdevbar

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
