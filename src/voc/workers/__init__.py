"""Workers — queue consumers that execute one job end-to-end.

Ingest Worker holds the deterministic critical path; Indexer Worker and Analysis
Worker are async downstream consumers. Workers MUST NOT import FastAPI. See
plan §C.2 and §C.3.

Empty in M0; runner + ingest_worker land in M2, indexer_worker + analysis_worker in M4.
"""
