// The routes behind Coming up, the Follow button and the pop-up setting (issue #226).

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { TitleRef } from "@ultimatetv/shared";
import type { Following } from "./following.js";
import type { ContentFilter } from "./profiles.js";

export function registerFollowing(app: FastifyInstance, following: Following, who: (req: FastifyRequest) => { profileId: string | null; filter: ContentFilter }): void {
  type Req<B = unknown, Q = Record<string, string | undefined>> = FastifyRequest<{ Body: B; Params: { id: string }; Querystring: Q }>;

  app.get("/api/following", async (req) => {
    const { profileId, filter } = who(req);
    return following.view(profileId, filter);
  });

  app.post("/api/following", async (req: Req<{ title?: Partial<TitleRef> }>, reply) => {
    const { profileId, filter } = who(req);
    const t = req.body?.title;
    if (!t || typeof t.id !== "string" || typeof t.name !== "string" || t.kind !== "series") return reply.code(400).send({ error: "Say which series to follow" });
    const title: TitleRef = { ...(t as TitleRef), kind: "series" };
    if (!filter.ref(title)) return reply.code(403).send({ error: "That isn't available on this profile" });
    following.follow(profileId, title);
    return following.view(profileId, filter);
  });

  app.delete("/api/following/:id", async (req: Req<unknown, { name?: string }>) => {
    const { profileId, filter } = who(req);
    const id = decodeURIComponent(req.params.id);
    following.unfollow(profileId, { id, name: req.query.name ?? id });
    return following.view(profileId, filter);
  });

  app.put("/api/following/popups", async (req: Req<{ on?: unknown }>, reply) => {
    const { profileId } = who(req);
    if (typeof req.body?.on !== "boolean") return reply.code(400).send({ error: "Send on: true or false" });
    following.setPopups(profileId, req.body.on);
    return { popups: req.body.on };
  });
}
