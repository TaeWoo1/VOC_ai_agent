"""Source connection validation — checks whether a source is ready to use.

Each connector type has a validator that inspects config and local state
(file existence, required fields) without making network calls. The goal
is to give the operator clear feedback on what's configured, what's missing,
and what to do next.

Readiness levels:
    ready             — all checks pass, can refresh now
    manual_ready      — checks pass, but source is operator-assisted (upload/capture)
    config_incomplete — missing required config fields
    auth_missing      — connector needs credentials that aren't provided
    file_missing      — config references a file that doesn't exist
    not_implemented   — connector is a stub/spike, live validation not meaningful
"""

from __future__ import annotations

import csv
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class Check:
    """A single validation check result."""
    name: str
    passed: bool
    detail: str = ""


@dataclass
class ValidationResult:
    """Aggregated validation output for a source connection."""
    connection_id: str
    connector_type: str
    status: str  # current source_connection status
    readiness: str
    checks: list[Check] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    next_steps: list[str] = field(default_factory=list)
    sync_mode: str = "unknown"
    requires_upload: bool = False


def validate_source(source: dict) -> ValidationResult:
    """Dispatch validation to the appropriate connector-type validator."""
    connector_type = source.get("connector_type", "")
    validators = {
        "csv": _validate_csv,
        "json_import": _validate_json_import,
        "google_business": _validate_google_business,
        "mock": _validate_mock,
    }
    validator = validators.get(connector_type, _validate_unknown)
    return validator(source)


# ---------------------------------------------------------------------------
# Per-connector validators
# ---------------------------------------------------------------------------


def _validate_csv(source: dict) -> ValidationResult:
    """Validate a CSV source connection."""
    config = source.get("config", {})
    result = ValidationResult(
        connection_id=source["connection_id"],
        connector_type="csv",
        status=source.get("status", "active"),
        readiness="manual_ready",
        sync_mode="manual",
        requires_upload=True,
    )

    # Check 1: file_path configured
    file_path = config.get("file_path")
    if not file_path:
        result.checks.append(Check("file_path_configured", False))
        result.readiness = "config_incomplete"
        result.next_steps.append(
            "Upload a CSV file via POST /v1/entities/{entity_id}/upload"
        )
        return result
    result.checks.append(Check("file_path_configured", True, file_path))

    # Check 2: file exists on disk
    path = Path(file_path)
    if not path.is_file():
        result.checks.append(Check("file_exists", False, f"{file_path} not found"))
        result.readiness = "file_missing"
        result.next_steps.append("Re-upload the CSV file — the previously uploaded file is missing")
        return result
    result.checks.append(Check("file_exists", True))

    # Check 3: file is parseable with a 'text' column
    parse_result = _check_csv_parseable(path)
    result.checks.append(parse_result)
    if not parse_result.passed:
        result.readiness = "config_incomplete"
        result.next_steps.append("Upload a CSV file with a 'text' column")
        return result

    result.warnings.append("Source is manual-only — upload a new file before each refresh to update data")
    return result


def _validate_json_import(source: dict) -> ValidationResult:
    """Validate a JSON import source connection."""
    config = source.get("config", {})
    result = ValidationResult(
        connection_id=source["connection_id"],
        connector_type="json_import",
        status=source.get("status", "active"),
        readiness="manual_ready",
        sync_mode="manual",
        requires_upload=True,
    )

    # Check 1: file_path configured
    file_path = config.get("file_path")
    if not file_path:
        result.checks.append(Check("file_path_configured", False))
        result.readiness = "config_incomplete"
        result.next_steps.append(
            "Upload a JSON file via POST /v1/entities/{entity_id}/upload/json"
        )
        return result
    result.checks.append(Check("file_path_configured", True, file_path))

    # Check 2: file exists on disk
    path = Path(file_path)
    if not path.is_file():
        result.checks.append(Check("file_exists", False, f"{file_path} not found"))
        result.readiness = "file_missing"
        result.next_steps.append("Re-upload the JSON file — the previously uploaded file is missing")
        return result
    result.checks.append(Check("file_exists", True))

    # Check 3: file is valid JSON with review entries
    parse_result = _check_json_parseable(path)
    result.checks.append(parse_result)
    if not parse_result.passed:
        result.readiness = "config_incomplete"
        result.next_steps.append(
            "Upload a JSON file containing an array of objects with a 'text' field"
        )
        return result

    result.warnings.append("Source is manual-only — upload a new file before each refresh to update data")
    return result


