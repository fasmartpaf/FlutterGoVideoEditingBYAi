# Attribution — timecode-agent (MIT)

This directory contains **clean-room TypeScript adaptations** of architectural
ideas from:

- **Repository:** https://github.com/mupozg823/timecode-agent
- **License:** MIT License (Copyright (c) 2026 mupozg823)
- **Inspected commit:** `02f7c5a9ce1c09b4ba49177d2a4dc8e9ee1bbc03` (release v0.4.0, 2026-08-06)

## Upstream modules inspected (ideas only — not pasted)

| Upstream | Classification | OpenScreen use |
|----------|----------------|----------------|
| `checkpoint_schema.py` statuses `hypothesized`→`verified`/`corrected` | ADAPT_IDEA_ONLY | Claim promotion lifecycle + history |
| `verification.py` / `verification_types.py` promotability + modality levels | ADAPT_IDEA_ONLY | Deterministic promotion rules + verification levels |
| `capture.py` capture `reason` / cause identity | ADAPT_IDEA_ONLY | Capture provenance refs on claims |
| `transcript_evidence.py` segment support | ADAPT_IDEA_ONLY | Cross-modal support checks |
| `checkpoint_store.py` append-only workspace JSONL | ARCHITECTURE_REFERENCE | Turn-local claim set (not their FS layout) |
| EDL/OTIO export receipts | NOT_NEEDED | OpenScreen owns editing |

OpenScreen Temporal Event Ledger is **not** replaced. This layer sits above it.

---

MIT License

Copyright (c) 2026 mupozg823

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
