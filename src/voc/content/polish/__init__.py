"""Phase D1+: editorial polish layer.

Per-channel modules:
  - `instagram_ko` — Phase D1 (this slice)
  - `threads_ko`  — Phase F1 (later)
  - `x_ko`        — Phase F2 (later)

`common.py` carries the shared retry loop, cache integration, and
PolishResult dataclass. Channel modules build channel-specific
prompts and call into common.run_polish_loop().
"""
from __future__ import annotations
