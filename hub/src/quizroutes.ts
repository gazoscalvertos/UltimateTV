// The routes behind the family quiz (issue #264). The TV and the phone remote are paired devices
// and run the game; a phone that has joined with the code on the TV answers with a secret of its
// own, so it needs no pairing and can do nothing but play.

import type { FastifyInstance, FastifyRequest } from "fastify";
import QRCode from "qrcode";
import type { ContentFilter } from "./profiles.js";
import { Quiz, QuizError } from "./quiz.js";

export interface QuizRouteDeps {
  quiz: Quiz;
  filter: (req: FastifyRequest) => ContentFilter;
  /** The Hub's address as a phone reaches it. */
  phoneBase: (req: FastifyRequest) => string;
}

export function registerQuiz(app: FastifyInstance, d: QuizRouteDeps): void {
  type Req<B = unknown, Q = Record<string, string>> = FastifyRequest<{ Body: B; Querystring: Q }>;
  const { quiz } = d;

  /** Runs a quiz call, turning the game's complaints into the right answer for the person. */
  const run = async <T>(reply: { code(n: number): { send(b: unknown): unknown } }, fn: () => T | Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof QuizError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  };
  const joinUrl = (req: FastifyRequest) => {
    const code = quiz.code();
    return code ? `${d.phoneBase(req)}/quiz/?code=${code}` : undefined;
  };
  const state = (req: FastifyRequest) => {
    const view = quiz.view();
    return { view, ...(view ? { url: joinUrl(req) } : {}) };
  };

  // --- The TV and the phone remote

  app.get("/api/quiz", async (req) => state(req));

  // The code a phone scans: the page's address with this game's four letters in it.
  app.get("/api/quiz/qr.svg", async (req, reply) => {
    const url = joinUrl(req);
    if (!url) return reply.code(404).send({ error: "There's no quiz on" });
    const svg = await QRCode.toString(url, { type: "svg", margin: 1, color: { dark: "#0b1220", light: "#ffffff" } });
    return reply.type("image/svg+xml").header("Cache-Control", "no-store").send(svg);
  });

  app.post("/api/quiz/open", async (req, reply) =>
    run(reply, async () => {
      await quiz.open(d.filter(req));
      return state(req);
    }),
  );

  app.put("/api/quiz/settings", async (req: Req<Record<string, unknown>>, reply) =>
    run(reply, () => {
      quiz.configure(req.body);
      return state(req);
    }),
  );

  app.post("/api/quiz/players", async (req: Req<{ name?: unknown }>, reply) =>
    run(reply, () => {
      const { player } = quiz.addPlayer(req.body?.name, "remote");
      return { ...state(req), player };
    }),
  );

  app.delete("/api/quiz/players/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) =>
    run(reply, () => {
      quiz.removePlayer(req.params.id);
      return state(req);
    }),
  );

  app.post("/api/quiz/start", async (req, reply) =>
    run(reply, async () => {
      await quiz.start();
      return state(req);
    }),
  );

  app.post("/api/quiz/again", async (req, reply) =>
    run(reply, async () => {
      await quiz.again();
      return state(req);
    }),
  );

  app.post("/api/quiz/answer", async (req: Req<{ choice?: unknown }>, reply) =>
    run(reply, () => {
      quiz.remoteAnswer(req.body?.choice);
      return state(req);
    }),
  );

  app.post("/api/quiz/next", async (req, reply) =>
    run(reply, () => {
      quiz.next();
      return state(req);
    }),
  );

  // The clip has finished playing on the TV: the answers open.
  app.post("/api/quiz/clip-done", async (req, reply) =>
    run(reply, () => {
      quiz.clipDone();
      return state(req);
    }),
  );

  app.delete("/api/quiz", async () => {
    quiz.end();
    return { view: null };
  });

  // --- A phone that has joined

  app.post("/api/quiz/phone/join", async (req: Req<{ code?: unknown; name?: unknown }>, reply) =>
    run(reply, () => {
      const joined = quiz.join(req.body?.code, req.body?.name);
      return joined;
    }),
  );

  app.get("/api/quiz/phone", async (req: Req<unknown, { code?: string; player?: string; secret?: string; rev?: string }>, reply) =>
    run(reply, () => {
      const rev = req.query.rev !== undefined && req.query.rev !== "" ? Number(req.query.rev) : undefined;
      return quiz.phoneView(req.query.code ?? "", req.query.player ?? "", req.query.secret ?? "", rev !== undefined && Number.isFinite(rev) ? rev : undefined);
    }),
  );

  app.post("/api/quiz/phone/answer", async (req: Req<{ code?: string; player?: string; secret?: string; choice?: unknown }>, reply) =>
    run(reply, () => {
      const b = req.body ?? {};
      quiz.phoneAnswer(b.code ?? "", b.player ?? "", b.secret ?? "", b.choice);
      return { ok: true };
    }),
  );

  app.post("/api/quiz/phone/leave", async (req: Req<{ code?: string; player?: string; secret?: string }>, reply) =>
    run(reply, () => {
      const b = req.body ?? {};
      quiz.leave(b.code ?? "", b.player ?? "", b.secret ?? "");
      return { ok: true };
    }),
  );
}
