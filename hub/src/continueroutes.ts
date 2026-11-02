// Removing a title from Continue watching (issue #100): an Options entry on the cards, on the
// phone too. "Remove" hides it for that profile and keeps the progress; "Mark as watched"
// finishes it, telling Jellyfin for Jellyfin titles. Neither touches anything else, so a film
// abandoned after ten minutes stops sitting at the front of Home for ever.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { HubContext } from "./context.js";

type Req<B> = FastifyRequest<{ Body: B; Params: { id: string } }>;

/** The Jellyfin item a title id stands for, if it is a Jellyfin one. */
const jellyfinItem = (titleId: string): string | undefined => (titleId.startsWith("jellyfin:") ? titleId.slice(9) : undefined);

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

  /** Marks it watched (or not), which drops it from the row and updates Jellyfin too. */
  app.post("/api/continue/:id/watched", async (req: Req<{ watched?: boolean }>) => {
    const id = decodeURIComponent(req.params.id);
    const watched = req.body?.watched !== false;
    const keys = ctx.progress.forTitle(id).map((e) => e.key);
    if (watched) {
      ctx.progress.markWatched(id);
      // Nothing of it played here? Mark the title itself, so it doesn't come straight back.
      if (keys.length === 0) ctx.progress.save({ key: id.startsWith("jellyfin:") ? id : `title:${id}`, positionMs: 0, watched: true }, Date.now());
    } else {
      for (const key of keys) {
        const entry = ctx.progress.get(key);
        if (entry) ctx.progress.save({ ...entry, watched: false });
      }
    }

    // Jellyfin titles: tell Jellyfin as well, so its own resume row goes too.
    const jf = ctx.jellyfin();
    if (jf) {
      const items = new Set(keys.filter((k) => k.startsWith("jellyfin:")).map((k) => k.slice(9)));
      const own = jellyfinItem(id);
      if (own) items.add(own);
      for (const item of items) {
        await jf.markPlayed(item, watched).catch((err) => ctx.log.warn({ err: String(err), item }, "Jellyfin didn't take the played flag"));
      }
    }
    ctx.events.emit({ type: "progress.changed" });
    return { ok: true, watched };
  });
}
