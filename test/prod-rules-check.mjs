// Ask Firebase's own rules engine whether it allows the moves a guest makes.
// The emulator can disagree with the real service (it has its own count of
// the 1,000-expression limit), so run this before publishing a rules change:
//   node test/prod-rules-check.mjs firestore.rules 4     (last number: players, 2 to 6)
// It needs the Firebase CLI to be logged in. It sends the rules text and
// made-up game states to the rules-test service; nothing is read from or
// written to the database. The last case is meant to be REFUSED: it is what a
// phone still running an older page would send.
import fs from "node:fs"; import os from "node:os";
import * as G from "../game.js";
const token = JSON.parse(fs.readFileSync(os.homedir() + "/.config/configstore/firebase-tools.json", "utf8")).tokens.access_token;
const rules = fs.readFileSync(process.argv[2] || "firestore.rules", "utf8");
const names = ["Ann", "Bob", "Cy", "Dee", "Eve", "Fay"].slice(0, Number(process.argv[3] || 4));
let s = G.newGame("host"); s.created = "c";
names.forEach((n, i) => { s = G.join(s, i ? "g" + i : "host", { name: n }, 1700000000000 + i); });
s = G.startRound(s, "host", { topic: "Things a dog thinks about all day.", index: 2 }, 1700000001000);
G.seats(s).forEach(id => { s = G.submit(s, id, { text: "answer of " + id }, 1700000002000, () => 0.5); });
const cases = [];
function add(name, uid, before, after, provider) {
  cases.push({ name, tc: { expectation: "ALLOW", request: { auth: { uid, token: { firebase: { sign_in_provider: provider || "anonymous" } } },
    path: "/databases/(default)/documents/games/ABC234", method: "update", resource: { data: after } }, resource: { data: before } } });
}
let t = G.pass(s, "host", null, 1700000003000);                       // g1's turn
add("host passes own turn", "host", s, t, "google.com");
if (names.length > 2) add("guest g1: wrong guess", "g1", t, G.guess(t, "g1", { answer: "host", target: "g2" }, 1700000004000));
const right = G.guess(t, "g1", { answer: "host", target: "host" }, 1700000004000);
add("guest g1: right guess", "g1", t, right);
add("guest g1: passes own turn", "g1", t, G.pass(t, "g1", null, 1700000004000));
add("guest g1: votes for a new host", "g1", t, G.voteHost(t, "g1", null, 1700000004000));
// two players: the guest's right guess ends the round (and, at target 5 with 2 points already, the game)
if (names.length === 2) {
  add("2 players, guest g1: right guess ends the round (+3)", "g1", t, right);
  const near = JSON.parse(JSON.stringify(t)); near.players.g1.s = 2; near.target = 5;
  add("2 players, guest g1: right guess wins the game", "g1", near, G.guess(near, "g1", { answer: "host", target: "host" }, 1700000004000));
  add("2 players, guest g1: bluff with own answer", "g1", t, G.guess(t, "g1", { answer: "g1", target: "host" }, 1700000004000));
}
// what a phone still running the previous page would write at the end of a round
const stale = JSON.parse(JSON.stringify(right)); stale.reader = ""; stale.deadline = 1700000064000;
add("a phone still running the PREVIOUS version of the page: right guess that ends a round", "g1", t, stale);
const body = { source: { files: [{ name: "firestore.rules", content: rules }] }, testSuite: { testCases: cases.map(c => c.tc) } };
const r = await fetch("https://firebaserules.googleapis.com/v1/projects/who-said-it-8eeaa:test", { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify(body) });
const j = await r.json();
if (!j.testResults) { console.log(r.status, JSON.stringify(j).slice(0, 600)); process.exit(1); }
if (j.issues) console.log("issues:", JSON.stringify(j.issues).slice(0, 300));
j.testResults.forEach((x, i) => console.log((x.state === "SUCCESS" ? "allowed " : "REFUSED ") + cases[i].name + (x.debugMessages ? "  -> " + x.debugMessages.join(" | ").slice(0, 220) : "") + (x.errorPosition ? " @line " + x.errorPosition.line : "")));
