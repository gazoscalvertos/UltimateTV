// Live channel relay: one upstream IPTV stream per channel, fanned out to every consumer (the box,
// a recording, or both), with automatic fallback to the channel's next feed when one drops.

import { PassThrough, Readable } from "node:stream";
import type { ChannelStore, StoredFeed } from "./channels.js";
import { ConnectionGuard, type LeaseKind } from "./connections.js";
import { IPTV_USER_AGENT, redactUrl, type Fetch } from "./http.js";
import type { Logger } from "./log.js";

export interface RelayConsumer {
  stream: PassThrough;
  /** Why the stream ended early, if it did. */
  ended: Promise<string | null>;
  close(): void;
}

interface Session {
  channelId: string;
  key: string;
  feeds: StoredFeed[];
  feedIndex: number;
  consumers: Map<string, { stream: PassThrough; resolve: (reason: string | null) => void }>;
  abort: AbortController | null;
  closing: NodeJS.Timeout | null;
  failures: number;
  bytes: number;
  startedAt: number;
}

const MAX_FAILURES = 12;
const GRACE_MS = 4_000;

export class LiveRelay {
  private sessions = new Map<string, Session>();

  constructor(
    private channels: ChannelStore,
    private guard: ConnectionGuard,
    private log: Logger,
    private fetchImpl: Fetch = fetch,
  ) {}

  static key(channelId: string): string {
    return `live:${channelId}`;
  }

  /**
   * Subscribes `holder` to a channel. Throws ConnectionBusyError when the connection limit is
   * reached by something that can't be pre-empted (a recording, unless `force`).
   */
  subscribe(channelId: string, holder: string, kind: LeaseKind, force = false): RelayConsumer {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error(`Unknown channel ${channelId}`);
    const key = LiveRelay.key(channelId);

    this.guard.acquire({
      key,
      holder,
      kind,
      force,
      label: kind === "record" ? `Recording ${channel.name}` : `Watching ${channel.name}`,
      onRevoke: (reason) => this.endSession(key, reason),
    });

    let session = this.sessions.get(key);
    if (!session) {
      const feeds = this.channels.feeds(channelId);
      if (feeds.length === 0) {
        this.guard.release(key, holder);
        throw new Error(`${channel.name} has no streams`);
      }
      session = { channelId, key, feeds, feedIndex: 0, consumers: new Map(), abort: null, closing: null, failures: 0, bytes: 0, startedAt: Date.now() };
      this.sessions.set(key, session);
      void this.pump(session);
    }
    if (session.closing) {
      clearTimeout(session.closing);
      session.closing = null;
    }

    // A holder re-subscribing (mpv reconnecting) replaces its old stream.
    session.consumers.get(holder)?.stream.end();
    const stream = new PassThrough({ highWaterMark: 4 * 1024 * 1024 });
    let resolve!: (reason: string | null) => void;
    const ended = new Promise<string | null>((r) => (resolve = r));
    session.consumers.set(holder, { stream, resolve });
    const s = session;
    const close = () => this.unsubscribe(s, holder);
    stream.on("close", close);
    return { stream, ended, close };
  }

  private unsubscribe(session: Session, holder: string): void {
    const consumer = session.consumers.get(holder);
    if (!consumer) return;
    session.consumers.delete(holder);
    consumer.resolve(null);
    consumer.stream.end();
    this.guard.release(session.key, holder);
    if (session.consumers.size === 0 && !session.closing) {
      // Keep the upstream briefly so a quick re-open (mpv probing, back-to-back zaps) is instant.
      session.closing = setTimeout(() => this.endSession(session.key, "idle"), GRACE_MS);
    }
  }

  private endSession(key: string, reason: string): void {
    const session = this.sessions.get(key);
    if (!session) return;
    this.sessions.delete(key);
    if (session.closing) clearTimeout(session.closing);
    session.abort?.abort();
    for (const [holder, c] of session.consumers) {
      c.resolve(reason === "idle" ? null : reason);
      c.stream.end();
      this.guard.release(key, holder);
    }
    session.consumers.clear();
  }

  private async pump(session: Session): Promise<void> {
    while (this.sessions.get(session.key) === session && session.failures < MAX_FAILURES) {
      const feed = session.feeds[session.feedIndex % session.feeds.length]!;
      const abort = new AbortController();
      session.abort = abort;
      try {
        const res = await this.fetchImpl(feed.url, { signal: abort.signal, headers: { "User-Agent": IPTV_USER_AGENT } });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>);
        for await (const chunk of body) {
          if (this.sessions.get(session.key) !== session) break;
          session.bytes += (chunk as Buffer).length;
          session.failures = 0;
          for (const { stream } of session.consumers.values()) {
            // A consumer that can't keep up (paused player) drops data instead of stalling everyone.
            if (stream.writableLength < 32 * 1024 * 1024) stream.write(chunk);
          }
        }
        if (this.sessions.get(session.key) !== session) return;
        throw new Error("upstream ended");
      } catch (err) {
        if (abort.signal.aborted && this.sessions.get(session.key) !== session) return;
        session.failures++;
        this.log.warn({ channel: session.channelId, feed: redactUrl(feed.url), err: String(err), failures: session.failures }, "Live stream dropped, reconnecting");
        // Try the next feed (HD → SD backup) and back off a little on repeated failures.
        if (session.feeds.length > 1) session.feedIndex++;
        await new Promise((r) => setTimeout(r, Math.min(500 * session.failures, 5_000)));
      }
    }
    if (this.sessions.get(session.key) === session) this.endSession(session.key, "The channel's stream isn't working");
  }

  /** Channels with an open upstream, for the status page. */
  active(): { channelId: string; consumers: string[]; bytes: number; since: number }[] {
    return [...this.sessions.values()].map((s) => ({ channelId: s.channelId, consumers: [...s.consumers.keys()], bytes: s.bytes, since: s.startedAt }));
  }

  closeAll(): void {
    for (const key of [...this.sessions.keys()]) this.endSession(key, "shutdown");
  }
}
