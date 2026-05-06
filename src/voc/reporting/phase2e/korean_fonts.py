"""Korean font discovery + ReportLab registration.

The seller business report PDF needs a Korean typeface that:
  1. Renders modern, business-quality Hangul (no tofu / □ glyphs).
  2. Has a Bold variant so `<b>...</b>` HTML in ParagraphStyle text
     renders as actual bold (not faux-bold).

The function searches the local system in priority order:
  1. Noto Sans KR  (most modern look, common via package managers)
  2. Noto Sans CJK KR (TTC; fallback for Linux distros)
  3. Apple SD Gothic Neo (built-in on macOS)
  4. Nanum Gothic (TTF; common on Korean systems)
  5. ReportLab CID fallback (HYSMyeongJo-Medium)

Hard rules
----------
- Never copy or commit font files into the repo.
- Never crash if no Korean font is available — fall back to the CID
  font (HYSMyeongJo-Medium) which ships with reportlab.
- Idempotent: re-calling the discovery on a process that already
  registered fonts is a no-op (registerFont is itself idempotent).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Iterable

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont, TTFError


# Last-resort CID font that ships with reportlab. Always available.
FALLBACK_FONT_NAME: str = "HYSMyeongJo-Medium"


# Search paths in priority order. Apple's lazy-loaded font assets
# (newer macOS) live under /System/Library/AssetsV2 — the directory
# layout uses UUID subdirs so we only search the immediate level.
_FONT_DIRS_MAC: tuple[str, ...] = (
    str(Path.home() / "Library" / "Fonts"),
    "/Library/Fonts",
    "/System/Library/Fonts",
    "/System/Library/Fonts/Supplemental",
)
_FONT_DIRS_LINUX: tuple[str, ...] = (
    "/usr/share/fonts",
    "/usr/share/fonts/truetype",
    "/usr/share/fonts/opentype",
    "/usr/share/fonts/noto",
    "/usr/share/fonts/noto-cjk",
    "/usr/share/fonts/opentype/noto",
    "/usr/local/share/fonts",
    str(Path.home() / ".local/share/fonts"),
)


def _font_dirs() -> Iterable[str]:
    if sys.platform == "darwin":
        return _FONT_DIRS_MAC
    return _FONT_DIRS_MAC + _FONT_DIRS_LINUX


def _find_font_file(filenames: Iterable[str]) -> str | None:
    """Search the standard font directories for the first match.
    Walk one level deep into each dir (Apple's AssetsV2 / Noto sub-
    folders) so we don't miss vendor-specific layouts."""
    seen: set[str] = set()
    for d in _font_dirs():
        if not d or d in seen or not os.path.isdir(d):
            continue
        seen.add(d)
        # Direct match in the dir itself.
        for fn in filenames:
            full = os.path.join(d, fn)
            if os.path.isfile(full):
                return full
        # Walk one level into subdirs.
        try:
            for sub in os.listdir(d):
                subdir = os.path.join(d, sub)
                if not os.path.isdir(subdir):
                    continue
                for fn in filenames:
                    full = os.path.join(subdir, fn)
                    if os.path.isfile(full):
                        return full
        except OSError:
            continue
    return None


