"""Shared test fixtures."""

from __future__ import annotations

from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"


@pytest.fixture
def fixtures_dir() -> Path:
    return FIXTURES_DIR


@pytest.fixture
def sample_korean_text() -> str:
    return "노이즈캔슬링은 정말 좋은데 배터리가 너무 빨리 닳아요."


@pytest.fixture
def sample_english_text() -> str:
    return "Great noise cancellation but the fit is uncomfortable for long sessions."
