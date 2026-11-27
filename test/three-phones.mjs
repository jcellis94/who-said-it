// Three simulated phones running the real page (jsdom) with the real Firebase SDK
// and backend.js, against the Auth and Firestore emulators with firestore.rules loaded.
// Run: npm install && npm test      (exit code 0 and "all passed" means every check held)
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as appSdk from "firebase/app";
import * as authSdk from "firebase/auth";
import * as storeSdk from "firebase/firestore";
import { makeBackend } from "../backend.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, "..", "index.html"), "utf8");
const sdk = Object.assign({}, appSdk, authSdk, storeSdk);
const config = { apiKey: "demo-key", projectId: "demo-who-said-it", authDomain: "demo.example" };

let failed = 0;
function check(label, ok, detail) {
  if (!ok) failed++;
  console.log((ok ? "pass" : "FAIL") + "  " + label + (detail === undefined ? "" : "  [" + detail + "]"));
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (fn()) return true; } catch (e) {} await wait(25); }
  return false;
}
async function denied(label, promise) {
  try { await promise; check("rules refuse: " + label, false, "it was allowed"); }
  catch (e) { check("rules refuse: " + label, e.code === "permission-denied", e.code); }
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
      JSON.stringify({ sub: googleSub, email: googleSub + "@example.com", email_verified: true, name: "Host " + googleSub })))
  });
  return h;
}
function phone(hash, h) {
  const dom = new JSDOM(html, {
    runScripts: "dangerously", url: "https://host.example/things/" + (hash || ""),
    beforeParse(w) { if (h) w.THINGS_BACKEND = h.be; }
  });
  return { w: dom.window, d: dom.window.document, h };
}
const submit = (p, id) => p.d.getElementById(id).dispatchEvent(new p.w.Event("submit", { cancelable: true }));
const el = (p, id) => p.d.getElementById(id);
const txt = (p, sel) => [...p.d.querySelectorAll(sel)].map(b => b.textContent + (b.getAttribute("aria-pressed") === "true" ? "*" : ""));
const scores = p => [...p.d.querySelectorAll("#playerList li")].map(li =>
  li.querySelector(".pname").textContent + "=" + li.querySelector(".pscore").textContent + (li.className === "lead" ? "(lead)" : "")).join(", ");
const score = (p, i) => p.d.querySelectorAll("#playerList .pscore")[i].textContent;

