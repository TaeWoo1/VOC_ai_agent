"""Read-only tests for the v0.1 outreach operator bot.

Path bootstrap mirrors conftest.py so the suite also runs under
`python -m unittest` (which does not load conftest.py).
"""

import sys
from pathlib import Path

_BOT_DIR = Path(__file__).resolve().parents[2] / "ops" / "discord_outreach_bot"
if str(_BOT_DIR) not in sys.path:
    sys.path.insert(0, str(_BOT_DIR))
