// Forgets every paired phone and screen and the Home Assistant key, for when the TV's pairing is
// lost (the box reinstalled, say) and no paired phone is left to let it back in. The next screen to
// open the TV app is trusted again. Run on the Hub:
//   docker compose exec hub node hub/dist/reset-pairing.js

import path from "node:path";
import { Db } from "./db.js";
import { Pairing } from "./pairing.js";

const db = new Db(path.join(process.env.DATA_DIR ?? "/data", "hub.db"));
const pairing = new Pairing(db);
const count = pairing.devices().length;
pairing.reset();
console.log(`Forgot ${count} paired device${count === 1 ? "" : "s"}. Restart the Hub, then open the TV app first: it pairs itself.`);