try {
  // ---------- the page, end to end ----------
  const A = phone("", backend("alice"));
  await until(() => !el(A, "startBtn").disabled);
  check("lobby shows first", !el(A, "lobby").hidden && el(A, "game").hidden);
  check("start button asks for Google sign-in", /Google/.test(el(A, "startBtn").textContent), el(A, "startBtn").textContent);

  el(A, "codeInput").value = "zzzzzz"; submit(A, "joinForm");
  await until(() => /No game/.test(el(A, "lobbyMsg").textContent));
  check("unknown code is refused with a message", /No game has the code ZZZZZZ/.test(el(A, "lobbyMsg").textContent), el(A, "lobbyMsg").textContent);
  check("looking up a code signed this phone in as a guest", !!A.h.auth.currentUser && A.h.auth.currentUser.isAnonymous);

  el(A, "startBtn").click();
  await until(() => !el(A, "game").hidden && el(A, "status").textContent === "Live");
  const code = el(A, "codeLabel").textContent;
  check("host signs in with Google and gets a code", /^[A-Z2-9]{6}$/.test(code) && A.w.location.hash === "#" + code && el(A, "status").textContent === "Live", code + " " + el(A, "status").textContent + " " + el(A, "lobbyMsg").textContent);
  check("host is a Google user", !!A.h.auth.currentUser && !A.h.auth.currentUser.isAnonymous);

  const B = phone("#" + code, backend("unused"));
  await until(() => !el(B, "game").hidden && el(B, "status").textContent === "Live");
  check("guest joins from the invite link with no account", !el(B, "game").hidden && el(B, "codeLabel").textContent === code && B.h.auth.currentUser.isAnonymous);

  for (const n of ["Chris", "Kristy", "Olivia"]) { el(A, "nameInput").value = n; submit(A, "addForm"); await wait(5); }
  el(A, "nextBtn").click(); el(A, "nextBtn").click();
  el(A, "answerInput").value = "Gravy <i>boat</i>"; submit(A, "answerForm"); await wait(5);
  el(A, "answerInput").value = "The dog"; submit(A, "answerForm");
  await until(() => txt(B, "#answerList button").length === 2 && txt(B, "#rosterList button").length === 3);
  check("guest sees the host's round", el(B, "roundNum").textContent === "3", el(B, "roundNum").textContent);
  check("guest sees the answers", txt(B, "#answerList button").join(" | ") === "Gravy <i>boat</i> | The dog" && el(B, "answerCount").textContent === "(2 left)", txt(B, "#answerList button").join(" | "));
  check("guest sees the players in seat order", txt(B, "#rosterList button").join(", ") === "Chris, Kristy, Olivia", txt(B, "#rosterList button").join(", "));

  B.d.querySelectorAll("#answerList button")[1].click();
  B.d.querySelectorAll("#rosterList button")[2].click();
  B.d.querySelectorAll("#playerList li")[0].querySelectorAll("button.plus")[1].click();
  B.d.querySelectorAll("#playerList li")[1].querySelectorAll("button.plus")[0].click();
  await until(() => scores(A) === "Chris=2(lead), Kristy=1, Olivia=0" && txt(A, "#rosterList button")[2] === "Olivia*" && txt(A, "#answerList button")[1] === "The dog*");
  check("host sees the guest's guessed mark", txt(A, "#answerList button").join(" | ") === "Gravy <i>boat</i> | The dog*" && el(A, "answerCount").textContent === "(1 left)", txt(A, "#answerList button").join(" | "));
  check("host sees the guest's out mark", txt(A, "#rosterList button").join(", ") === "Chris, Kristy, Olivia*" && el(A, "rosterCount").textContent === "(2 still in)", txt(A, "#rosterList button").join(", "));
  check("host sees the guest's scoring", scores(A) === "Chris=2(lead), Kristy=1, Olivia=0", scores(A));

  for (let i = 0; i < 5; i++) { A.d.querySelectorAll("#playerList li")[2].querySelectorAll("button.plus")[0].click(); await wait(4); }
  B.d.querySelectorAll("#playerList li")[2].querySelectorAll("button.plus")[0].click();
  await until(() => score(A, 2) === "6" && score(B, 2) === "6");
  check("five rapid +1 taps on one phone plus one on another make 6 everywhere", score(A, 2) === "6" && score(B, 2) === "6", score(A, 2) + "/" + score(B, 2));

  for (let i = 0; i < 3; i++) { el(A, "nextBtn").click(); await wait(4); }
  el(A, "answerInput").value = "late answer"; submit(A, "answerForm");
  await until(() => el(B, "roundNum").textContent === "6" && txt(B, "#answerList button").join() === "late answer");
  await wait(300);
  check("three rapid Next taps then an answer end on round 6 everywhere, answer in round 6",
    el(A, "roundNum").textContent === "6" && el(B, "roundNum").textContent === "6" && txt(B, "#answerList button").join() === "late answer" && txt(A, "#answerList button").join() === "late answer",
    el(A, "roundNum").textContent + "/" + el(B, "roundNum").textContent + " " + txt(B, "#answerList button").join());

  for (let i = 0; i < 3; i++) { el(A, "prevBtn").click(); await wait(4); }
  await until(() => el(B, "roundNum").textContent === "3" && txt(B, "#answerList button").length === 2);
  check("going back shows that round's answers and out marks again", txt(B, "#answerList button").join(" | ") === "Gravy <i>boat</i> | The dog*" && txt(B, "#rosterList button")[2] === "Olivia*", el(B, "roundNum").textContent + " " + txt(B, "#answerList button").join(" | "));
  el(A, "nextBtn").click();
  await until(() => el(B, "roundNum").textContent === "4" && txt(B, "#rosterList button").join(", ") === "Chris, Kristy, Olivia");
  check("the next round has nobody out and no answers", txt(B, "#rosterList button").join(", ") === "Chris, Kristy, Olivia" && B.d.querySelectorAll("#answerList button").length === 0, txt(B, "#rosterList button").join(", "));

  el(A, "prevBtn").click();
  await until(() => txt(B, "#answerList button").length === 2);
  const clear = el(B, "clearAnswersBtn"); clear.click(); clear.click();
  await until(() => A.d.querySelectorAll("#answerList button").length === 0 && el(A, "roundNum").textContent === "3");
  check("clearing a round's answers reaches the other phone", A.d.querySelectorAll("#answerList button").length === 0);

  el(A, "editBtn").click(); A.d.querySelectorAll("#playerList li")[1].querySelector("button.remove").click();
  await until(() => B.d.querySelectorAll("#playerList li").length === 2);
  const zero = el(B, "zeroBtn"); zero.click(); zero.click();
  await until(() => scores(A) === "Chris=0, Olivia=0");
  check("remove-player and zero-scores propagate", scores(A) === "Chris=0, Olivia=0", scores(A));

  const C = phone("", backend("unused2"));
  await until(() => !el(C, "joinBtn").disabled);
  el(C, "codeInput").value = code.toLowerCase(); submit(C, "joinForm");
  await until(() => !el(C, "game").hidden && C.d.querySelectorAll("#playerList li").length === 2);
  check("late joiner typing the code in lowercase gets current state", !el(C, "game").hidden && el(C, "roundNum").textContent === "3" && C.d.querySelectorAll("#playerList li").length === 2, el(C, "roundNum").textContent);
  el(C, "leaveBtn").click();
  check("leaving returns to the lobby", !el(C, "lobby").hidden && el(C, "game").hidden);
  check("no HTML from user text was injected", A.d.querySelectorAll("#answerList i, #playerList i").length + B.d.querySelectorAll("#answerList i, #playerList i").length === 0);

  const U = phone("");
  await wait(20);
  check("a page with no Firebase config shows the setup panel", !el(U, "setup").hidden && el(U, "lobby").hidden);

  // ---------- the rules, attacked directly ----------
  const guest = B.h, host = A.h, db = guest.db;
  const anon = backend("nobody");                       // never signs in
  const pid = "0aaaaaaaaAAAAAA", aid = "0bbbbbbbbBBBBBB";
  const hostUid = host.auth.currentUser.uid, guestUid = guest.auth.currentUser.uid;
  await denied("reading a room while signed out", sdk.getDoc(sdk.doc(anon.db, "rooms", code)));
  await denied("listing all rooms", sdk.getDocs(sdk.collection(db, "rooms")));
  await denied("a guest creating a room", sdk.setDoc(sdk.doc(db, "rooms", "GUEST2"), { host: guestUid, created: sdk.serverTimestamp(), round: 1 }));
  await denied("a host creating a room in someone else's name", sdk.setDoc(sdk.doc(host.db, "rooms", "HHHH22"), { host: "someone-else", created: sdk.serverTimestamp(), round: 1 }));
  await denied("a host creating a room with a bad code", sdk.setDoc(sdk.doc(host.db, "rooms", "lowercase1"), { host: hostUid, created: sdk.serverTimestamp(), round: 1 }));
  await denied("a host creating a room with an extra field", sdk.setDoc(sdk.doc(host.db, "rooms", "HHHH33"), { host: hostUid, created: sdk.serverTimestamp(), round: 1, extra: "x" }));
  await denied("changing a room's host", sdk.updateDoc(sdk.doc(db, "rooms", code), { host: guestUid }));
  await denied("setting the round to 0", sdk.updateDoc(sdk.doc(db, "rooms", code), { round: 0 }));
  await denied("setting the round to text", sdk.updateDoc(sdk.doc(db, "rooms", code), { round: "3" }));
  await denied("deleting a room", sdk.deleteDoc(sdk.doc(db, "rooms", code)));
  await denied("a 25-character player name", sdk.setDoc(sdk.doc(db, "rooms", code, "players", pid), { n: "x".repeat(25), s: 0, o: 0 }));
  await denied("a player created with points", sdk.setDoc(sdk.doc(db, "rooms", code, "players", pid), { n: "Cheat", s: 50, o: 0 }));
  await denied("a player with a bad id", sdk.setDoc(sdk.doc(db, "rooms", code, "players", "bad id"), { n: "X", s: 0, o: 0 }));
  await denied("a player in a room that does not exist", sdk.setDoc(sdk.doc(db, "rooms", "NQNQNQ", "players", pid), { n: "X", s: 0, o: 0 }));
  await sdk.setDoc(sdk.doc(db, "rooms", code, "players", pid), { n: "Probe", s: 0, o: 0 });
  await denied("a 50-point jump", sdk.updateDoc(sdk.doc(db, "rooms", code, "players", pid), { s: 50 }));
  await denied("a negative score", sdk.updateDoc(sdk.doc(db, "rooms", code, "players", pid), { s: -1 }));
  await denied("renaming a player", sdk.updateDoc(sdk.doc(db, "rooms", code, "players", pid), { n: "Other" }));
  await denied("an extra field on a player", sdk.updateDoc(sdk.doc(db, "rooms", code, "players", pid), { junk: "x" }));
  await denied("reading players while signed out", sdk.getDocs(sdk.collection(anon.db, "rooms", code, "players")));
  await sdk.deleteDoc(sdk.doc(db, "rooms", code, "players", pid));
  await denied("an 81-character answer", sdk.setDoc(sdk.doc(db, "rooms", code, "answers", aid), { r: 1, t: "x".repeat(81), g: false }));
  await denied("an answer created already guessed", sdk.setDoc(sdk.doc(db, "rooms", code, "answers", aid), { r: 1, t: "x", g: true }));
  await sdk.setDoc(sdk.doc(db, "rooms", code, "answers", aid), { r: 1, t: "probe", g: false });
  await denied("rewriting an answer's text", sdk.updateDoc(sdk.doc(db, "rooms", code, "answers", aid), { t: "changed" }));
  await denied("moving an answer to another round", sdk.updateDoc(sdk.doc(db, "rooms", code, "answers", aid), { r: 2 }));
  await sdk.deleteDoc(sdk.doc(db, "rooms", code, "answers", aid));
  await denied("writing to a collection the app does not use", sdk.setDoc(sdk.doc(db, "other", "x"), { a: 1 }));
} catch (e) {
  failed++;
  console.log("FAIL  the test run threw:", e);
}
console.log(failed ? failed + " check(s) FAILED" : "all passed");
process.exit(failed ? 1 : 0);
