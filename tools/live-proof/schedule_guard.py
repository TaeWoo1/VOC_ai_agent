#!/usr/bin/env python3
"""Schedule-guard helpers. Kept out of the shell script because the reporting needs real string
formatting, and f-strings inside a shell heredoc are a quoting trap rather than a readability win."""
import json
import sys


def report(rows):
    for r in rows:
        dt = r.get("dataType")
        print("  %-14s enabled=%-5s every=%sm next=%s"
              % (dt, r.get("enabled"), r.get("intervalMinutes"), r.get("nextRunAt")))
    enabled = [r for r in rows if r.get("enabled")]
    print("\nENABLED SCHEDULES: %d" % len(enabled))
    # The exit code is the gate. A preflight that ignores a non-zero here is choosing to.
    return 1 if enabled else 0


def main():
    mode = sys.argv[1]
    if mode == "report":
        return report(json.load(sys.stdin))
    if mode == "record":
        rows = [r for r in json.load(sys.stdin) if r.get("enabled")]
        with open(sys.argv[2], "w") as f:
            json.dump(rows, f)
        print("recorded %d enabled schedule(s)" % len(rows))
        return 0
    if mode == "list":
        with open(sys.argv[2]) as f:
            for r in json.load(f):
                print("%s %s" % (r["dataType"], r.get("intervalMinutes") or 60))
        return 0
    raise SystemExit("unknown mode: %s" % mode)


if __name__ == "__main__":
    sys.exit(main())
