"""Industrial-materials review-ops report pilot (CSV upload, HTML output).

A self-contained, rule-based pipeline that consolidates multi-channel commerce
reviews for an industrial-materials seller and produces a worklist-first HTML
report: "이번 주 운영자가 볼 리뷰".

This package does NOT touch the K-beauty flows (phase2e, reporting/review_ops,
OliveYoung, Instagram, outreach, beauty lexicons). The only shared dependency is
the content-fingerprint function in ``src.voc.ingestion.normalizer`` (CLAUDE.md
§10, single fingerprint path).
"""
