// Nothing in the TV app may start reactive work at module scope (it left the TV black once).
//
// On 2 November the box and the Fedora download both showed a black screen while the Hub was healthy
// and the bundle served 200. The cause was ui/src/radio.ts creating a `createRoot` at module scope
// that read `nowPlaying()` from player.ts. player.ts reaches radio.ts through an import cycle
// (player → kidstime → sleep → music → radio → player), so the effect ran while player.ts was still
// being evaluated, `nowPlaying` was still `undefined`, the throw happened before the first render,
// and the screen stayed empty. No type check or unit test noticed, because every module is fine to
// import — it only breaks in the built bundle.
//
// The rest of the app already did it the safe way: `startQueue()` and `startFavourites()` are called
// from the app shell's onMount. This test keeps it that way.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = fileURLToPath(new URL("../src/", import.meta.url));

/** Every module file in ui/src, at any depth. */
function modules(dir = src, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) modules(full, found);
    else if (/\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

/**
 * Reactive work that must never run at module scope.
 *
 * Read off the start of a line with no indentation, which is where a module-level statement begins:
 * inside a function the same call is indented. `createSignal` is deliberately absent — a signal at
 * module scope is how every store in the app holds its state, and it touches nothing else.
 */
const FORBIDDEN = ["createRoot(", "createEffect(", "createMemo(", "createRenderEffect("];

describe("the TV app's modules", () => {
  it("do not start reactive work when they are imported", () => {
    const offenders: string[] = [];
    for (const file of modules()) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const hit = FORBIDDEN.find((call) => line.startsWith(call));
          if (hit) offenders.push(`${path.relative(src, file)}:${i + 1}: ${hit}…)`);
        });
    }
    expect(offenders, "start these from the app shell's onMount instead — see startQueue()").toEqual([]);
  });

  it("are the files we think they are, so the scan above cannot pass by finding nothing", () => {
    const files = modules();
    expect(files.length).toBeGreaterThan(30);
    expect(files.map((f) => path.relative(src, f))).toContain("radio.ts");
  });

  it("keep their start functions in the app shell rather than at the bottom of a module", () => {
    // The exact shape of the bug: a start function that nobody calls would be just as black.
    const shell = readFileSync(path.join(src, "App.tsx"), "utf8");
    for (const start of ["startQueue()", "startFavourites()", "startPodcastPlaces()"]) {
      expect(shell, `${start} is not called from App.tsx`).toContain(`${start};`);
    }
  });
});
