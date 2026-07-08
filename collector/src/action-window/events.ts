/**
 * In-memory Action Window event sink (R1). Stores the sanitized contract events the engine emits.
 * No transport, no Bridge handler — R1 emits to this sink only.
 */
import type { EventEnvelope, EventType } from "../../../contracts/action-window/v1/index";

export class InMemoryEventSink {
  private readonly events: EventEnvelope[] = [];

  push(e: EventEnvelope): void {
    this.events.push(e);
  }

  all(): readonly EventEnvelope[] {
    return this.events;
  }

  types(): EventType[] {
    return this.events.map((e) => e.type);
  }

  sequence(): number[] {
    return this.events.map((e) => e.sequence);
  }

  last(): EventEnvelope | undefined {
    return this.events[this.events.length - 1];
  }
}
