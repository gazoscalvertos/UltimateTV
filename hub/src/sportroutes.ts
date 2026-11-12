// The routes behind Sport tonight (issue #231): the view, favourite teams, and the reminder / record switches.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Sport } from "./sport.js";
import type { ContentFilter } from "./profiles.js";

export function registerSport(app: FastifyInstance, sport: Sport, who: (req: FastifyRequest) => { profileId: string | null; filter: ContentFilter }): void {
  type Req<B = unknown> = FastifyRequest<{ Body: B }>;

  app.get("/api/sport", async (req) => {
    const { profileId, filter } = who(req);
    return sport.view(profileId, filter);
  });

  app.put("/api/sport/settings", async (req: Req<{ teams?: unknown; remind?: unknown; record?: unknown }>, reply) => {
    const { profileId, filter } = who(req);
    const b = req.body ?? {};
    if ((b.teams !== undefined && !Array.isArray(b.teams)) || (b.remind !== undefined && typeof b.remind !== "boolean") || (b.record !== undefined && typeof b.record !== "boolean")) {
      return reply.code(400).send({ error: "Send teams as a list, remind and record as true or false" });
    }
    // A guest's favourites would only be seen by the next guest.
    if (filter.guest) return reply.code(403).send({ error: "A guest can't keep favourites" });
    sport.set(profileId, { ...(b.teams !== undefined ? { teams: b.teams as string[] } : {}), ...(b.remind !== undefined ? { remind: b.remind as boolean } : {}), ...(b.record !== undefined ? { record: b.record as boolean } : {}) });
    return sport.view(profileId, filter);
  });

  app.post("/api/sport/teams", async (req: Req<{ name?: unknown }>, reply) => {
    const { profileId, filter } = who(req);
    if (typeof req.body?.name !== "string" || req.body.name.trim().length < 2) return reply.code(400).send({ error: "Say which team or sport" });
    if (filter.guest) return reply.code(403).send({ error: "A guest can't keep favourites" });
    sport.addTeam(profileId, req.body.name);
    return sport.view(profileId, filter);
  });

  app.delete("/api/sport/teams", async (req: FastifyRequest<{ Querystring: { name?: string } }>, reply) => {
    const { profileId, filter } = who(req);
    if (!req.query.name) return reply.code(400).send({ error: "Say which team or sport" });
    sport.removeTeam(profileId, req.query.name);
    return sport.view(profileId, filter);
  });
}
