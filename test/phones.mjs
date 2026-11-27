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
    beforeParse(w) { w.WSI_DEPS = { backend: h.be, game, topics }; }
  });
  return { w: dom.window, d: dom.window.document, h };
}
const el = (p, id) => p.d.getElementById(id);
const text = (p, id) => el(p, id).textContent;
const submit = (p, id) => el(p, id).dispatchEvent(new p.w.Event("submit", { cancelable: true }));
function vis(p, id) { for (let e = el(p, id); e; e = e.parentElement) if (e.hidden) return false; return true; }
const uid = p => p.h.auth.currentUser.uid;
const scores = p => [...p.d.querySelectorAll("#scores2 li")].map(li =>
  li.querySelector(".pname").textContent.replace(/ \(.*/, "") + "=" + li.querySelector(".pscore").textContent).join(", ");
const answers = p => [...p.d.querySelectorAll("#answerList button")];
const own = b => (b.querySelector(".text") || b).textContent;
const texts = (p, sel) => [...p.d.querySelectorAll(sel)].map(e => e.textContent);
const click = (p, id) => el(p, id).click();
async function yes(p) { await until(() => vis(p, "askYes")); click(p, "askYes"); }
// tap an answer, tap a name in the panel, then "That's my guess"
async function guess(p, answerText, who) {
  const a = () => answers(p).find(b => own(b) === answerText);
  if (!await until(() => a() && !a().disabled && text(p, "turnHead").startsWith("Your turn"))) throw new Error("cannot tap answer " + answerText);
  a().click();
  const w = () => [...p.d.querySelectorAll("#pickNames button")].find(b => b.textContent === who);
  if (!await until(() => vis(p, "pickStep") && w())) throw new Error("cannot tap name " + who);
  w().click();
  if (!await until(() => vis(p, "confirmBtn") && !el(p, "confirmBtn").disabled)) throw new Error("cannot confirm");
  click(p, "confirmBtn");
}
async function join(p, name) {
  await until(() => vis(p, "name"));
  el(p, "nameInput").value = name; submit(p, "nameForm");
}
async function answer(p, value) {
  await until(() => vis(p, "answerForm"));
  el(p, "answerInput").value = value; submit(p, "answerForm");
}
async function all(phones, fn, ms) {
  const ok = await until(() => phones.every(fn), ms);
  if (!ok) check("timed out waiting for: " + fn, false, phones.map(p => text(p, "barLabel") + "/" + text(p, "turnHead") + "/" + text(p, "waiting") + "/" + text(p, "toast")).join(" ; "));
  return ok;
}
const mom = p => text(p, "momentHead") + text(p, "momentBody") + text(p, "momentMore");
// the words stay in place after the three seconds are up, so a slow run still sees them
const moment = (p, re) => until(() => re.test(mom(p)));

try {
  // ================= the page, end to end =================
  const A = phone("", "alice");
  await until(() => vis(A, "signInBtn"));
  check("signed out, home offers joining with a code and signing in; hosting is not offered yet",
    vis(A, "home") && text(A, "joinBtn") === "Join the game" && text(A, "joinHead") === "Got a code?" && text(A, "signInBtn") === "Sign in with Google" && !vis(A, "startBtn"), text(A, "hostHead"));

  el(A, "codeInput").value = "zzzzzz"; submit(A, "joinForm");
  await until(() => /find game/.test(text(A, "homeMsg")));
  check("an unknown code is refused with a message", text(A, "homeMsg") === "Can't find game ZZZZZZ. Check the code with your host.", text(A, "homeMsg"));

  click(A, "signInBtn");
  await until(() => vis(A, "startBtn"));
  check("signing in does not start a game; home then says host or join",
    vis(A, "home") && text(A, "whoami") === "Signed in as Alice Example." && text(A, "hostHead") === "Host a game" && text(A, "joinHead") === "Join a game" && !vis(A, "signInBtn") && vis(A, "signOutBtn") && el(A, "homeCards").className === "signedIn",
    text(A, "whoami") + " / " + text(A, "hostHead") + " / " + text(A, "joinHead"));
  click(A, "startBtn");
  await until(() => vis(A, "name"));
  const code = text(A, "barLabel").replace("Game ", "");
  check("'Host a game' gives a six-character code", /^[A-Z2-9]{6}$/.test(code) && !A.h.auth.currentUser.isAnonymous && A.w.location.hash === "#" + code, code);
  check("the name is asked before anything else, with no menu yet", vis(A, "name") && !vis(A, "lobby") && !vis(A, "menuBtn"));
  check("a Google user's first name is offered", el(A, "nameInput").value === "Alice", el(A, "nameInput").value);
  await join(A, "Ann");
  await until(() => vis(A, "lobby"));
  check("the host's lobby shows the code and cannot start alone", vis(A, "lobbyHost") && text(A, "bigCode") === code && el(A, "startGameBtn").disabled && text(A, "startGameBtn") === "Waiting for one more player", text(A, "startGameBtn"));

  const B = phone("#" + code);
  await join(B, "Bob");
  await until(() => vis(B, "lobby"));
  check("a guest joins from the invite link with no account", B.h.auth.currentUser.isAnonymous && !vis(B, "hostSetup") && text(B, "youreIn") === "You're in, Bob." && text(B, "lobbyWait") === "Waiting for Ann to start.", text(B, "youreIn"));
  check("the guest's lobby teaches the game in four lines", vis(B, "lobbyTeach") && B.d.querySelectorAll("#lobbyTeach li").length === 4 && !vis(A, "lobbyTeach"));

  const C = phone("", "carol");
  await until(() => vis(C, "signInBtn"));
  click(C, "signInBtn");
  await until(() => /Signed in as Carol/.test(text(C, "whoami")));
  check("a signed-in player can join a game instead of hosting one", !C.h.auth.currentUser.isAnonymous && vis(C, "startBtn") && vis(C, "joinForm"), text(C, "whoami"));
  el(C, "codeInput").value = code.toLowerCase(); submit(C, "joinForm");
  await join(C, "bob");
  await until(() => text(C, "nameMsg") !== "");
  check("a name already taken is refused", text(C, "nameMsg") === "Someone is already Bob. Pick another name.", text(C, "nameMsg"));
  click(C, "sillyBtn");
  check("'Give me a silly one' fills in a name", /^\w+ \w+$/.test(el(C, "nameInput").value), el(C, "nameInput").value);
  await join(C, "Cy");
  const D = phone("#" + code);
  await join(D, "Dee <b>x</b>");
  await all([A, B, C, D], p => p.d.querySelectorAll("#lobbyList li").length === 4);
  check("every phone sees the four names in join order",
    texts(D, "#lobbyList .pname").join("|") === "Ann (host)|Bob|Cy|Dee <b>x</b> (you)", texts(D, "#lobbyList .pname").join("|"));
  check("a name with markup is shown as text", D.d.querySelectorAll("#lobbyList b").length === 0);

  el(A, "targetSelect").value = "5"; el(A, "targetSelect").dispatchEvent(new A.w.Event("change"));
  await until(() => el(B, "targetSelect").value === "5");
  click(A, "startGameBtn");
  await all([A, B, C, D], p => vis(p, "write"));
  const topic1 = text(A, "topicW");
  check("round 1 shows the same original topic on every phone",
    topics.PACKS.general.topics.includes(topic1) && [B, C, D].every(p => text(p, "topicW") === topic1) && text(B, "barLabel") === "Round 1", topic1);
  check("there is no clock while writing", !/\d:\d\d|seconds/.test(B.d.getElementById("write").textContent));

  // ----- writing -----
  await answer(B, "<i>the dog</i>");
  await until(() => vis(B, "answered") && /Waiting for Cy and Dee/.test(text(A, "waiting")));
  check("after sending, the answer is hidden until asked for", vis(B, "answered") && !vis(B, "myAnswer") && /Poker face/.test(text(B, "answered")));
  click(B, "peekBtn");
  check("'Show my answer' shows it", vis(B, "myAnswer") && text(B, "myAnswer") === "“<i>the dog</i>”", text(B, "myAnswer"));
  check("the waiting line names the others, not yourself", text(A, "waiting") === "Waiting for Cy and Dee <b>x</b>." && text(B, "waiting") === "Waiting for Ann, Cy and Dee <b>x</b>.", text(A, "waiting") + " / " + text(B, "waiting"));
  check("other phones do not show an answer before everyone has sent one",
    [A, C, D].every(p => !/the dog/.test(p.d.body.textContent)));
  await answer(C, "gravy"); await answer(D, "a sock");
  await wait(300);
  check("guessing does not start while one answer is missing", [A, B, C, D].every(p => vis(p, "write")));
  await answer(A, "naps");
  await all([A, B, C, D], p => vis(p, "guess") && answers(p).length === 4);
  check("when the last answer is in, every phone flashes that it is time to guess and who goes first",
    await moment(A, /Time to guess!Everyone's in\.You go first\. Read the answers out loud, then pick one\./) && await moment(B, /Time to guess!Everyone's in\.Ann goes first\./), mom(A) + " | " + mom(B));
  const order = answers(C).map(own);
  check("every answer is on show at once, in the same shuffled order on every phone",
    order.slice().sort().join("|") === "<i>the dog</i>|a sock|gravy|naps" && [A, B, D].every(p => answers(p).map(own).join("|") === order.join("|")), order.join("|"));
  check("an answer with markup is shown as text", C.d.querySelectorAll("#answerList i").length === 0);
  let refusal = "";

  // ----- guessing -----
  check("round 1 starts with the first player; the others see who is guessing and who is next",
    text(A, "turnHead") === "Your turn, Ann" && el(A, "turnBox").className === "mine" && text(B, "turnHead") === "Ann is guessing" && text(B, "turnLine") === "You're up next." && text(C, "turnLine") === "Up next: Bob",
    text(A, "turnHead") + " / " + text(B, "turnLine") + " / " + text(C, "turnLine"));
  check("no phone marks any unguessed answer, not even your own",
    [A, B, C, D].every(p => p.d.querySelectorAll("#answerList .tag").length === 0));
  answers(B)[0].click();
  check("tapping an answer out of turn only says whose turn it is", /Hang on, it's Ann's turn\./.test(text(B, "toast")) && !vis(B, "pickVeil"), text(B, "toast"));

  await until(() => answers(A).some(b => own(b) === "<i>the dog</i>"));
  answers(A).find(b => own(b) === "<i>the dog</i>").click();
  await until(() => vis(A, "pickStep"));
  check("the name panel offers only players still hiding, never yourself", texts(A, "#pickNames button").join("|") === "Bob|Cy|Dee <b>x</b>" && text(A, "pickAnswer") === "“<i>the dog</i>”", texts(A, "#pickNames button").join("|"));
  [...A.d.querySelectorAll("#pickNames button")][0].click();
  await until(() => vis(A, "confirmStep"));
  check("the guess is read back as a sentence before it counts", text(A, "confirmLine") === "Bob wrote “<i>the dog</i>”" && /Say it out loud/.test(el(A, "confirmStep").textContent) && scores(A) === "Ann=0, Bob=0, Cy=0, Dee <b>x</b>=0", text(A, "confirmLine") + " " + scores(A));
  click(A, "confirmBack");
  await until(() => vis(A, "pickStep"));
  click(A, "pickBack");
  check("backing out makes no guess", !vis(A, "pickVeil") && scores(B) === "Ann=0, Bob=0, Cy=0, Dee <b>x</b>=0");

  await guess(A, "<i>the dog</i>", "Bob");
  await Promise.all([moment(A, /Yes!/), moment(B, /Caught!/), moment(C, /Caught!/)]);
  check("a right guess is a moment worded for each viewer",
    /Yes!You caught Bob\. \+1\. Go again\./.test(mom(A)) && /Caught!Ann found your answer\./.test(mom(B)) && /Caught!Ann caught Bob\. “<i>the dog<\/i>”/.test(mom(C)),
    mom(A) + " | " + mom(B) + " | " + mom(C));
  check("round 1 explains itself once", /Right means you go again\./.test(mom(A)) && /Caught players watch until the next round\./.test(mom(C)));
  await all([A, B, C, D], p => /^Ann=1, /.test(scores(p)));
  check("a right guess scores a point on every phone", [A, B, C, D].every(p => /^Ann=1, Bob=0/.test(scores(p))), scores(D));
  check("the caught player is told so and listed as caught",
    vis(B, "stateBanner") && text(B, "stateBanner") === "You're caught. Watch who's next." && text(C, "caughtLine") === "Caught (1): Bob" && text(C, "hidingLine") === "Still hiding (3): Ann, Cy and Dee <b>x</b>", text(C, "caughtLine") + " / " + text(C, "hidingLine"));
  check("the matched answer names its writer and who caught them", answers(C).find(b => own(b) === "<i>the dog</i>").querySelector(".tag").textContent === "Bob, caught by Ann");
  check("a right guess keeps the turn", text(A, "turnHead") === "Your turn, Ann");

  await guess(A, "naps", "Dee <b>x</b>");   // Ann names Dee for Ann's own answer: a bluff
  await Promise.all([moment(A, /Nope\./), moment(D, /Safe!/), moment(B, /Nope!/)]);
  check("a bluff with your own answer goes through as a wrong guess, with a moment that says who is up",
    /Nope\.Dee <b>x<\/b> didn't write that\.Cy is up\. Wrong means the next person goes\./.test(mom(A)) && /Safe!Ann thought you wrote “naps”\./.test(mom(D)) && /Nope!Ann guessed Dee <b>x<\/b> for “naps”\./.test(mom(B)) && /You're up\./.test(mom(C)),
    mom(A) + " | " + mom(D) + " | " + mom(C));
  await all([A, B, C, D], p => p === C ? text(p, "turnHead") === "Your turn, Cy" : text(p, "turnHead") === "Cy is guessing");
  check("a wrong guess moves the turn on, past the caught player, and scores nothing", /^Ann=1, Bob=0/.test(scores(B)));
  check("the 'So far' list keeps both guesses, newest first",
    texts(B, "#logList li").join(" | ") === "Ann guessed Dee <b>x</b> for “naps”. Nope. | Ann caught Bob: “<i>the dog</i>”", texts(B, "#logList li").join(" | "));

  refusal = "";
  await B.h.be.act(code, st => game.guess(st, uid(B), { answer: uid(A), target: uid(A) }, Date.now())).catch(e => { refusal = e.message; });
  check("a guess out of turn is refused", /not your turn/.test(refusal), refusal);
  await denied("changing an answer once guessing has started", sdk.updateDoc(sdk.doc(B.h.db, "games", code), { ["answers." + uid(B)]: "changed" }));

  await guess(C, "naps", "Ann");
  await until(() => /Cy=1/.test(scores(C)));
  await guess(C, "a sock", "Dee <b>x</b>");
  await all([A, B, C, D], p => vis(p, "done"));
  check("the last guess of a round gets its moment as well", await moment(D, /Caught!Cy found your answer\./), mom(D));
  check("the last one hiding is the headline and scores 2 extra",
    text(C, "headline") === "Nobody caught you, Cy!" && text(B, "headline") === "Cy was never caught!" && text(B, "underHead") === "Last one hiding: +2" && scores(B) === "Cy=4, Ann=1, Bob=0, Dee <b>x</b>=0", text(B, "headline") + " " + scores(B));
  check("round over shows what each player gained and what the leader needs",
    texts(B, "#gainList li").join("|") === "Ann (host)+1|Cy+4" && text(B, "leaderLine") === "Cy needs 1 more to win.", texts(B, "#gainList li").join("|") + " " + text(B, "leaderLine"));
  check("round end names every writer", texts(B, "#revealList li").sort().join("|") === "“<i>the dog</i>”Bob|“a sock”Dee <b>x</b>|“gravy”Cy|“naps”Ann", texts(B, "#revealList li").join("|"));
  check("only the host lines up the next topic and starts the round", vis(A, "nextBtn") && text(A, "nextBtn") === "Start round 2" && !vis(B, "nextBtn") && text(B, "doneWait") === "Waiting for Ann to start round 2.");
  check("the next round waits for the host; a player who is waiting can vote for a new one", !/by itself/.test(el(B, "done").textContent) && vis(B, "voteDone") && text(B, "voteDone") === "Ann not here? Vote for a new host" && !vis(A, "voteDone"), text(B, "voteDone"));

  // ----- round 2: start without stragglers, pass, the safety nets -----
  const lined = text(A, "nextTopic");
  click(A, "swapBtn");
  check("the host can swap the next topic for a different one before anyone has written",
    text(A, "nextTopic") !== lined && topics.PACKS.general.topics.includes(text(A, "nextTopic")) && text(A, "nextTopic") !== topic1, lined + " -> " + text(A, "nextTopic"));
  const topic2 = text(A, "nextTopic");
  click(A, "nextBtn");
  await all([A, B, C, D], p => vis(p, "write") && text(p, "barLabel") === "Round 2");
  check("round 2 uses the topic the host lined up", text(B, "topicW") === topic2 && topic2 !== topic1, text(B, "topicW"));
  const E = phone("#" + code);
  await until(() => vis(E, "name"));
  check("someone arriving mid-round is told they play from the next one", vis(E, "midRound"));
  await join(E, "Eve");
  await until(() => vis(E, "sitOut"));
  check("a late joiner watches this round", vis(E, "sitOut") && !vis(E, "answerForm"));
  await answer(A, "ann two"); await answer(B, "bob two");
  await until(() => /Waiting for Cy and Dee/.test(text(A, "waiting")));
  check("nobody but the host can start without the others yet", !vis(B, "unstickW") && !vis(A, "unstickW"));
  click(A, "menuBtn");
  check("the host's menu offers to start without the missing players, by name", vis(A, "hGo") && text(A, "hGo") === "Start without Cy and Dee <b>x</b>" && !vis(B, "mHost"), text(A, "hGo"));
  click(A, "hGo");
  await until(() => vis(A, "askVeil"));
  check("it asks first and says what happens", text(A, "askText") === "Start without Cy and Dee <b>x</b>? They'll watch this round.", text(A, "askText"));
  await yes(A);
  await all([A, B, C, D, E], p => vis(p, "guess"));
  check("the flash says who goes first, and does not claim everyone is in", await moment(C, /Time to guess!Bob goes first\./) && !/Everyone/.test(mom(C)), mom(C));
  check("the first guesser rotates: round 2 starts with the second player; players who did not answer watch",
    text(B, "turnHead") === "Your turn, Bob" && answers(D).length === 2 && text(C, "stateBanner") === "You're watching this round.", text(B, "turnHead") + " " + text(C, "stateBanner"));

  click(B, "passBtn");
  await until(() => vis(B, "askVeil"));
  check("passing your own turn asks first", text(B, "askText") === "Pass your turn?" && text(B, "askYes") === "Pass");
  await yes(B);
  await Promise.all([moment(B, /You passed\./), moment(C, /Bob passed\./)]);
  await all([A, B, C], p => p === A ? text(A, "turnHead") === "Your turn, Ann" : text(p, "turnHead") === "Ann is guessing");
  check("a pass moves the turn on and scores nothing", /Ann is up\./.test(mom(C)) && /^Cy=4, Ann=1/.test(scores(C)), mom(C));
  check("other players cannot skip someone yet", !vis(C, "unstickG") && !vis(E, "unstickG"));
  game.RULES.STALL_MS = 200;
  await until(() => vis(C, "unstickG"));
  check("after two quiet minutes every other player gets a skip button", vis(C, "unstickG") && text(C, "unstickG") === "Skip Ann's turn" && !vis(A, "unstickG"), text(C, "unstickG"));
  click(C, "unstickG");
  await moment(B, /Cy moved things along\./);
  game.RULES.STALL_MS = 120000;
  await all([B, C], p => p === B ? text(B, "turnHead") === "Your turn, Bob" : text(p, "turnHead") === "Bob is guessing");
  check("the skip is credited to whoever pressed it, not blamed on a clock", /Cy moved things along\./.test(mom(B)) && !/time/i.test(mom(B)), mom(B));

  await guess(B, "ann two", "Ann");
  check("round 2 ends", await all([A, B, C, D, E], p => vis(p, "done")));
  check("scores carry on across rounds", scores(E) === "Cy=4, Bob=3, Ann=1, Dee <b>x</b>=0, Eve=0", scores(E));
  await wait(1200);
  check("nothing starts by itself", [A, B, C, D, E].every(p => vis(p, "done")));
  await until(() => !el(A, "nextBtn").disabled);
  click(A, "nextBtn");
  await all([A, B, C, D, E], p => vis(p, "write") && text(p, "barLabel") === "Round 3");

  // ----- round 3: change the topic, the write safety net, taking someone out, winning -----
  await answer(B, "early");
  await until(() => vis(B, "answered"));
  click(A, "menuBtn"); click(A, "hTopic");
  el(A, "tOwnInput").value = "Things <u>only</u> we would say"; submit(A, "tOwnForm");
  await all([A, B, C, D, E], p => text(p, "topicW") === "Things <u>only</u> we would say");
  check("the host can change the topic; it is shown as text", E.d.querySelectorAll("#topicW u").length === 0);
  check("a changed topic clears sent answers and tells everyone", vis(B, "answerForm") && text(B, "newTopic") === "New topic! Ann swapped it. Write a new answer." && text(C, "newTopic") === "New topic! Ann swapped it.", text(B, "newTopic"));
  await answer(A, "a3"); await answer(B, "b3"); await answer(C, "c3"); await answer(D, "d3");
  await until(() => text(B, "waiting") === "Waiting for Eve.");
  game.RULES.STALL_MS = 200;
  await until(() => vis(B, "unstickW"));
  check("after two quiet minutes any player can start without the missing one", text(B, "unstickW") === "Start without Eve", text(B, "unstickW"));
  click(B, "unstickW");
  await yes(B);
  await all([A, B, C, D, E], p => vis(p, "guess") && answers(p).length === 4);
  game.RULES.STALL_MS = 120000;
  check("round 3 starts with the third player", text(C, "turnHead") === "Your turn, Cy", text(A, "turnHead"));
  await guess(C, "b3", "Bob");
  await all([A, C], p => /^Cy=5/.test(scores(p)));
  check("reaching the target mid-round does not stop the round", vis(A, "guess") && /^Cy=5/.test(scores(A)), scores(A));
  click(A, "menuBtn"); click(A, "hRemove");
  check("'Take someone out' lists everyone but the host", texts(A, "#removeList button").join("|") === "Bob|Cy|Dee <b>x</b>|Eve" && B.d.querySelectorAll("#removeList button").length === 4 && !vis(B, "mHost"), texts(A, "#removeList button").join("|"));
  [...A.d.querySelectorAll("#removeList button")][2].click();
  await until(() => vis(A, "askVeil"));
  check("taking someone out asks first and names the cost", text(A, "askText") === "Take Dee <b>x</b> out of the game? Their points go too." && text(A, "askYes") === "Take them out", text(A, "askText"));
  await yes(A);
  await all([A, B, C, E], p => !/Dee/.test(scores(p)));
  check("everyone is told, and the answer stays as a decoy", await moment(B, /Dee <b>x<\/b> left the game\.Their answer stays as a decoy\./) && answers(C).length === 4, mom(B));
  await until(() => vis(D, "removed"));
  check("the removed phone is told what happened and can hop back in", vis(D, "removed") && !vis(D, "name") && text(D, "removedLine") === "Ann took you out. If that was a mistake, hop back in.", text(D, "removedLine"));
  await guess(C, "a3", "Ann");
  await all([A, B, C, E], p => vis(p, "over"));
  check("the winner is the first thing on the screen, worded for the winner too",
    text(B, "winnerLine") === "Cy wins!" && text(C, "winnerLine") === "You win, Cy!" && text(B, "overLine") === "First to 5." && /^Cy=8, Bob=3, Ann=1/.test(scores(B)) && text(B, "barLabel") === "Game over",
    text(B, "winnerLine") + " " + scores(B));
  check("the removed player's answer is shown as nobody's", texts(B, "#revealList li").some(x => x === "“d3”someone who left"), texts(B, "#revealList li").join("|"));
  await until(() => /won 1 of 1/.test(text(C, "myStats")) && /won 0 of 1/.test(text(A, "myStats")));
  check("Google players get saved wins; guests are not asked", /won 1 of 1/.test(text(C, "myStats")) && /won 0 of 1/.test(text(A, "myStats")) && !vis(B, "myStats"), text(C, "myStats") + " / " + text(A, "myStats"));
  await wait(400);
  const carolStats = (await sdk.getDoc(sdk.doc(C.h.db, "users", uid(C)))).data();
  check("a finished game is counted once", carolStats.w === 1 && carolStats.g === 1, JSON.stringify(carolStats));
  click(D, "rejoinBtn");
  check("'Rejoin' takes the removed phone back to the name screen", vis(D, "name") && !vis(D, "removed"));
  check("only the host can play again", vis(A, "againBtn") && !vis(B, "againBtn") && text(B, "againWait") === "Waiting for Ann to start a new game.");
  click(A, "againBtn");
  await all([A, B, C, E], p => vis(p, "lobby"));
  check("play again returns everyone to the lobby with the same names", B.d.querySelectorAll("#lobbyList li").length === 4);

  click(E, "menuBtn"); click(E, "mLeave");
  await until(() => vis(E, "askVeil"));
  check("leaving asks first", text(E, "askText") === "Leave the game? You can come back with the same code on this phone.");
  click(E, "askNo");
  check("'Stay' stays", vis(E, "lobby"));

  // ----- the players vote for a new host -----
  click(B, "menuBtn");
  check("players, not the host, are offered the vote", vis(B, "mVote") && text(B, "mVote") === "Vote for a new host" && !vis(A, "mVote"));
  click(B, "mVote");
  await until(() => vis(B, "askVeil"));
  check("the vote says what it does and who would take over", text(B, "askText") === "Vote for a new host? It takes 3 votes. Ann would be taken out of the game and you would become host." && text(B, "askYes") === "Vote", text(B, "askText"));
  await yes(B);
  await all([A, B, C], p => /1 of 3/.test(p === A ? text(A, "voteLine") : text(p, "mVote")));
  check("everyone can see the count, and a voter can take the vote back",
    text(A, "voteLine") === "1 of 3 votes for a new host." && text(B, "mVote") === "Take back my vote for a new host (1 of 3)" && text(C, "voteLobby") === "Ann not here? Vote for a new host (1 of 3)", text(C, "voteLobby"));
  click(C, "voteLobby"); await yes(C);
  await until(() => /2 of 3/.test(text(E, "mVote")));
  check("two votes are not enough", vis(A, "hostSetup") && !vis(B, "hostSetup"));
  click(E, "menuBtn"); click(E, "mVote"); await yes(E);
  await all([B, C, E], p => p === B ? vis(B, "hostSetup") : text(p, "lobbyWait") === "Waiting for Bob to start.");
  check("the third vote makes the longest-waiting player the host", vis(B, "hostSetup") && vis(B, "startGameBtn") && texts(C, "#lobbyList .pname").join("|") === "Bob (host)|Cy (you)|Eve", texts(C, "#lobbyList .pname").join("|"));
  check("everyone is told", await moment(C, /Bob is the host now\.The players voted\. Ann is out of the game\./) && await moment(B, /You're the host now\./), mom(C) + " | " + mom(B));
  await until(() => vis(A, "removed"));
  check("the old host is out and told why", vis(A, "removed") && text(A, "removedLine") === "The players voted for a new host. If that was a mistake, hop back in.", text(A, "removedLine"));
  check("the vote starts again from nothing", text(C, "mVote") === "Vote for a new host");

  // ----- a second game on the same code, ended early by the new host -----
  click(B, "startGameBtn");
  await all([B, C, E], p => vis(p, "write") && text(p, "barLabel") === "Round 1");
  await answer(B, "b"); await answer(C, "c"); await answer(E, "e");
  await all([B, C, E], p => vis(p, "guess"));
  click(B, "menuBtn"); click(B, "hEnd");
  await until(() => vis(B, "askVeil"));
  check("ending the game asks first", text(B, "askText") === "End the game now? Whoever is ahead wins." && text(B, "askYes") === "End it", text(B, "askText"));
  await yes(B);
  await all([B, C, E], p => vis(p, "over"));
  check("a game ended before anyone scored has no winner", text(C, "winnerLine") === "Game over" && text(C, "overLine") === "Bob called it. Here's how it finished.", text(C, "winnerLine") + " / " + text(C, "overLine"));
  await until(() => /won 1 of 2/.test(text(C, "myStats")));
  await wait(600);
  const second = (await sdk.getDoc(sdk.doc(C.h.db, "users", uid(C)))).data();
  check("a second finished game on the same code is counted too, once, and not as a win", second.w === 1 && second.g === 2 && text(C, "myStats") === "You've won 1 of 2 games.", JSON.stringify(second) + " " + text(C, "myStats"));
  click(B, "againBtn");
  await all([B, C, E], p => vis(p, "lobby"));

  // a reload keeps the seat
  const B2 = new JSDOM(html, { runScripts: "dangerously", url: "https://host.example/#" + code,
    beforeParse(w) { w.WSI_DEPS = { backend: B.h.be, game, topics }; } });
  await until(() => !B2.window.document.getElementById("lobby").hidden && !B2.window.document.getElementById("play").hidden);
  check("reopening the link on the same phone keeps the seat", B2.window.document.getElementById("name").hidden);

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
  await denied("a player making themselves host without the votes", sdk.updateDoc(gameRef(anon), { host: anonUid }));
  await denied("casting someone else's vote", sdk.updateDoc(gameRef(anon), { votes: [uid(C)] }));
  await denied("a 21-entry vote list", sdk.updateDoc(gameRef(anon), { votes: Array.from({ length: 21 }, (_, i) => "v" + i) }));
  await denied("a player changing the creation time", sdk.updateDoc(gameRef(anon), { created: sdk.serverTimestamp() }));
  await denied("a player deleting the game", sdk.deleteDoc(gameRef(anon)));
  await denied("a player adding an unknown field", sdk.updateDoc(gameRef(anon), { extra: 1 }));
  await denied("a player dropping a field", sdk.updateDoc(gameRef(anon), { topic: sdk.deleteField() }));
  await denied("a target that is not offered", sdk.updateDoc(gameRef(anon), { target: 7 }));
  await denied("an unknown phase", sdk.updateDoc(gameRef(anon), { phase: "bogus" }));
  await denied("an answer outside the write step", sdk.updateDoc(gameRef(anon), { ["answers." + anonUid]: "late" }));
  await denied("a 121-character topic", sdk.updateDoc(gameRef(anon), { topic: "x".repeat(121) }));
  await denied("an empty character name", sdk.updateDoc(gameRef(anon), { ["players." + anonUid + ".n"]: "" }));
  await denied("a negative score", sdk.updateDoc(gameRef(anon), { ["players." + anonUid + ".s"]: -1 }));
  await denied("a player adding seats for other people", sdk.updateDoc(gameRef(anon), { "players.fake1": seat, "players.fake2": seat }));
  await denied("more misses than the game allows", sdk.updateDoc(gameRef(anon), { misses: 4 }));
  await denied("a player changing another player's score", sdk.updateDoc(gameRef(anon), { ["players." + uid(B) + ".s"]: 3 }));
  await denied("a player removing another player", sdk.updateDoc(gameRef(anon), { ["players." + uid(B)]: sdk.deleteField() }));
  await denied("a player giving up their own seat entry", sdk.updateDoc(gameRef(anon), { ["players." + anonUid]: sdk.deleteField() }));
  await denied("a player giving themselves a point when it is not their turn", sdk.updateDoc(gameRef(anon), { ["players." + anonUid + ".s"]: 1 }));
  await denied("a player changing the target score", sdk.updateDoc(gameRef(anon), { target: 20 }));
  await denied("a player changing the topic pack", sdk.updateDoc(gameRef(anon), { pack: "christmas" }));
  await denied("a turn held by someone not in the round", sdk.updateDoc(gameRef(anon), { turn: anonUid }));
  await denied("a round list naming someone who is not a player", sdk.updateDoc(gameRef(anon), { inRound: ["ghost"] }));
  await denied("an event with an extra field", sdk.updateDoc(gameRef(anon), { last: { kind: "guess", by: "a", answer: "b", target: "c", ok: true, html: "<b>" } }));
  await denied("an event with a number for a name", sdk.updateDoc(gameRef(anon), { last: { kind: "guess", by: 1, answer: "b", target: "c", ok: true } }));
  await denied("an event of an unknown kind", sdk.updateDoc(gameRef(anon), { last: { kind: "boom", by: "a", answer: "b", target: "c", ok: true } }));
  await denied("a text for the last-activity time", sdk.updateDoc(gameRef(anon), { since: "now" }));
  await denied("a 41-entry guess list", sdk.updateDoc(gameRef(anon), { log: Array.from({ length: 41 }, () => 1) }));
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
  // the size limits on their own: the writer is allowed to make the change, only the size is wrong
  await denied("an 81-character answer in the write step", sdk.updateDoc(g2(anon), { ["answers." + anonUid]: "x".repeat(81) }));
  await allowed("an 80-character answer in the write step", sdk.updateDoc(g2(anon), { ["answers." + anonUid]: "x".repeat(80) }));
  await denied("a 21st player, even added by the host", sdk.updateDoc(g2(A.h), Object.fromEntries(Array.from({ length: 18 }, (_, i) => ["players.fake" + i, seat]))));
  await allowed("a 20th player added by the host", sdk.updateDoc(g2(A.h), Object.fromEntries(Array.from({ length: 17 }, (_, i) => ["players.fake" + i, seat]))));
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
  await denied("a win without a game", sdk.setDoc(stat(mal, malUid), { w: 2, g: 1 }));
  await denied("a game uncounted", sdk.setDoc(stat(mal, malUid), { w: 1, g: 0 }));
  const zed = backend("zed"); await zed.be.signInGoogle();
  await denied("a first record with more wins than games", sdk.setDoc(stat(zed, zed.auth.currentUser.uid), { w: 2, g: 1 }));
  await allowed("a first record of a game that was not won", sdk.setDoc(stat(zed, zed.auth.currentUser.uid), { w: 0, g: 1 }));
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
