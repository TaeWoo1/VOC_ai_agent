"""M6-B agent runtime adapters.

Each adapter implements the `agent_runtime.AgentRuntimeAdapter` Protocol. In M6-B
only `mock_adapter` is functional (hermetic, for tests); `claude_code_local` is a
stub whose run/dry_run raise NotImplementedError until M6-C.
"""
