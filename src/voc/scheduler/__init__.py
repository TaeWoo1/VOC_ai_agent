"""Scheduler — APScheduler runner that enqueues per-ChannelConnection cadence jobs.

Runs as a separate process from the API and workers. Survives restarts via the
Postgres job store. Scheduler MUST NOT import workers or adapters directly; it
only enqueues onto the queue port. See plan §E.M3.

Empty in M0; runner + cadence land in M3.
"""
