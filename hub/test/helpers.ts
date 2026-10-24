import type { Channel, Programme } from "@ultimatetv/shared";

export function channel(id: string, extra: Partial<Channel> = {}): Channel {
  return { id, number: 101, name: id.toUpperCase(), category: "entertainment", feeds: [], favourite: false, hidden: false, maxHeight: 1080, catchupDays: 0, ...extra };
}

export function programme(channelId: string, start: number, mins: number, extra: Partial<Programme> = {}): Programme {
  return {
    id: `${channelId}:${start}`,
    channelId,
    start,
    end: start + mins * 60_000,
    title: "Show",
    categories: [],
    isNew: false,
    isRepeat: false,
    isFilm: false,
    seriesKey: "t:show",
    ...extra,
  };
}

/** A fetch that streams `chunks` slowly until aborted, like a live TS feed. */
export function liveFetch(opts: { failFirst?: number; chunkMs?: number; chunkBytes?: number } = {}) {
  let calls = 0;
  const urls: string[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls++;
    urls.push(String(url));
    if (calls <= (opts.failFirst ?? 0)) return new Response("nope", { status: 502 });
    const signal = init?.signal;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await new Promise((r) => setTimeout(r, opts.chunkMs ?? 5));
        if (signal?.aborted) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(opts.chunkBytes ?? 188).fill(0x47));
      },
    });
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  return { impl, calls: () => calls, urls };
}
