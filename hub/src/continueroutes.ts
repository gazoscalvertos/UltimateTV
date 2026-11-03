// Removing a title from Continue watching (issue #100): an Options entry on the cards, on the
// phone too. "Remove" hides it for that profile and keeps the progress; "Mark as watched"
// finishes it, telling the media server (Jellyfin or Plex) for its own titles. Neither touches
// anything else, so a film abandoned after ten minutes stops sitting at the front of Home for ever.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { HubContext } from "./context.js";

type Req<B> = FastifyRequest<{ Body: B; Params: { id: string } }>;

/** The library item a title id stands for, if it is the connected media server's. */
const serverItem = (titleId: string, ctx: HubContext): string | undefined => ctx.media()?.parseKey(titleId);

export function registerContinue(app: FastifyInstance, ctx: HubContext, who: (req: FastifyRequest) => { profileId: string | null }): void {
  /** Hides the card for this profile (or puts it back, for Undo). The progress stays. */
  app.post("/api/continue/:id/hide", async (req: Req<{ hidden?: boolean }>) => {
    const { profileId } = who(req);
    const id = decodeURIComponent(req.params.id);
    const hidden = req.body?.hidden !== false;
    if (hidden) ctx.continueHidden.hide(profileId, id);
    else ctx.continueHidden.show(profileId, id);
    return { ok: true, hidden };
  });

  /** Marks it watched (or not), which drops it from the row and updates the media server too. */
  app.post("/api/continue/:id/watched", async (req: Req<{ watched?: boolean }>) => {
    const id = decodeURIComponent(req.params.id);
    const watched = req.body?.watched !== false;
    const keys = ctx.progress.forTitle(id).map((e) => e.key);
    if (watched) {
      ctx.progress.markWatched(id);
      // Nothing of it played here? Mark the title itself, so it doesn't come straight back.
      if (keys.length === 0) ctx.progress.save({ key: ctx.media()?.parseKey(id) ? id : `title:${id}`, positionMs: 0, watched: true }, Date.now());
    } else {
      for (const key of keys) {
        const entry = ctx.progress.get(key);
        if (entry) ctx.progress.save({ ...entry, watched: false });
      }
    }

    // The server's own titles: tell it as well, so its resume row goes too.
    const media = ctx.media();
    if (media) {
      const items = new Set(keys.map((k) => media.parseKey(k)).filter((k): k is string => Boolean(k)));
      const own = serverItem(id, ctx);
      if (own) items.add(own);
      for (const item of items) {
        await media.markPlayed(item, watched).catch((err) => ctx.log.warn({ err: String(err), item }, "The media server didn't take the played flag"));
      }
    }
    ctx.events.emit({ type: "progress.changed" });
    return { ok: true, watched };
  });
}
