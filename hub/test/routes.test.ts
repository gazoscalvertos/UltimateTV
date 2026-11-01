// Every writable route the Hub serves says what it needs, checked by reading the code rather than
// by calling it: a route added without a NEEDS/ADMIN_ROUTES entry and without a reason would
// otherwise be open to anything on the home network, and nothing would notice.
//
// The parser here is the same one tools/hub/route-auth.mjs uses to print the table and to run
// `--check` in CI, so there is one answer to "what needs what", not two.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- a plain node script: it has no types, and hub/test isn't in the build.
import { audit, needsOf, parseDeclared, problems, table } from "../../tools/hub/route-auth.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const serverSource = readFileSync(path.join(root, "hub/src/server.ts"), "utf8");
const a = audit(root);
const writeRoutes = a.routes.filter((r: { method: string }) => r.method !== "GET");

describe("the route table", () => {
  it("reads the routes out of hub/src, however the app is registered", () => {
    // A number that means "the parse still works", not "nobody added a route": 142 ordinary routes
    // live in server.ts alone, plus those in the modules it registers.
    expect(a.routes.length, "the parser found almost nothing: routing was refactored, teach the parser").toBeGreaterThan(150);
    expect(writeRoutes.length, "suspiciously few write routes: routing was refactored").toBeGreaterThan(60);
    // The routes registered through a scoped plugin (scares, notices, move) must be in the table too.
    for (const key of ["PUT /api/scares", "POST /api/notify", "DELETE /api/hub/move"]) expect(a.routes.some((r: { key: string }) => r.key === key), key).toBe(true);
    // Generics and multi-line registrations are read, and db.get("SELECT …") is not.
    for (const key of ["GET /api/changelog", "PATCH /api/profiles/:id", "GET /api/channels"]) expect(a.routes.some((r: { key: string }) => r.key === key), key).toBe(true);
    expect(a.routes.some((r: { path: string }) => r.path.startsWith("/api/node:") || r.path.includes("SELECT"))).toBe(false);
  });

  it("gives every route that changes something a declared auth requirement", () => {
    expect(a.unguarded, "these write routes accept anything: add them to NEEDS or ADMIN_ROUTES in hub/src/server.ts, or to PUBLIC_WRITE_ROUTES with a reason").toEqual([]);
    // Nothing is both public and guarded: the table would say two things.
    expect(a.conflicts, "these are in PUBLIC_WRITE_ROUTES but also in NEEDS/ADMIN_ROUTES").toEqual([]);
  });

  it("keeps a reason beside every public write route", () => {
    expect(a.publicRoutes.size).toBeGreaterThan(0);
    for (const [key, reason] of a.publicRoutes) {
      expect(typeof reason, key).toBe("string");
      expect(reason.length, `${key} needs a one-line reason next to it`).toBeGreaterThan(20);
    }
  });

  it("keeps the public list out of the auth hook's way", () => {
    // PUBLIC_WRITE_ROUTES is documentation the test reads; the hook must keep deciding from
    // NEEDS and ADMIN_ROUTES, or a route could be made open by adding a comment.
    const hook = serverSource.slice(serverSource.indexOf('app.addHook("preHandler"'), serverSource.indexOf("app.setErrorHandler"));
    expect(hook).toContain("NEEDS.get(route)");
    expect(hook).toContain("ADMIN_ROUTES.has(route)");
    expect(hook).not.toContain("PUBLIC_WRITE_ROUTES");
    // And it is read by this test, so it must exist and be exported from the file the hook is in.
    expect(serverSource).toContain("const PUBLIC_WRITE_ROUTES");
    expect(parseDeclared(serverSource).publicRoutes.size).toBe(a.publicRoutes.size);
  });

  it("does not keep declarations for routes nobody serves", () => {
    // A renamed route that left its old name behind in NEEDS would guard nothing and quietly
    // become open; this catches that half-done rename as well as a dropped declaration.
    expect(a.stale, "these are declared but no route serves them: a rename left them behind").toEqual([]);
  });

  it("says what each route needs in plain words", () => {
    const need = (key: string) => needsOf(a.routes.find((r: { key: string }) => r.key === key), a);
    expect(need("PUT /api/settings")).toBe("paired + adult");
    expect(need("POST /api/remote/key")).toBe("paired or API key");
    expect(need("GET /api/pair/code")).toBe("paired TV");
    expect(need("GET /api/channels")).toBe("open");
    expect(need("POST /api/pair/screen")).toBe("public");
    // Making things is "paired" (the phone remote and Kids profiles record); deleting them is adult.
    expect(need("POST /api/recordings")).toBe("paired");
    expect(need("DELETE /api/recordings/:id")).toBe("paired + adult");
  });

  it("prints a row for every route, and --check agrees with the test", () => {
    const printed = table(a);
    expect(printed.split("\n").filter((l: string) => l.startsWith("| ") && !l.startsWith("| Method") && !l.startsWith("| ---"))).toHaveLength(a.routes.length);
    expect(printed).toContain("| POST | `/api/pair/screen` | public |");
    expect(problems(root)).toEqual([]);
    // Running it is what CI does, so run it: the script must exit 0 and name the count.
    const out = execFileSync(process.execPath, [path.join(root, "tools/hub/route-auth.mjs"), "--check"], { cwd: root, encoding: "utf8" });
    expect(out).toMatch(/all declared/);
  });
});
