"""CLI script to run the evaluation suite.

HYBRID: CLI skeleton scaffolded. Eval configuration and
invocation details are SELF.
"""

from __future__ import annotations

import argparse
import sys


def main():
    parser = argparse.ArgumentParser(description="Run VOC evaluation suite")
    parser.add_argument(
        "--queries",
        default="eval_data/queries/eval_queries_v1.json",
        help="Path to eval queries JSON",
    )
    parser.add_argument(
        "--gold",
        default="eval_data/gold/gold_references_v1.json",
        help="Path to gold references JSON",
    )
    parser.add_argument(
        "--output-dir",
        default="eval_data/results",
        help="Directory for eval output",
    )
    # TODO: Add --strategy flag for experiment comparison
    # TODO: Add --prompt-variant flag for generation experiments

    args = parser.parse_args()

    # TODO: Wire up eval runner
    print(f"Eval queries: {args.queries}")
    print(f"Gold references: {args.gold}")
    print(f"Output dir: {args.output_dir}")
    print("TODO: Implement eval runner invocation")
    sys.exit(1)


if __name__ == "__main__":
    main()
