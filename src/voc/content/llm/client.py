"""LLM client abstraction for the content engine polish layer.

Two implementations:

  - `MockLLMClient` — script-driven, deterministic, no network. Drives
    every Phase D test. Each `complete()` call pops the next response
    from a queue; queue items can be strings (returned as-is) or
    Exception instances (raised). Use to script success / retry /
    fail sequences.

  - `AnthropicLLMClient` — production. Lazy-imports `anthropic` so the
    test suite (which never instantiates this class) doesn't need the
    SDK installed. Reads `ANTHROPIC_API_KEY` from env at construction
    time; missing key raises immediately so the runner can mark
    editorial=failed without retrying.

Both implementations satisfy the `LLMClient` Protocol so the polish
layer is implementation-agnostic.
"""
from __future__ import annotations

import os
from typing import Protocol


DEFAULT_MODEL = "claude-haiku-4-5"
DEFAULT_TEMPERATURE = 0.3
DEFAULT_MAX_TOKENS = 4096


class LLMClient(Protocol):
    """Minimal surface the polish layer needs.

    `model` and `temperature` are read by the cache key builder so
    they must be exposed as attributes (not just constructor args).
    """
    model: str
    temperature: float

    def complete(self, *, system: str, user: str) -> str:
        ...


class MockLLMClient:
    """Test double for `LLMClient`.

    Construct with a list of canned responses; each `complete()`
    call pops the next item. String items are returned verbatim;
    Exception items are raised. Empty queue raises RuntimeError so
    a forgotten response in a test fails loudly rather than
    returning empty string.
    """

    def __init__(
        self,
        responses: list[str | BaseException],
        *,
        model: str = "mock-model",
        temperature: float = 0.0,
    ):
        self._responses: list[str | BaseException] = list(responses)
        self.model = model
        self.temperature = temperature
        self.calls: list[dict] = []

    @property
    def call_count(self) -> int:
        return len(self.calls)

    def complete(self, *, system: str, user: str) -> str:
        self.calls.append({"system": system, "user": user})
        if not self._responses:
            raise RuntimeError(
                "MockLLMClient: response queue empty — test forgot to "
                "queue a response?"
            )
        r = self._responses.pop(0)
        if isinstance(r, BaseException):
            raise r
        return r


class AnthropicLLMClient:
    """Production LLM client. Lazy-imports the `anthropic` SDK.

    Construction:
        AnthropicLLMClient(model="claude-haiku-4-5", temperature=0.3)

    Reads `ANTHROPIC_API_KEY` from env. Missing key → ValueError at
    construction time; the runner catches and marks editorial=failed
    without ever calling .complete().
    """

    def __init__(
        self,
        *,
        model: str = DEFAULT_MODEL,
        temperature: float = DEFAULT_TEMPERATURE,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        api_key: str | None = None,
    ):
        api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise ValueError(
                "AnthropicLLMClient requires ANTHROPIC_API_KEY in env "
                "or passed explicitly"
            )
        # Lazy import — tests never reach this branch.
        try:
            from anthropic import Anthropic  # type: ignore
        except ImportError as exc:
            raise RuntimeError(
                "anthropic SDK not installed; install with "
                "`pip install anthropic` or use MockLLMClient in tests"
            ) from exc
        self._client = Anthropic(api_key=api_key)
        self.model = model
        self.temperature = temperature
        self.max_tokens = max_tokens

    def complete(self, *, system: str, user: str) -> str:
        """Send one message and return the concatenated text content.

        Anthropic's response shape is a list of content blocks; we
        join the text blocks. The polish layer handles JSON parsing.
        """
        message = self._client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            temperature=self.temperature,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        chunks: list[str] = []
        for block in message.content:
            text = getattr(block, "text", None)
            if text:
                chunks.append(text)
        return "".join(chunks)