def _validate_google_business(source: dict) -> ValidationResult:
    """Validate a Google Business Profile source connection.

    This connector is a spike — live API validation is intentionally omitted.
    We only check that the required config keys are present.
    """
    config = source.get("config", {})
    result = ValidationResult(
        connection_id=source["connection_id"],
        connector_type="google_business",
        status=source.get("status", "active"),
        readiness="not_implemented",
        sync_mode="api",
        requires_upload=False,
    )

    required_keys = ["account_id", "location_id", "access_token"]
    all_present = True
    missing = []

    for key in required_keys:
        present = bool(config.get(key))
        result.checks.append(Check(f"{key}_present", present))
        if not present:
            all_present = False
            missing.append(key)

    if not all_present:
        result.readiness = "auth_missing" if "access_token" in missing else "config_incomplete"
        result.next_steps.append(
            f"Provide missing config fields: {', '.join(missing)}"
        )
    else:
        # All keys present — structurally configured but we can't verify live
        result.readiness = "not_implemented"
        result.checks.append(Check(
            "live_connectivity",
            False,
            "Live API validation not implemented — GBP connector is a spike",
        ))

    result.warnings.append(
        "Google Business Profile connector is a spike/scaffold, not production-ready"
    )
    result.warnings.append(
        "access_token expires after ~1 hour — operator must manually refresh"
    )
    result.next_steps.append(
        "GBP integration requires OAuth 2.0 setup, location verification, "
        "and token refresh — see connector module docstring for details"
    )
    return result


def _validate_mock(source: dict) -> ValidationResult:
    """Validate a mock source connection — always ready (development only)."""
    return ValidationResult(
        connection_id=source["connection_id"],
        connector_type="mock",
        status=source.get("status", "active"),
        readiness="ready",
        checks=[Check("mock_connector", True, "Development/testing connector — always available")],
        warnings=["Mock connector uses fixture data — not a real data source"],
        sync_mode="auto",
        requires_upload=False,
    )


def _validate_unknown(source: dict) -> ValidationResult:
    """Fallback for unrecognized connector types."""
    connector_type = source.get("connector_type", "unknown")
    return ValidationResult(
        connection_id=source["connection_id"],
        connector_type=connector_type,
        status=source.get("status", "active"),
        readiness="not_implemented",
        checks=[Check("connector_recognized", False, f"Unknown connector type: {connector_type}")],
        warnings=[f"No validator registered for connector type '{connector_type}'"],
        next_steps=["Check that the connector_type is correct"],
        sync_mode="unknown",
    )


# ---------------------------------------------------------------------------
# File parsing helpers
# ---------------------------------------------------------------------------


def _check_csv_parseable(path: Path) -> Check:
    """Check that a CSV file has a 'text' column and count rows."""
    try:
        with open(path, encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            fieldnames = reader.fieldnames or []
            if "text" not in fieldnames:
                return Check("file_parseable", False, "CSV missing required 'text' column")
            row_count = sum(1 for row in reader if row.get("text", "").strip())
        return Check("file_parseable", True, f"{row_count} reviews with text found")
    except Exception as e:
        return Check("file_parseable", False, f"Parse error: {e}")


def _check_json_parseable(path: Path) -> Check:
    """Check that a JSON file is a valid array with 'text' entries."""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, list):
            return Check("file_parseable", False, "JSON is not an array")
        review_count = sum(
            1 for entry in data
            if isinstance(entry, dict) and str(entry.get("text", "")).strip()
        )
        if review_count == 0:
            return Check("file_parseable", False, "No entries with non-empty 'text' field")
        return Check("file_parseable", True, f"{review_count} reviews with text found")
    except json.JSONDecodeError as e:
        return Check("file_parseable", False, f"Invalid JSON: {e}")
    except Exception as e:
        return Check("file_parseable", False, f"Parse error: {e}")
