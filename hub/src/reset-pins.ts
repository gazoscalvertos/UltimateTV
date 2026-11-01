// Clears every profile PIN, for when it's forgotten. Run on the Hub:
//   docker compose exec hub node hub/dist/reset-pins.js

import path from "node:path";
import { Db } from "./db.js";
import { clearPinLockouts, ProfileStore } from "./profiles.js";

const db = new Db(path.join(process.env.DATA_DIR ?? "/data", "hub.db"));
const store = new ProfileStore(db);
const cleared = store.list().filter((p) => p.hasPin);
for (const p of cleared) store.update(p.id, { pin: null });
db.setKv("profile-tokens", {});
// The lockouts were there to stop a forgotten PIN being guessed; both are gone now.
clearPinLockouts(db);
console.log(cleared.length ? `Cleared the PIN on ${cleared.map((p) => p.name).join(", ")}.` : "No profile has a PIN.");
