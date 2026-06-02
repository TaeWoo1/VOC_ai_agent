"""Make the (flat-import) outreach bot modules importable from these tests.

The bot under ops/discord_outreach_bot/ uses flat imports (e.g. `import
status_reader`) and is not part of the `src.*` package, so we prepend its
directory to sys.path. This is import-path setup only — it reads nothing and
writes nothing.
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BOT_DIR = REPO_ROOT / "ops" / "discord_outreach_bot"
if str(BOT_DIR) not in sys.path:
    sys.path.insert(0, str(BOT_DIR))
