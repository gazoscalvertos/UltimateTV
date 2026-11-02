#!/usr/bin/env node
// Every route the Hub serves, and what it takes to use each one: a paired phone or screen, a
// paired TV, the API key, an adult profile, or nothing at all. The answers live in
// hub/src/server.ts — NEEDS, ADMIN_ROUTES and PUBLIC_WRITE_ROUTES — and the auth hook there uses
// the first two, so this table is the same thing the Hub enforces, read out of the code.
//
//   node tools/hub/route-auth.mjs           # print the table
//   node tools/hub/route-auth.mjs --check   # exit 1 if a write route declares no auth
//
// --check also fails on a declaration that names a route nobody serves any more (a rename that
// was only half done), on a route declared twice for different reasons, and on a public route
// with no reason. hub/test/routes.test.ts runs the same checks, so a new write route can't land
// without saying what it needs.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "../..");
/** The file that says what each route needs, and the one the table is read from. */
export const SERVER_FILE = "hub/src/server.ts";

/** A route as registered: the file it lives in, the method, and the path Fastify matches. */
export function parseRoutes(root = ROOT) {
  const dir = path.join(root, "hub/src");
  const files = sources(dir);
  const routes = [];
  const seen = new Set();
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(routeRe)) {
      const method = m[2].toUpperCase();
      const routePath = m[4];
      const key = `${method} ${routePath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push({ file: path.relative(root, file), method, path: routePath, key });
    }
  }
  return routes;
}

// Matches a registration on the Fastify instance — `app` everywhere, `scope` inside the plugins
// that register their routes in a callback — with or without a type parameter, and only when the
// path starts with "/". The identifier and the leading slash are what keep the other `.get("/…")`
// in the codebase out of the table: TMDB calls, `db.get("SELECT …")`, `headers.get("location")`.
const routeRe = /\b(app|scope)\.(get|post|put|patch|delete)(?:\s*<[^(]*?>)?\s*\(\s*(?:\{[^{}]*\}\s*,\s*)?(["'`])(\/[^"'`]*)\3/gs;

/** Every .ts file under hub/src, however deep (the routes are spread over ~20 modules). */
function sources(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/** What hub/src/server.ts declares: the NEEDS map, the ADMIN_ROUTES set, the public list. */
export function parseDeclared(serverSource) {
  const needs = new Map(
    [...block(serverSource, "const NEEDS").matchAll(/\[\s*"([A-Z]+ \/[^"]*)",\s*"(tv|paired|script)"\s*\]/g)].map((m) => [m[1], m[2]]),
  );
  const admin = new Set([...block(serverSource, "const ADMIN_ROUTES").matchAll(/"([A-Z]+ \/[^"]*)"/g)].map((m) => m[1]));
  const publicRoutes = new Map(
    [...block(serverSource, "const PUBLIC_WRITE_ROUTES").matchAll(/\[\s*"([A-Z]+ \/[^"]*)",\s*"([^"]*)"\s*\]/g)].map((m) => [m[1], m[2]]),
  );
  return { needs, admin, publicRoutes };
}

/** The array or set literal that starts with `name`, up to its closing `]);`. */
function block(src, name) {
  const at = src.indexOf(name);
  if (at < 0) return "";
  const end = src.indexOf("]);", at);
  return src.slice(at, end < 0 ? undefined : end);
}

/** Read-only: which routes would the Hub turn away, and which declarations are stale. */
export function audit(root = ROOT) {
  const routes = parseRoutes(root);
  const writes = routes.filter((r) => r.method !== "GET");
  const declared = parseDeclared(readFileSync(path.join(root, SERVER_FILE), "utf8"));
  const guarded = (key) => declared.needs.has(key) || declared.admin.has(key);
  const unguarded = writes.filter((r) => !guarded(r.key) && !declared.publicRoutes.has(r.key)).map((r) => r.key).sort();
  const conflicts = [...declared.publicRoutes.keys()].filter((key) => guarded(key)).sort();
  const stale = [...declared.needs.keys(), ...declared.admin, ...declared.publicRoutes.keys()]
    .filter((key, i, all) => all.indexOf(key) === i && !routes.some((r) => r.key === key))
    .sort();
  return { routes, writes, ...declared, unguarded, conflicts, stale };
}

/** One line per route: what a caller needs. */
export function needsOf(route, declared) {
  if (declared.publicRoutes.has(route.key)) return "public";
  const need = declared.needs.get(route.key);
  const adult = declared.admin.has(route.key);
  if (need === "tv") return adult ? "paired TV + adult" : "paired TV";
  if (need === "paired") return adult ? "paired + adult" : "paired";
  if (need === "script") return adult ? "paired or API key + adult" : "paired or API key";
  if (adult) return "paired + adult";
  return "open";
}

/** The whole table, markdown, sorted by path so related routes sit together. */
export function table({ routes } = audit()) {
  const order = { GET: 0, POST: 1, PUT: 2, PATCH: 3, DELETE: 4 };
  const rows = [...routes].sort((a, b) => (a.path === b.path ? order[a.method] - order[b.method] : a.path < b.path ? -1 : 1));
  const declared = parseDeclared(readFileSync(path.join(ROOT, SERVER_FILE), "utf8"));
  return [
    `| Method | Path | Needs |`,
    `| --- | --- | --- |`,
    ...rows.map((r) => `| ${r.method} | \`${r.path}\` | ${needsOf(r, declared)} |`),
  ].join("\n");
}

/** Everything --check complains about, as lines; empty means all good. */
export function problems(root = ROOT) {
  const a = audit(root);
  const out = [];
  for (const key of a.unguarded) out.push(`${key}: a write route with no auth declared (add it to NEEDS or ADMIN_ROUTES, or to PUBLIC_WRITE_ROUTES with a reason)`);
  for (const key of a.conflicts) out.push(`${key}: listed in PUBLIC_WRITE_ROUTES but also guarded — pick one`);
  for (const key of a.stale) out.push(`${key}: declared but no route serves it any more`);
  for (const [key, reason] of a.publicRoutes) if (!reason.trim()) out.push(`${key}: public with no reason said`);
  return out;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.includes("--check")) {
    const found = problems();
    if (found.length) {
      console.error(`route auth: ${found.length} problem(s)`);
      for (const line of found) console.error(`  ${line}`);
      process.exit(1);
    }
    const a = audit();
    console.log(`route auth: ${a.routes.length} routes, ${a.writes.length} write, all declared`);
  } else {
    const a = audit();
    console.log(`${a.routes.length} routes (${a.writes.length} write). Needs is what the auth hook checks; the table is generated from the code.\n`);
    console.log(table(a));
  }
}
