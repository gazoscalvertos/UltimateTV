// The family quiz over HTTP (issue #264): who can run a game, how a phone joins and plays, and the
// demo library making questions.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { QuizState, QuizView } from "@ultimatetv/shared";
import type { HubConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";
import { pairAsTv } from "./helpers.js";

let tmp: string;
let app: Awaited<ReturnType<typeof buildServer>>;
const stranger = { "x-device-token": "" };

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-quiz-"));
  const config: HubConfig = {
    port: 8095,
    host: "127.0.0.1",
    dataDir: path.join(tmp, "data"),
    clipsDir: path.join(tmp, "clips"),
    probeDir: path.join(tmp, "probe"),
    uiDir: path.join(tmp, "ui"),
    setupDir: path.join(tmp, "setup"),
    remoteDir: path.join(tmp, "remote"),
    quizDir: new URL("../public/quiz", import.meta.url).pathname,
    mediaRoot: path.join(tmp, "media"),
    demo: true,
  };
  app = await buildServer(config, { systemReport: async () => ({ ffmpeg: null, hwaccels: [], renderNode: null, vaapi: { available: false, driver: null, profiles: [] }, checks: { av1HardwareDecode: false, hevcHardwareEncode: false, hevc10HardwareEncode: false } }) });
  await pairAsTv(app);
});

afterAll(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

describe("the family quiz on the Hub", () => {
  it("serves the phone page", async () => {
    const res = await app.inject({ url: "/quiz/", headers: stranger });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Join the quiz");
  });

  it("is run by a paired TV or phone, not by a stranger", async () => {
    expect((await app.inject({ method: "POST", url: "/api/quiz/open", headers: stranger })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/quiz/start", headers: stranger })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/quiz", headers: stranger })).statusCode).toBe(401);
  });

  it("plays a game with a TV player and a phone that joins with the code", async () => {
    const opened = (await app.inject({ method: "POST", url: "/api/quiz/open" })).json<QuizState>();
    expect(opened.view?.phase).toBe("lobby");
    expect(opened.url).toMatch(/\/quiz\/\?code=[A-Z]{4}$/);
    const code = opened.view!.code;

    // The TV sets it up: one player on the remote, general knowledge only.
    await app.inject({ method: "PUT", url: "/api/quiz/settings", payload: { style: "together", rounds: ["general", "science", "geography"], difficulty: "easy", seconds: 0, questions: 8 } });
    const added = (await app.inject({ method: "POST", url: "/api/quiz/players", payload: { name: "Dad" } })).json<{ view: QuizView }>();
    expect(added.view.players.map((p) => p.name)).toEqual(["Dad"]);

    // A phone with no pairing joins with the code.
    const bad = await app.inject({ method: "POST", url: "/api/quiz/phone/join", headers: stranger, payload: { code: "ZZZZ", name: "Mia" } });
    expect(bad.statusCode).toBe(404);
    const joined = (await app.inject({ method: "POST", url: "/api/quiz/phone/join", headers: stranger, payload: { code: code.toLowerCase(), name: "Mia" } })).json<{ id: string; secret: string; view: QuizView }>();
    expect(joined.view.you).toBe(joined.id);

    // Nobody sees an answer early, and the TV starts.
    const started = (await app.inject({ method: "POST", url: "/api/quiz/start" })).json<QuizState>();
    expect(started.view?.phase).toBe("question");
    expect(JSON.stringify(started.view)).not.toContain('"correct"');
    const phone = () => app.inject({ url: `/api/quiz/phone?code=${code}&player=${joined.id}&secret=${joined.secret}`, headers: stranger });
    const seen = (await phone()).json<QuizView>();
    expect(seen.question?.options).toHaveLength(4);
    expect(seen.question?.clip).toBeUndefined();
    expect((await app.inject({ url: `/api/quiz/phone?code=${code}&player=${joined.id}&secret=wrong`, headers: stranger })).statusCode).toBe(403);
    expect((await app.inject({ url: `/api/quiz/phone?code=${code}&player=${joined.id}&secret=${joined.secret}&rev=${seen.rev}`, headers: stranger })).json()).toMatchObject({ unchanged: true });

    // The remote's colour key answers for Dad (the one remote player), the phone for Mia: then it reveals.
    expect((await app.inject({ method: "POST", url: "/api/quiz/answer", payload: { choice: 1 } })).statusCode).toBe(200);
    const mine = await app.inject({ method: "POST", url: "/api/quiz/phone/answer", headers: stranger, payload: { code, player: joined.id, secret: joined.secret, choice: 2 } });
    expect(mine.statusCode).toBe(200);
    const revealed = (await phone()).json<QuizView>();
    expect(revealed.phase).toBe("reveal");
    expect(revealed.reveal?.correct).toBeGreaterThanOrEqual(0);
    expect(revealed.yourChoice).toBe(2);

    // The host moves on, and an answer that isn't one of the four is refused.
    const moved = (await app.inject({ method: "POST", url: "/api/quiz/next" })).json<QuizState>();
    expect(moved.view?.question?.number).toBe(2);
    const wrong = await app.inject({ method: "POST", url: "/api/quiz/answer", payload: { choice: 7 } });
    expect(wrong.statusCode).toBe(400);

    // Ending the game turns the phone away.
    await app.inject({ method: "DELETE", url: "/api/quiz" });
    expect((await app.inject({ url: "/api/quiz" })).json<QuizState>().view).toBeNull();
    expect((await phone()).statusCode).toBe(404);
  });

  it("asks for a player before it starts", async () => {
    await app.inject({ method: "POST", url: "/api/quiz/open" });
    const res = await app.inject({ method: "POST", url: "/api/quiz/start" });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/player/i);
    await app.inject({ method: "DELETE", url: "/api/quiz" });
  });

  it("answers 404 when there is no quiz", async () => {
    const res = await app.inject({ method: "POST", url: "/api/quiz/next" });
    expect(res.statusCode).toBe(404);
  });
});