# Each candidate carries the filenames to look for plus the TTC sub-
# font index when applicable. Order matters — first match wins.
_FONT_CANDIDATES: tuple[dict, ...] = (
    {
        "name": "NotoSansKR",
        "regular": (
            "NotoSansKR-Regular.otf", "NotoSansKR-Regular.ttf",
            "NotoSans-Regular.otf",
        ),
        "bold": (
            "NotoSansKR-Bold.otf", "NotoSansKR-Bold.ttf",
            "NotoSans-Bold.otf",
        ),
        "ttc_index_regular": None,
        "ttc_index_bold": None,
    },
    {
        "name": "NotoSansCJK-KR",
        "regular": (
            "NotoSansCJK-Regular.ttc", "NotoSansCJKkr-Regular.otf",
        ),
        "bold": (
            "NotoSansCJK-Bold.ttc", "NotoSansCJKkr-Bold.otf",
        ),
        # NotoSansCJK ttc layout: JP=0, KR=1, SC=2, TC=3.
        "ttc_index_regular": 1,
        "ttc_index_bold": 1,
    },
    {
        "name": "AppleSDGothicNeo",
        "regular": ("AppleSDGothicNeo.ttc",),
        "bold": ("AppleSDGothicNeo.ttc",),
        # Apple SD Gothic Neo TTC weight order (macOS Sonoma+):
        # 0:Thin 1:UltraLight 2:Light 3:Regular 4:Medium 5:SemiBold
        # 6:Bold 7:ExtraBold 8:Heavy. Best-effort — failures fall
        # through to Nanum.
        "ttc_index_regular": 3,
        "ttc_index_bold": 6,
    },
    {
        "name": "NanumGothic",
        "regular": ("NanumGothic.ttf", "NanumGothic.otf"),
        "bold": (
            "NanumGothicBold.ttf", "NanumGothic-Bold.ttf",
            "NanumGothicBold.otf",
        ),
        "ttc_index_regular": None,
        "ttc_index_bold": None,
    },
)


def _try_register(name: str, path: str, subfont_index: int | None) -> bool:
    """Best-effort font registration. Returns True on success."""
    try:
        kwargs = {}
        if subfont_index is not None:
            kwargs["subfontIndex"] = subfont_index
        pdfmetrics.registerFont(TTFont(name, path, **kwargs))
        return True
    except (TTFError, OSError, ValueError, KeyError, IndexError):
        return False
    except Exception:  # pragma: no cover — defensive
        return False


def discover_korean_font_family() -> dict:
    """Locate, register, and return the best available Korean font.

    Returns a dict:

      {
        "name":              str   # ReportLab regular font name
        "bold_name":         str | None  # ReportLab bold font name
        "family_registered": bool  # True if `pdfmetrics.registerFontFamily`
                                   # successfully linked regular + bold
                                   # so <b>...</b> HTML renders as bold.
        "source":            str   # candidate identifier ("NotoSansKR",
                                   # "AppleSDGothicNeo", "NanumGothic",
                                   # "fallback").
        "regular_path":      str | None  # source file path (None for fallback)
        "bold_path":         str | None
      }

    Idempotent: re-running on the same process is safe.
    """
    for cand in _FONT_CANDIDATES:
        reg_path = _find_font_file(cand["regular"])
        if not reg_path:
            continue
        reg_name = f"{cand['name']}-Regular"
        if not _try_register(
            reg_name, reg_path, cand.get("ttc_index_regular"),
        ):
            continue
        bold_path = _find_font_file(cand["bold"])
        bold_name: str | None = None
        family_registered = False
        if bold_path:
            bold_name_try = f"{cand['name']}-Bold"
            ok = _try_register(
                bold_name_try, bold_path, cand.get("ttc_index_bold"),
            )
            if ok:
                bold_name = bold_name_try
                try:
                    pdfmetrics.registerFontFamily(
                        cand["name"],
                        normal=reg_name,
                        bold=bold_name,
                        italic=reg_name,
                        boldItalic=bold_name,
                    )
                    family_registered = True
                except Exception:  # noqa: BLE001 — defensive
                    family_registered = False
        return {
            "name": reg_name,
            "bold_name": bold_name,
            "family_registered": family_registered,
            "source": cand["name"],
            "regular_path": reg_path,
            "bold_path": bold_path,
        }

    # Fallback: register the reportlab CID font that always ships.
    try:
        pdfmetrics.registerFont(UnicodeCIDFont(FALLBACK_FONT_NAME))
    except Exception:  # noqa: BLE001 — defensive
        pass
    return {
        "name": FALLBACK_FONT_NAME,
        "bold_name": None,
        "family_registered": False,
        "source": "fallback",
        "regular_path": None,
        "bold_path": None,
    }


__all__ = [
    "FALLBACK_FONT_NAME",
    "discover_korean_font_family",
]
