// Five simulated phones run the real page (jsdom) with the real Firebase SDK,
// backend.js, game.js and topics.js against the Auth and Firestore emulators
// with firestore.rules loaded. Then the rules are attacked directly.
// Run: npm install && npm test     ("all passed" and exit code 0 mean every check held)
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as appSdk from "firebase/app";
import * as authSdk from "firebase/auth";
import * as storeSdk from "firebase/firestore";
import { makeBackend } from "../backend.js";
import * as game from "../game.js";
import * as topics from "../topics.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, "..", "index.html"), "utf8");
const sdk = Object.assign({}, appSdk, authSdk, storeSdk);
const config = { apiKey: "demo-key", projectId: "demo-who-said-it", authDomain: "demo.example" };

let failed = 0;
function check(label, ok, detail) {
  if (!ok) failed++;
  console.log((ok ? "pass" : "FAIL") + "  " + label + (!ok && detail !== undefined ? "  [" + detail + "]" : ""));
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (fn()) return true; } catch (e) {} await wait(25); }
  return false;
}
async function denied(label, promise) {
  try { await promise; check("rules refuse: " + label, false, "it was allowed"); }
  catch (e) { check("rules refuse: " + label, e.code === "permission-denied", e.code || e.message); }
}
async function allowed(label, promise) {
  try { await promise; check("rules allow: " + label, true); }
  catch (e) { check("rules allow: " + label, false, e.code || e.message); }
}

