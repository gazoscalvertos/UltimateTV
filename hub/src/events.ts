import type { HubEvent } from "@ultimatetv/shared";

export class EventBus {
  private listeners = new Set<(e: HubEvent) => void>();

  emit(event: HubEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // A broken socket must not stop other listeners.
      }
    }
  }

  on(listener: (e: HubEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
