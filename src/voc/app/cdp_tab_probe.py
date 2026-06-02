"""Tiny read-only CDP tab probe for the Brand-20 queue runner.

The Brand-20 runner needs to confirm two things before authorising a
live collection attempt:

  1. The CDP debug endpoint at `127.0.0.1:9222` is reachable
     (`GET /json/version`).
  2. A tab targeting the operator's chosen `goodsNo` is already open in
     the attached Chrome window (`GET /json/list`).

Everything else (login state, Cloudflare interstitials, captcha) is
left to the connector's existing classifier. This module deliberately
restricts itself to read-only HTTP GETs against the CDP devtools port;
the one mutating endpoint exposed (`open_tab` -> `PUT /json/new`) is
NEVER called from the phase-A CLI golden path. Phase B will wire it,
behind both `--allow-open-tab` AND `--i-authorize-live-collection`.

Design boundaries
-----------------
- Standard library only: `urllib.request` + `json`. No new dependency.
- Pure I/O wrapper. No queue / batch_summary knowledge.
- Every test in this ticket patches this module so no test reaches
  `127.0.0.1:9222`.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


# CDP devtools default port. Mirrors `oy_chrome_debug.DEFAULT_CDP_PORT`
# but kept locally so this module has no connector dependency.
DEFAULT_CDP_HOST: str = "127.0.0.1"
DEFAULT_CDP_PORT: int = 9222
_DEFAULT_TIMEOUT_SEC: float = 2.0


class CdpUnreachableError(RuntimeError):
    """Raised when the CDP endpoint cannot be reached or returns a
    non-2xx response. The runner translates this into
    `failed_check=cdp_unreachable` for the operator-facing report.
    """


def _http_get_json(
    url: str,
    *,
    timeout: float = _DEFAULT_TIMEOUT_SEC,
) -> Any:
    """GET `url` and parse the response as JSON.

    Raises `CdpUnreachableError` on connection error, timeout, non-2xx
    status, or unparseable JSON. The runner relies on this single
    error class so each precondition failure maps cleanly to one
    operator-facing classification.
    """
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:  # nosec B310
            status = getattr(resp, "status", 200)
            if not (200 <= int(status) < 300):
                raise CdpUnreachableError(
                    f"CDP returned status {status} for {url}"
                )
            body = resp.read().decode("utf-8")
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        raise CdpUnreachableError(
            f"CDP unreachable at {url}: {exc}"
        ) from exc
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise CdpUnreachableError(
            f"CDP returned non-JSON body at {url}: {exc}"
        ) from exc


def _http_put_json(
    url: str,
    *,
    timeout: float = _DEFAULT_TIMEOUT_SEC,
) -> Any:
    """PUT `url` (no body) and parse the response as JSON.

    Mirrors `_http_get_json` for the `/json/new` endpoint, which
    Chrome's devtools protocol accepts as either a GET or a PUT.
    Phase A never calls this in the golden path; phase B does. Kept
    here so phase B does not need to grow this module's surface.
    """
    req = urllib.request.Request(url, method="PUT")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # nosec B310
            status = getattr(resp, "status", 200)
            if not (200 <= int(status) < 300):
                raise CdpUnreachableError(
                    f"CDP returned status {status} for {url}"
                )
            body = resp.read().decode("utf-8")
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        raise CdpUnreachableError(
            f"CDP unreachable at {url}: {exc}"
        ) from exc
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise CdpUnreachableError(
            f"CDP returned non-JSON body at {url}: {exc}"
        ) from exc


def get_version(
    host: str = DEFAULT_CDP_HOST,
    port: int = DEFAULT_CDP_PORT,
) -> dict:
    """Return the parsed `/json/version` payload.

    Raises `CdpUnreachableError` if the endpoint is unreachable or
    returns anything other than a JSON object.
    """
    url = f"http://{host}:{int(port)}/json/version"
    payload = _http_get_json(url)
    if not isinstance(payload, dict):
        raise CdpUnreachableError(
            f"CDP /json/version returned non-object payload at {url}"
        )
    return payload


def list_tabs(
    host: str = DEFAULT_CDP_HOST,
    port: int = DEFAULT_CDP_PORT,
) -> list[dict]:
    """Return the parsed `/json/list` payload.

    Each tab entry is a dict with at minimum a `url` and `title` key.
    Raises `CdpUnreachableError` on any transport / parse failure.
    Always returns a list (possibly empty) when successful.
    """
    url = f"http://{host}:{int(port)}/json/list"
    payload = _http_get_json(url)
    if not isinstance(payload, list):
        raise CdpUnreachableError(
            f"CDP /json/list returned non-array payload at {url}"
        )
    # Defensive: drop entries that aren't dicts so callers can safely
    # do `entry.get("url")`. Chrome should never produce these but
    # custom CDP shims sometimes do.
    return [entry for entry in payload if isinstance(entry, dict)]


def open_tab(
    target_url: str,
    host: str = DEFAULT_CDP_HOST,
    port: int = DEFAULT_CDP_PORT,
) -> dict:
    """Open a new tab targeting `target_url` and return the descriptor.

    Phase A never calls this from the CLI's golden path because the
    `--i-authorize-live-collection` branch short-circuits. Phase B is
    expected to wire it behind both `--allow-open-tab` AND
    `--i-authorize-live-collection`.

    Raises `CdpUnreachableError` on any transport / parse failure.
    """
    encoded = urllib.parse.quote(target_url, safe="")
    url = f"http://{host}:{int(port)}/json/new?{encoded}"
    payload = _http_put_json(url)
    if not isinstance(payload, dict):
        raise CdpUnreachableError(
            f"CDP /json/new returned non-object payload at {url}"
        )
    return payload