let apps = 0;
function backend(googleSub) {
  const h = {};
  h.be = makeBackend(sdk, config, {
    appName: "app" + (++apps),
    setup(app, auth, db) {
      h.auth = auth; h.db = db;
      sdk.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
      sdk.connectFirestoreEmulator(db, "127.0.0.1", 8080);
    },
    googleSignIn: auth => sdk.signInWithCredential(auth, sdk.GoogleAuthProvider.credential(
      JSON.stringify({ sub: googleSub, email: googleSub + "@example.com", email_verified: true, name: googleSub[0].toUpperCase() + googleSub.slice(1) + " Example" })))
  });
  return h;
}
function phone(hash, googleSub) {
  const h = backend(googleSub || "unused" + apps);
  const dom = new JSDOM(html, {
    runScripts: "dangerously", url: "https://host.example/" + (hash || ""),
    beforeParse(w) { w.WSI_DEPS = { backend: h.be, game, topics }; w.confirm = () => true; }
  });
  return { w: dom.window, d: dom.window.document, h };
}
const el = (p, id) => p.d.getElementById(id);
const text = (p, id) => el(p, id).textContent;
const submit = (p, id) => el(p, id).dispatchEvent(new p.w.Event("submit", { cancelable: true }));
function vis(p, id) { for (let e = el(p, id); e; e = e.parentElement) if (e.hidden) return false; return true; }
const uid = p => p.h.auth.currentUser.uid;
const scores = p => [...p.d.querySelectorAll("#scores li")].map(li =>
  li.querySelector(".pname").textContent.replace(/ \(.*/, "") + "=" + li.querySelector(".pscore").textContent).join(", ");
const answers = p => [...p.d.querySelectorAll("#answerList button")];
const people = p => [...p.d.querySelectorAll("#whoList button")];
const own = b => [...b.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join("");
async function guess(p, answerText, who) {
  const a = () => answers(p).find(b => own(b) === answerText);
  const w = () => people(p).find(b => b.textContent.replace(/ \(you\)$/, "") === who);
  if (!await until(() => a() && !a().disabled)) throw new Error("cannot tap answer " + answerText);
  a().click();
  if (!await until(() => w() && !w().disabled)) throw new Error("cannot tap character " + who);
  w().click();
}
async function join(p, name) {
  await until(() => vis(p, "character"));
  el(p, "nameInput").value = name; submit(p, "nameForm");
}
async function answer(p, value) {
  await until(() => vis(p, "answerForm"));
  el(p, "answerInput").value = value; submit(p, "answerForm");
}
async function all(phones, fn, ms) {
  const ok = await until(() => phones.every(fn), ms);
  if (!ok) check("timed out waiting for: " + fn, false, phones.map(p => text(p, "roundLine") + "/" + text(p, "turnLine") + "/" + text(p, "waiting") + "/" + text(p, "toast")).join(" ; "));
  return ok;
}

try {
  // ================= the page, end to end =================
  const A = phone("", "alice");
  await until(() => !el(A, "startBtn").disabled);
  check("home shows first, start asks for Google", vis(A, "home") && /Google/.test(text(A, "startBtn")), text(A, "startBtn"));

  el(A, "codeInput").value = "zzzzzz"; submit(A, "joinForm");
  await until(() => /No game/.test(text(A, "homeMsg")));
  check("an unknown code is refused with a message", /No game has the code ZZZZZZ/.test(text(A, "homeMsg")), text(A, "homeMsg"));

  el(A, "startBtn").click();
  await until(() => vis(A, "character"));
  const code = text(A, "codeLabel");
  check("host signs in with Google and gets a six-character code", /^[A-Z2-9]{6}$/.test(code) && !A.h.auth.currentUser.isAnonymous && A.w.location.hash === "#" + code, code);
  check("character name is asked before anything else", vis(A, "character") && !vis(A, "lobby"));
  check("a Google user's first name is offered as the character", el(A, "nameInput").value === "Alice", el(A, "nameInput").value);
  await join(A, "Ann");
  await until(() => vis(A, "lobby"));
  check("host reaches the lobby and cannot start alone", vis(A, "hostSetup") && el(A, "startGameBtn").disabled, text(A, "startGameBtn"));

  const B = phone("#" + code);
  await join(B, "Bob");
  await until(() => vis(B, "lobby"));
  check("a guest joins from the invite link with no account", B.h.auth.currentUser.isAnonymous && vis(B, "lobbyWait") && !vis(B, "hostSetup"));

  const C = phone("", "carol");
  await until(() => vis(C, "signInBtn"));
  el(C, "signInBtn").click();
  await until(() => /Signed in as Carol/.test(text(C, "whoami")));
  check("a guest can sign in with Google first; it is optional", !C.h.auth.currentUser.isAnonymous, text(C, "whoami"));
  el(C, "codeInput").value = code.toLowerCase(); submit(C, "joinForm");
  await join(C, "bob");
  await until(() => text(C, "nameMsg") !== "");
  check("a character name already taken is refused", /already Bob/.test(text(C, "nameMsg")), text(C, "nameMsg"));
  await join(C, "Cy");
  const D = phone("#" + code);
  await join(D, "Dee <b>x</b>");
  await all([A, B, C, D], p => p.d.querySelectorAll("#lobbyList li").length === 4);
  check("every phone sees the four characters in join order",
    [...D.d.querySelectorAll("#lobbyList .pname")].map(e => e.textContent).join("|") === "Ann (host)|Bob|Cy|Dee <b>x</b> (you)",
    [...D.d.querySelectorAll("#lobbyList .pname")].map(e => e.textContent).join("|"));
  check("a name with markup is shown as text", D.d.querySelectorAll("#lobbyList b").length === 0);

  el(A, "targetSelect").value = "5"; el(A, "targetSelect").dispatchEvent(new A.w.Event("change"));
  await until(() => el(B, "targetSelect").value === "5");
  el(A, "startGameBtn").click();
  await all([A, B, C, D], p => vis(p, "write"));
  const topic1 = text(A, "topic");
  check("round 1 shows the same original topic on every phone",
    topics.PACKS.general.topics.includes(topic1) && [B, C, D].every(p => text(p, "topic") === topic1), topic1);
  check("the write clock is running", /^1:[23]\d$/.test(text(B, "clock")), text(B, "clock"));

  // ----- writing -----
  await answer(B, "<i>the dog</i>");
  await until(() => vis(B, "answered") && /Waiting on Ann, Cy, Dee/.test(text(A, "waiting")));
  check("after sending, a player sees their own answer and who is still writing",
    /<i>the dog<\/i>/.test(text(B, "myAnswer")) && /Waiting on Ann, Cy, Dee <b>x<\/b>\./.test(text(A, "waiting")), text(A, "waiting"));
  check("other phones do not show an answer before everyone has sent one",
    [A, C, D].every(p => !/the dog/.test(p.d.body.textContent)));
  await answer(C, "gravy"); await answer(D, "a sock");
  await wait(300);
  check("guessing does not start while one answer is missing", [A, B, C, D].every(p => vis(p, "write")));
  await answer(A, "naps");
  await all([A, B, C, D], p => vis(p, "guess") && answers(p).length === 4);

  // ----- guessing -----
  const order = p => answers(p).map(own).join("|");
  check("answers appear on every phone in the same shuffled order",
    [B, C, D].every(p => order(p) === order(A)) && order(A).split("|").sort().join("|") === "<i>the dog</i>|a sock|gravy|naps", order(A));
  check("an answer with markup is shown as text", A.d.querySelectorAll("#answerList i").length === 0);
  check("no phone shows who wrote an unguessed answer",
    [A, B, C, D].every(p => p.d.querySelectorAll("#answerList .tag").length === 1 && p.d.querySelector("#answerList .tag").textContent === "yours"));
  check("round 1 starts with the first player's turn", text(A, "turnLine") === "Your turn" && text(B, "turnLine") === "Ann's turn", text(B, "turnLine"));
  await until(() => answers(A).filter(b => !b.disabled).length === 3);
  check("only the player whose turn it is can tap answers", answers(B).every(b => b.disabled) && answers(A).filter(b => !b.disabled).length === 3);

  await guess(A, "<i>the dog</i>", "Bob");
  await all([A, B, C, D], p => /Right!/.test(text(p, "lastLine")));
  check("a right guess scores a point on every phone", [A, B, C, D].every(p => /^Ann=1, /.test(scores(p))), scores(D));
  check("the guessed character is grayed out everywhere",
    [A, C, D].every(p => people(p).find(b => b.textContent === "Bob").className === "out" && p.d.querySelector("#scores li.out .pname").textContent === "Bob"));
  check("the matched answer is marked with its writer", answers(C).find(b => own(b) === "<i>the dog</i>").querySelector(".tag").textContent === "Bob");
  check("a right guess keeps the turn", text(A, "turnLine") === "Your turn");

  await guess(A, "gravy", "Dee <b>x</b>");
  await all([A, B, C, D], p => /Wrong\./.test(text(p, "lastLine")));
  check("a wrong guess passes the turn, skipping the player who is out", text(C, "turnLine") === "Your turn" && text(A, "turnLine") === "Cy's turn", text(A, "turnLine"));
  check("the wrong guess is announced and scores nothing", /Ann guessed Dee <b>x<\/b> for “gravy”\. Wrong\./.test(text(B, "lastLine")) && /^Ann=1, Bob=0/.test(scores(B)), text(B, "lastLine"));

  // a phone that is not on turn cannot move, even calling the game directly
  let refusal = "";
  await B.h.be.act(code, st => game.guess(st, uid(B), { answer: uid(A), target: uid(A) }, Date.now())).catch(e => { refusal = e.message; });
  check("a guess out of turn is refused", /not your turn/.test(refusal), refusal);
  await denied("changing an answer once guessing has started", sdk.updateDoc(sdk.doc(B.h.db, "games", code), { ["answers." + uid(B)]: "changed" }));

  await guess(C, "naps", "Ann");
  await until(() => /^Cy=1, Ann=1/.test(scores(C)) || /Cy=1/.test(scores(C)));
  await guess(C, "a sock", "Dee <b>x</b>");
  await all([A, B, C, D], p => vis(p, "done"));
  check("the last unguessed player scores 2 extra", /^Cy=4, Ann=1, Bob=0, Dee <b>x<\/b>=0$/.test(scores(B)), scores(B));
  check("round end names every writer", [...B.d.querySelectorAll("#revealList li")].map(li => own(li) + ">" + li.querySelector(".tag").textContent).sort().join("|") ===
    "<i>the dog</i>>Bob|a sock>Dee <b>x</b>|gravy>Cy|naps>Ann", [...B.d.querySelectorAll("#revealList li")].map(li => li.textContent).join("|"));
  check("only the host sees the next-round button", vis(A, "nextBtn") && !vis(B, "nextBtn"));

  // ----- round 2: the timers -----
  game.RULES.WRITE_MS = 1500; game.RULES.TURN_MS = 2000; game.RULES.NEXT_MS = 1500;
  el(A, "nextBtn").click();
  await all([A, B, C, D], p => vis(p, "write") && text(p, "roundLine") === "Round 2");
  check("round 2 has a new topic", text(B, "topic") !== topic1 && text(B, "topic") !== "", text(B, "topic"));
  const E = phone("#" + code);
  await join(E, "Eve");
  await until(() => vis(E, "sitOut"));
  check("a late joiner watches this round", vis(E, "sitOut") && !vis(E, "answerForm"));
  await answer(A, "ann two"); await answer(B, "bob two");
  await all([A, B, C, D, E], p => vis(p, "guess"), 8000);
  game.RULES.WRITE_MS = 90000; game.RULES.TURN_MS = 45000;
  check("when the write clock runs out, guessing starts without the players who did not answer",
    people(A).map(b => b.textContent).join("|") === "Ann (you)|Bob" && answers(D).length === 2, people(A).map(b => b.textContent).join("|"));
  check("the first guesser rotates: round 2 starts with Bob", text(A, "turnLine") === "Bob's turn", text(A, "turnLine"));
  await all([A, B, C], p => /Bob ran out of time/.test(text(p, "lastLine")), 8000);
  check("when the turn clock runs out, the turn passes", text(A, "turnLine") === "Your turn" && /Bob ran out of time/.test(text(C, "lastLine")), text(A, "turnLine"));
  await guess(A, "bob two", "Bob");
  check("round 2 ends", await all([A, B, C, D, E], p => vis(p, "done")));
  check("scores carry on across rounds", /^Cy=4, Ann=4, Bob=0/.test(scores(E)) || /^Ann=4, Cy=4, Bob=0/.test(scores(E)), scores(E));
  await all([A, B, C, D, E], p => vis(p, "write") && text(p, "roundLine") === "Round 3", 8000);
  game.RULES.NEXT_MS = 20000;
  check("the next round starts by itself after the pause", text(E, "roundLine") === "Round 3" && vis(E, "answerForm"));

  // ----- round 3: host controls, winning, saved wins -----
  el(A, "ownTopicInput").value = "Things <u>only</u> we would say"; submit(A, "ownTopicForm");
  await all([A, B, C, D, E], p => text(p, "topic") === "Things <u>only</u> we would say");
  check("the host can type a topic; it is shown as text", E.d.querySelectorAll("#topic u").length === 0);
  await answer(A, "a3"); await answer(B, "b3"); await answer(C, "c3"); await answer(D, "d3"); await answer(E, "e3");
  await all([A, B, C, D, E], p => vis(p, "guess") && answers(p).length === 5);
  check("round 3 starts with the third player", text(C, "turnLine") === "Your turn", text(A, "turnLine") + " " + people(A).map(b => b.textContent).join("|") + " " + text(A, "roundLine"));
  await guess(C, "b3", "Bob");
  await all([A, C], p => /Right!/.test(text(p, "lastLine")) && /^Cy=5/.test(scores(p)));
  check("reaching the target mid-round does not stop the round", vis(A, "guess") && /^Cy=5/.test(scores(A)), scores(A));
  [...A.d.querySelectorAll("#scores li")].find(li => /^Dee/.test(li.textContent)).querySelector("button.kick").click();
  await all([A, B, C, E], p => !/Dee/.test(scores(p)));
  check("the host can remove a player mid-round; the others cannot", !/Dee/.test(scores(B)) && B.d.querySelectorAll("#scores button.kick").length === 0 && answers(C).length === 5);
  await until(() => vis(D, "character"));
  check("the removed phone is back at the character screen", vis(D, "character"));
  await guess(C, "a3", "Ann");
  await until(() => /^Cy=6/.test(scores(C)));
  await guess(C, "e3", "Eve");
  await all([A, B, C, E], p => vis(p, "over"));
  check("the clear leader at the target wins at the end of the round", text(B, "winnerLine") === "Cy wins!" && /^Cy=9, Ann=4/.test(scores(B)), text(B, "winnerLine") + " " + scores(B));
  check("the removed player's answer stayed as a decoy", [...B.d.querySelectorAll("#revealList li")].some(li => own(li) === "d3" && /someone who left/.test(li.textContent)));
  await until(() => /won 1 of 1/.test(text(C, "myStats")) && /won 0 of 1/.test(text(A, "myStats")));
  check("Google players get saved wins; guests are not asked", /won 1 of 1/.test(text(C, "myStats")) && /won 0 of 1/.test(text(A, "myStats")) && !vis(B, "myStats"), text(C, "myStats") + " / " + text(A, "myStats"));
  await wait(400);
  const carolStats = (await sdk.getDoc(sdk.doc(C.h.db, "users", uid(C)))).data();
  check("a finished game is counted once", carolStats.w === 1 && carolStats.g === 1, JSON.stringify(carolStats));
  check("only the host can play again", vis(A, "againBtn") && !vis(B, "againBtn"));
  el(A, "againBtn").click();
  await all([A, B, C, E], p => vis(p, "lobby"));
  check("play again returns everyone to the lobby with the same characters", B.d.querySelectorAll("#lobbyList li").length === 4);

  // a reload keeps the seat
  const B2 = new JSDOM(html, { runScripts: "dangerously", url: "https://host.example/#" + code,
    beforeParse(w) { w.WSI_DEPS = { backend: B.h.be, game, topics }; } });
  await until(() => !B2.window.document.getElementById("lobby").hidden && !B2.window.document.getElementById("play").hidden);
  check("reopening the link on the same phone keeps the seat", B2.window.document.getElementById("character").hidden);

  // ================= the rules, attacked directly =================
  const gameRef = h => sdk.doc(h.db, "games", code);
  const fresh = (hostUid, extra) => Object.assign(game.newGame(hostUid), { created: sdk.serverTimestamp() }, extra || {});
  const seat = { n: "Mallory", s: 0, j: 5 };

  const nobody = backend("nobody");
  await denied("reading a game while signed out", sdk.getDoc(gameRef(nobody)));

  const anon = backend("x"); await anon.be.signInGuest();
  const anonUid = anon.auth.currentUser.uid;
  await allowed("a guest with the code reading the game", sdk.getDoc(gameRef(anon)));
  await denied("listing games", sdk.getDocs(sdk.collection(anon.db, "games")));
  await denied("a guest creating a game", sdk.setDoc(sdk.doc(anon.db, "games", "GUEST2"), fresh(anonUid)));
  await denied("an outsider changing scores", sdk.updateDoc(gameRef(anon), { ["players." + uid(A) + ".s"]: 50 }));
  await denied("an outsider changing the phase", sdk.updateDoc(gameRef(anon), { phase: "over" }));
  await denied("an outsider removing a player", sdk.updateDoc(gameRef(anon), { ["players." + uid(B)]: sdk.deleteField() }));
  await denied("taking a seat with points", sdk.updateDoc(gameRef(anon), { ["players." + anonUid]: { n: "M", s: 5, j: 5 } }));
  await denied("taking a seat under someone else's id", sdk.updateDoc(gameRef(anon), { "players.someoneelse": seat }));
  await denied("taking two seats", sdk.updateDoc(gameRef(anon), { ["players." + anonUid]: seat, "players.other": seat }));
  await denied("taking a seat with a 21-character name", sdk.updateDoc(gameRef(anon), { ["players." + anonUid]: { n: "x".repeat(21), s: 0, j: 5 } }));
  await denied("taking a seat with an extra field", sdk.updateDoc(gameRef(anon), { ["players." + anonUid]: { n: "M", s: 0, j: 5, admin: true } }));
  await denied("taking a seat and making yourself host", sdk.updateDoc(gameRef(anon), { ["players." + anonUid]: seat, host: anonUid }));
  await allowed("taking one's own seat", sdk.updateDoc(gameRef(anon), { ["players." + anonUid]: seat }));

  // now a player in the game
  await denied("a player changing the host", sdk.updateDoc(gameRef(anon), { host: anonUid }));
  await denied("a player changing the creation time", sdk.updateDoc(gameRef(anon), { created: sdk.serverTimestamp() }));
  await denied("a player deleting the game", sdk.deleteDoc(gameRef(anon)));
  await denied("a player adding an unknown field", sdk.updateDoc(gameRef(anon), { extra: 1 }));
  await denied("a player dropping a field", sdk.updateDoc(gameRef(anon), { topic: sdk.deleteField() }));
  await denied("a target that is not offered", sdk.updateDoc(gameRef(anon), { target: 7 }));
  await denied("an unknown phase", sdk.updateDoc(gameRef(anon), { phase: "bogus" }));
  await denied("an answer outside the write step, 81 characters long", sdk.updateDoc(gameRef(anon), { ["answers." + anonUid]: "x".repeat(81) }));
  await denied("a 121-character topic", sdk.updateDoc(gameRef(anon), { topic: "x".repeat(121) }));
  await denied("an empty character name", sdk.updateDoc(gameRef(anon), { ["players." + anonUid + ".n"]: "" }));
  await denied("a negative score", sdk.updateDoc(gameRef(anon), { ["players." + anonUid + ".s"]: -1 }));
  await denied("a 21st player", sdk.updateDoc(gameRef(anon), Object.fromEntries(Array.from({ length: 17 }, (_, i) => ["players.fake" + i, seat]))));
  await denied("more misses than the game allows", sdk.updateDoc(gameRef(anon), { misses: 4 }));
  await denied("a text deadline", sdk.updateDoc(gameRef(anon), { deadline: "soon" }));
  await denied("a player changing another player's score", sdk.updateDoc(gameRef(anon), { ["players." + uid(B) + ".s"]: 3 }));
  await denied("a player removing another player", sdk.updateDoc(gameRef(anon), { ["players." + uid(B)]: sdk.deleteField() }));
  await denied("a player giving up their own seat entry", sdk.updateDoc(gameRef(anon), { ["players." + anonUid]: sdk.deleteField() }));
  await denied("a player giving themselves a point when it is not their turn", sdk.updateDoc(gameRef(anon), { ["players." + anonUid + ".s"]: 1 }));
  await denied("a player changing the target score", sdk.updateDoc(gameRef(anon), { target: 20 }));
  await denied("a player changing the topic pack", sdk.updateDoc(gameRef(anon), { pack: "christmas" }));
  await denied("a turn held by someone not in the round", sdk.updateDoc(gameRef(anon), { turn: anonUid }));
  await denied("a round list naming someone who is not a player", sdk.updateDoc(gameRef(anon), { inRound: ["ghost"] }));
  await denied("a winner who is not a player", sdk.updateDoc(gameRef(anon), { winners: ["ghost"] }));
  await denied("a text among the used topic numbers", sdk.updateDoc(gameRef(anon), { used: ["x"] }));
  await denied("a last-guess banner with an extra field", sdk.updateDoc(gameRef(anon), { last: { by: "a", answer: "b", target: "c", ok: true, skip: false, html: "<b>" } }));
  await denied("a last-guess banner with a number for a name", sdk.updateDoc(gameRef(anon), { last: { by: 1, answer: "b", target: "c", ok: true, skip: false } }));
  await denied("a deadline years away", sdk.updateDoc(gameRef(anon), { deadline: Date.now() + 365 * 86400000 }));
  await allowed("a player renaming their own character", sdk.updateDoc(gameRef(anon), { ["players." + anonUid + ".n"]: "Mal" }));

  // points only on your own turn: a second game, in the guessing step
  const G2 = "TURN22", g2 = h => sdk.doc(h.db, "games", G2);
  await sdk.setDoc(g2(A.h), fresh(uid(A)));
  await sdk.updateDoc(g2(A.h), { ["players." + uid(A)]: { n: "Ann", s: 0, j: 1 } });
  await sdk.updateDoc(g2(B.h), { ["players." + uid(B)]: { n: "Bob", s: 0, j: 2 } });
  await sdk.updateDoc(g2(anon), { ["players." + anonUid]: { n: "Mal", s: 0, j: 3 } });
  let st = (await sdk.getDoc(g2(A.h))).data();
  st = game.startRound(st, uid(A), { topic: "T", index: 0 }, Date.now());
  await sdk.setDoc(g2(A.h), st);
  for (const id of [uid(A), uid(B), anonUid]) st = game.submit(st, id, { text: "t " + id }, Date.now());
  await sdk.setDoc(g2(A.h), st);
  check("the second game is in the guessing step with the host on turn", st.phase === "guess" && st.turn === uid(A));
  await denied("a point for a player whose turn it is not", sdk.updateDoc(g2(anon), { ["players." + anonUid + ".s"]: 1 }));
  await sdk.updateDoc(g2(A.h), { turn: anonUid });
  await denied("two points at once on your own turn", sdk.updateDoc(g2(anon), { ["players." + anonUid + ".s"]: 2 }));
  await denied("ten points at once on your own turn", sdk.updateDoc(g2(anon), { ["players." + anonUid + ".s"]: 10 }));
  await denied("writing someone else's answer", sdk.updateDoc(g2(anon), { ["answers." + uid(B)]: "swapped" }));
  await allowed("one point on your own turn", sdk.updateDoc(g2(anon), { ["players." + anonUid + ".s"]: 1 }));
  // The accepted limit, stated as a check so nobody mistakes it for protection:
  await allowed("KNOWN LIMIT, accepted by the owner: on their own turn a player who edits the code can take a point without a right guess",
    sdk.updateDoc(g2(anon), { ["players." + anonUid + ".s"]: 2 }));

  const mal = backend("mallory"); await mal.be.signInGoogle();
  const malUid = mal.auth.currentUser.uid;
  await denied("a Google user creating a game hosted by someone else", sdk.setDoc(sdk.doc(mal.db, "games", "MAL222"), fresh(uid(A))));
  await denied("creating a game already in play", sdk.setDoc(sdk.doc(mal.db, "games", "MAL222"), fresh(malUid, { phase: "guess" })));
  await denied("creating a game with players filled in", sdk.setDoc(sdk.doc(mal.db, "games", "MAL222"), fresh(malUid, { players: { [malUid]: { n: "M", s: 99, j: 1 } } })));
  await denied("creating a game with a made-up creation time", sdk.setDoc(sdk.doc(mal.db, "games", "MAL222"), fresh(malUid, { created: sdk.Timestamp.fromMillis(1) })));
  await denied("creating a game with a bad code", sdk.setDoc(sdk.doc(mal.db, "games", "mal-22"), fresh(malUid)));
  await denied("overwriting someone else's game by creating its code again", sdk.setDoc(gameRef(mal), fresh(malUid)));
  await allowed("a Google user creating an empty game", sdk.setDoc(sdk.doc(mal.db, "games", "MAL222"), fresh(malUid)));

  const stat = (h, id) => sdk.doc(h.db, "users", id);
  await denied("a guest saving wins", sdk.setDoc(stat(anon, anonUid), { w: 0, g: 1 }));
  await denied("reading someone else's wins", sdk.getDoc(stat(mal, uid(C))));
  await denied("writing someone else's wins", sdk.setDoc(stat(mal, uid(C)), { w: 9, g: 9 }));
  await denied("listing users", sdk.getDocs(sdk.collection(mal.db, "users")));
  await denied("starting with five games", sdk.setDoc(stat(mal, malUid), { w: 5, g: 5 }));
  await allowed("a first finished game", sdk.setDoc(stat(mal, malUid), { w: 1, g: 1 }));
  await denied("adding two wins at once", sdk.setDoc(stat(mal, malUid), { w: 3, g: 2 }));
  await denied("more wins than games", sdk.setDoc(stat(mal, malUid), { w: 2, g: 1 }));
  await denied("a win without a game", sdk.setDoc(stat(mal, malUid), { w: 2, g: 1 }));
  await denied("an extra field on wins", sdk.setDoc(stat(mal, malUid), { w: 1, g: 2, email: "x" }));
  await denied("deleting wins", sdk.deleteDoc(stat(mal, malUid)));

  // the prototype page's data still works for a phone that has the old page open
  await allowed("the old page: a Google host creating a room", sdk.setDoc(sdk.doc(mal.db, "rooms", "OLD222"), { host: malUid, created: sdk.serverTimestamp(), round: 1 }));
  await allowed("the old page: a guest adding a player", sdk.setDoc(sdk.doc(anon.db, "rooms", "OLD222", "players", "abcdefghiABCDEF"), { n: "Old", s: 0, o: 0 }));
  await denied("the old page: a guest creating a room", sdk.setDoc(sdk.doc(anon.db, "rooms", "OLD333"), { host: anonUid, created: sdk.serverTimestamp(), round: 1 }));
  await denied("writing to a collection the app does not use", sdk.setDoc(sdk.doc(anon.db, "other", "x"), { a: 1 }));
} catch (e) {
  failed++;
  console.log("FAIL  the test itself crashed: " + (e && e.stack || e));
}

console.log(failed ? failed + " FAILED" : "all passed");
process.exit(failed ? 1 : 0);
