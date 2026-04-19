"""Tests for source connection validation logic."""

from __future__ import annotations

import csv
import json
import tempfile

from src.voc.app.source_validation import validate_source


def _make_source(connector_type: str, config: dict | None = None, **kwargs) -> dict:
    """Build a minimal source connection dict for testing."""
    source = {
        "connection_id": "test-conn-001",
        "entity_id": "test-entity",
        "connector_type": connector_type,
        "status": "active",
        "config": config or {},
        "capabilities": {},
    }
    source.update(kwargs)
    return source


# ---------------------------------------------------------------------------
# CSV validation
# ---------------------------------------------------------------------------


class TestCSVValidation:
    def test_no_file_path(self):
        result = validate_source(_make_source("csv"))
        assert result.readiness == "config_incomplete"
        assert not result.checks[0].passed  # file_path_configured
        assert any("Upload" in s for s in result.next_steps)

    def test_file_path_missing_on_disk(self):
        result = validate_source(_make_source("csv", {"file_path": "/nonexistent/test.csv"}))
        assert result.readiness == "file_missing"
        assert result.checks[0].passed  # file_path_configured
        assert not result.checks[1].passed  # file_exists

    def test_file_missing_text_column(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as f:
            writer = csv.writer(f)
            writer.writerow(["rating", "author"])
            writer.writerow(["5", "user1"])
            path = f.name
        result = validate_source(_make_source("csv", {"file_path": path}))
        assert result.readiness == "config_incomplete"
        assert result.checks[0].passed  # file_path_configured
        assert result.checks[1].passed  # file_exists
        assert not result.checks[2].passed  # file_parseable
        assert "text" in result.checks[2].detail.lower()

    def test_valid_csv(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as f:
            writer = csv.writer(f)
            writer.writerow(["text", "rating"])
            writer.writerow(["Great product", "5"])
            writer.writerow(["Not bad", "3"])
            path = f.name
        result = validate_source(_make_source("csv", {"file_path": path}))
        assert result.readiness == "manual_ready"
        assert all(c.passed for c in result.checks)
        assert result.sync_mode == "manual"
        assert result.requires_upload is True
        assert "2 reviews" in result.checks[2].detail

    def test_empty_text_rows_not_counted(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as f:
            writer = csv.writer(f)
            writer.writerow(["text"])
            writer.writerow(["Good"])
            writer.writerow([""])
            writer.writerow(["  "])
            writer.writerow(["Also good"])
            path = f.name
        result = validate_source(_make_source("csv", {"file_path": path}))
        assert result.readiness == "manual_ready"
        assert "2 reviews" in result.checks[2].detail


# ---------------------------------------------------------------------------
# JSON import validation
# ---------------------------------------------------------------------------


class TestJsonImportValidation:
    def test_no_file_path(self):
        result = validate_source(_make_source("json_import"))
        assert result.readiness == "config_incomplete"
        assert not result.checks[0].passed

    def test_file_path_missing_on_disk(self):
        result = validate_source(_make_source("json_import", {"file_path": "/nonexistent/test.json"}))
        assert result.readiness == "file_missing"

    def test_invalid_json(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            f.write("not json {{{")
            path = f.name
        result = validate_source(_make_source("json_import", {"file_path": path}))
        assert result.readiness == "config_incomplete"
        assert not result.checks[2].passed
        assert "Invalid JSON" in result.checks[2].detail

    def test_json_not_array(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump({"reviews": []}, f)
            path = f.name
        result = validate_source(_make_source("json_import", {"file_path": path}))
        assert result.readiness == "config_incomplete"
        assert "not an array" in result.checks[2].detail

    def test_json_no_text_entries(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump([{"rating": 5}, {"author": "user"}], f)
            path = f.name
        result = validate_source(_make_source("json_import", {"file_path": path}))
        assert result.readiness == "config_incomplete"

    def test_valid_json(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump([
                {"text": "Good product", "rating": 5},
                {"text": "Bad product", "rating": 1},
                {"text": "OK product"},
            ], f)
            path = f.name
        result = validate_source(_make_source("json_import", {"file_path": path}))
        assert result.readiness == "manual_ready"
        assert all(c.passed for c in result.checks)
        assert result.sync_mode == "manual"
        assert result.requires_upload is True
        assert "3 reviews" in result.checks[2].detail


# ---------------------------------------------------------------------------
# Google Business Profile validation
# ---------------------------------------------------------------------------


class TestGoogleBusinessValidation:
    def test_empty_config(self):
        result = validate_source(_make_source("google_business"))
        assert result.readiness == "auth_missing"
        assert not any(c.passed for c in result.checks if c.name.endswith("_present"))
        assert result.sync_mode == "api"

    def test_partial_config_missing_token(self):
        config = {"account_id": "accounts/123", "location_id": "locations/456"}
        result = validate_source(_make_source("google_business", config))
        assert result.readiness == "auth_missing"
        token_check = next(c for c in result.checks if c.name == "access_token_present")
        assert not token_check.passed

    def test_partial_config_missing_ids(self):
        config = {"access_token": "ya29.xxx"}
        result = validate_source(_make_source("google_business", config))
        assert result.readiness == "config_incomplete"
        assert any("account_id" in s for s in result.next_steps)

    def test_full_config(self):
        config = {
            "account_id": "accounts/123",
            "location_id": "locations/456",
            "access_token": "ya29.xxx",
        }
        result = validate_source(_make_source("google_business", config))
        assert result.readiness == "not_implemented"
        # All key checks pass
        key_checks = [c for c in result.checks if c.name.endswith("_present")]
        assert all(c.passed for c in key_checks)
        # Live check is explicitly flagged
        live_check = next(c for c in result.checks if c.name == "live_connectivity")
        assert not live_check.passed
        assert "spike" in live_check.detail.lower()
        assert result.requires_upload is False

    def test_warnings_present(self):
        result = validate_source(_make_source("google_business"))
        assert any("spike" in w.lower() for w in result.warnings)
        assert any("expires" in w.lower() for w in result.warnings)


# ---------------------------------------------------------------------------
# Mock validation
# ---------------------------------------------------------------------------


class TestMockValidation:
    def test_always_ready(self):
        result = validate_source(_make_source("mock"))
        assert result.readiness == "ready"
        assert all(c.passed for c in result.checks)
        assert result.sync_mode == "auto"
        assert any("fixture" in w.lower() for w in result.warnings)


# ---------------------------------------------------------------------------
# Unknown connector type
# ---------------------------------------------------------------------------


class TestUnknownValidation:
    def test_unrecognized_type(self):
        result = validate_source(_make_source("naver_scraper"))
        assert result.readiness == "not_implemented"
        assert not result.checks[0].passed
        assert result.checks[0].name == "connector_recognized"

    def test_includes_connector_type_in_detail(self):
        result = validate_source(_make_source("custom_thing"))
        assert "custom_thing" in result.checks[0].detail
