"""Channel adapters — one per (source_domain, collection_strategy) pair.

Adapters are isolated channel-specific code that implements the ChannelAdapter
protocol (added in M2). They MUST NOT import application services, repositories,
or LLM modules. See plan §C.4 for layer discipline.

Empty in M0; protocol + first adapter land in M2.
"""
