// The rules of the game on their own: no Firebase, no page. Run by `npm test`.
import test from "node:test";
import assert from "node:assert/strict";
import * as G from "../game.js";

const noShuffle = () => 0.999999;
const STALL = G.RULES.STALL_MS, READ = G.RULES.READ_MS;
function table(names, options) {
  let s = G.newGame("h", options);
  names.forEach((n, i) => { s = G.join(s, i === 0 ? "h" : n.toLowerCase(), { name: n }, 100 + i); });
  return s;
}
function writing(names, options) {
  return G.startRound(table(names, options), "h", { topic: "Things a dog thinks about", index: 4 }, 1000);
}
function reading(names, options) {
  let s = writing(names, options);
  G.seats(s).forEach(id => { s = G.submit(s, id, { text: "answer of " + id }, 2000, noShuffle); });
  return s;
}
function readAll(s) {
  while (s.shown < s.shuffle.length) s = G.nextAnswer(s, s.reader, null, 2500);
  return G.beginGuess(s, s.reader, null, 3000);
}
const guessing = (names, options) => readAll(reading(names, options));
const says = (fn, re) => assert.throws(fn, e => e instanceof G.GameError && re.test(e.message));

test("joining: a name is required, unique, and seats follow join order", () => {
  const s = table(["Ann", "Bob", "Cy"]);
  assert.deepEqual(G.seats(s), ["h", "bob", "cy"]);
  says(() => G.join(s, "x", { name: "  " }, 1), /name first/);
  says(() => G.join(s, "x", { name: "bob" }, 1), /already Bob/);
  assert.equal(G.join(s, "bob", { name: "Robert" }, 999).players.bob.n, "Robert");
  assert.equal(G.join(s, "bob", { name: "Robert" }, 999).players.bob.j, 101);
});

test("joining: the game holds 20 players", () => {
  let s = G.newGame("h");
  for (let i = 0; i < 20; i++) s = G.join(s, "u" + i, { name: "P" + i }, i);
  says(() => G.join(s, "late", { name: "Late" }, 99), /full/);
});

test("setup: host only, lobby only, pack change forgets used topics", () => {
  let s = table(["Ann", "Bob"]);
  says(() => G.setup(s, "bob", { target: 5 }), /Only the host/);
  says(() => G.setup(s, "h", { target: 7 }), /listed targets/);
  s = G.setup(s, "h", { target: 15, pack: "christmas" });
  assert.equal(s.target, 15); assert.equal(s.pack, "christmas");
  says(() => G.setup(writing(["Ann", "Bob"]), "h", { target: 5 }), /before the game starts/);
});

test("starting: host only, two players, no clock on the round", () => {
  says(() => G.startRound(table(["Ann"]), "h", { topic: "T" }, 1), /At least 2/);
  says(() => G.startRound(table(["Ann", "Bob"]), "bob", { topic: "T" }, 1), /Only the host/);
  const s = writing(["Ann", "Bob", "Cy"]);
  assert.equal(s.phase, "write"); assert.equal(s.round, 1);
  assert.deepEqual(s.inRound, ["h", "bob", "cy"]);
  assert.deepEqual(s.used, [4]);
  assert.equal(s.deadline, 0); assert.equal(s.since, 1000);
  assert.deepEqual(s.base, { h: 0, bob: 0, cy: 0 });
});

test("writing: when everyone has answered, the answers go to the reader", () => {
  let s = writing(["Ann", "Bob", "Cy"]);
  s = G.submit(s, "h", { text: "  one   two " }, 2000);
  assert.equal(s.answers.h, "one two");
  s = G.submit(s, "bob", { text: "b" }, 2000);
  assert.equal(s.phase, "write");
  s = G.submit(s, "bob", { text: "b2" }, 2000);
  assert.equal(s.answers.bob, "b2", "an answer can be changed while writing");
  s = G.submit(s, "cy", { text: "c" }, 3000, noShuffle);
  assert.equal(s.phase, "read");
  assert.deepEqual(s.alive, ["h", "bob", "cy"]);
  assert.deepEqual(s.shuffle.slice().sort(), ["bob", "cy", "h"]);
  assert.equal(s.reader, "h"); assert.equal(s.shown, 1); assert.equal(s.turn, "");
  says(() => G.submit(s, "h", { text: "late" }, 1), /closed/);
});

test("writing: answers sent field by field are closed by allIn once nobody is missing", () => {
  let s = writing(["Ann", "Bob", "Cy"]);
  s.answers = { h: "a", bob: "b" };
  says(() => G.allIn(s, "cy", null, 5), /Still waiting/);
  s.answers.cy = "c"; s.answers.stray = "not in this round";
  says(() => G.allIn(s, "stranger", null, 5), /not in this game/);
  s = G.allIn(s, "bob", null, 5, noShuffle);
  assert.equal(s.phase, "read"); assert.deepEqual(s.alive, ["h", "bob", "cy"]);
  assert.equal(s.answers.stray, undefined);
  says(() => G.allIn(s, "bob", null, 6), /already being read/);
});

test("writing: a late joiner plays from the next round", () => {
  let s = writing(["Ann", "Bob"]);
  s = G.join(s, "dee", { name: "Dee" }, 1500);
  says(() => G.submit(s, "dee", { text: "x" }, 1600), /next round/);
  s = G.submit(G.submit(s, "h", { text: "a" }, 1), "bob", { text: "b" }, 1);
  assert.equal(s.phase, "read", "the late joiner does not hold up the round");
});

test("writing: the host starts without stragglers; anyone may after two quiet minutes", () => {
  let s = writing(["Ann", "Bob", "Cy"]);
  s = G.submit(G.submit(s, "h", { text: "a" }, 5000), "bob", { text: "b" }, 6000);
  assert.equal(s.since, 6000, "the quiet time counts from the last answer");
  says(() => G.closeWriting(s, "bob", null, 6000 + STALL - 1), /Only the host/);
  says(() => G.closeWriting(s, "stranger", null, 6000 + STALL), /Only the host/);
  const byPlayer = G.closeWriting(s, "bob", null, 6000 + STALL, noShuffle);
  assert.deepEqual(byPlayer.alive, ["h", "bob"], "the player who never answered watches");
  assert.equal(G.closeWriting(s, "h", null, 6001, noShuffle).phase, "read");
});

test("writing: fewer than two answers voids the round", () => {
  let s = G.submit(writing(["Ann", "Bob", "Cy"]), "bob", { text: "b" }, 1);
  s = G.closeWriting(s, "h", null, 5000);
  assert.equal(s.phase, "done"); assert.equal(s.note, "few");
  assert.equal(s.players.bob.s, 0);
  assert.equal(s.deadline, 5000 + G.RULES.NEXT_MS);
});

test("reading: the reader shows one answer at a time, then guesses first", () => {
  let s = reading(["Ann", "Bob", "Cy"]);
  says(() => G.nextAnswer(s, "bob", null, 2100), /Only the reader/);
  says(() => G.beginGuess(s, "h", null, 2100), /rest of the answers/);
  says(() => G.guess(s, "h", { answer: "bob", target: "bob" }, 2100), /Nobody is guessing/);
  s = G.nextAnswer(s, "h", null, 2100);
  s = G.nextAnswer(s, "h", null, 2200);
  assert.equal(s.shown, 3);
  says(() => G.nextAnswer(s, "h", null, 2300), /all of them/);
  s = G.beginGuess(s, "h", null, 2400);
  assert.equal(s.phase, "guess"); assert.equal(s.turn, "h"); assert.equal(s.reader, ""); assert.equal(s.deadline, 0);
});

test("reading: the reader can hand the reading on, and the new reader guesses first", () => {
  let s = reading(["Ann", "Bob", "Cy"]);
  says(() => G.passReader(s, "cy", null, 1), /Only the reader/);
  s = G.passReader(s, "h", null, 2100);
  assert.equal(s.reader, "bob"); assert.equal(s.shown, 1);
  assert.equal(readAll(s).turn, "bob");
});

test("reading: if the reader goes quiet, any phone shows the next answer, once", () => {
  let s = reading(["Ann", "Bob", "Cy"]);
  const seen = { auto: true, shown: 1 };
  says(() => G.nextAnswer(s, "cy", seen, s.since + READ - 1), /Only the reader/);
  says(() => G.nextAnswer(s, "stranger", seen, s.since + READ), /Only the reader/);
  const t = G.nextAnswer(s, "cy", seen, s.since + READ);
  assert.equal(t.shown, 2);
  says(() => G.nextAnswer(t, "bob", seen, t.since + READ), /Only the reader/, "a second phone acting on the same answer does nothing");
  let u = G.nextAnswer(t, "bob", { auto: true, shown: 2 }, t.since + READ);
  u = G.beginGuess(u, "cy", { auto: true, shown: 3 }, u.since + READ);
  assert.equal(u.phase, "guess"); assert.equal(u.turn, "h");
});

test("first reader rotates each round", () => {
  let s = guessing(["Ann", "Bob", "Cy"]);
  s = G.guess(G.guess(s, "h", { answer: "bob", target: "bob" }, 1), "h", { answer: "cy", target: "cy" }, 1);
  s = G.startRound(s, "h", { topic: "T2" }, 1);
  G.seats(s).forEach(id => { s = G.submit(s, id, { text: "x" + id }, 2, noShuffle); });
  assert.equal(s.reader, "bob");
});

test("guessing: right scores a point, catches the writer and keeps the turn", () => {
  let s = guessing(["Ann", "Bob", "Cy", "Dee"]);
  says(() => G.guess(s, "bob", { answer: "cy", target: "cy" }, 1), /not your turn/);
  says(() => G.guess(s, "h", { answer: "h", target: "bob" }, 1), /yours/);
  says(() => G.guess(s, "h", { answer: "bob", target: "h" }, 1), /someone else/);
  const seq = s.seq;
  s = G.guess(s, "h", { answer: "cy", target: "cy" }, 3000);
  assert.equal(s.players.h.s, 1);
  assert.deepEqual(s.alive, ["h", "bob", "dee"]);
  assert.equal(s.found.cy, "cy");
  assert.equal(s.turn, "h");
  assert.deepEqual(s.last, { kind: "guess", by: "h", answer: "cy", target: "cy", ok: true });
  assert.equal(s.seq, seq + 1); assert.deepEqual(s.log, [s.last]);
  says(() => G.guess(s, "h", { answer: "cy", target: "bob" }, 1), /not in play/);
  says(() => G.guess(s, "h", { answer: "bob", target: "cy" }, 1), /already caught/);
});

test("guessing: wrong moves the turn to the next player still hiding, in join order", () => {
  let s = guessing(["Ann", "Bob", "Cy", "Dee"]);
  s = G.guess(s, "h", { answer: "cy", target: "bob" }, 3000);
  assert.equal(s.turn, "bob"); assert.equal(s.players.h.s, 0); assert.equal(s.last.ok, false);
  s = G.guess(s, "bob", { answer: "cy", target: "cy" }, 3000);
  s = G.guess(s, "bob", { answer: "h", target: "dee" }, 3000);
  assert.equal(s.turn, "dee", "the caught player is skipped");
  s = G.guess(s, "dee", { answer: "h", target: "bob" }, 3000);
  assert.equal(s.turn, "h", "the turn wraps around");
  assert.equal(s.log.length, 4);
});

test("passing: the guesser, the host, or anyone after two quiet minutes", () => {
  let s = guessing(["Ann", "Bob", "Cy"]);
  s = G.guess(s, "h", { answer: "bob", target: "cy" }, 5000);
  assert.equal(s.turn, "bob");
  says(() => G.pass(s, "cy", null, 5000 + STALL - 1), /Only the host/);
  says(() => G.pass(s, "stranger", null, 5000 + STALL), /Only the host/);
  const own = G.pass(s, "bob", null, 5001);
  assert.equal(own.turn, "cy");
  assert.deepEqual(own.last, { kind: "pass", by: "bob", answer: "", target: "bob", ok: false });
  assert.equal(own.log.length, 1, "a pass is not a guess");
  assert.equal(G.pass(s, "h", null, 5001).last.target, "h");
  assert.equal(G.pass(s, "cy", null, 5000 + STALL).turn, "cy");
});

test("round end: the last one hiding scores 2 and the next-round pause starts", () => {
  let s = guessing(["Ann", "Bob", "Cy"]);
  s = G.guess(s, "h", { answer: "bob", target: "bob" }, 3000);
  s = G.guess(s, "h", { answer: "cy", target: "cy" }, 4000);
  assert.equal(s.phase, "done");
  assert.equal(s.players.h.s, 4); assert.equal(s.base.h, 0);
  assert.equal(s.deadline, 4000 + G.RULES.NEXT_MS);
  assert.deepEqual(G.authors(s), { h: "h", bob: "bob", cy: "cy" });
  says(() => G.startRound(s, "bob", { topic: "T" }, s.deadline), /Only the host/);
  says(() => G.startRound(s, "bob", { topic: "T", clock: true, deadline: s.deadline }, s.deadline - 1), /already started/);
  const next = G.startRound(s, "bob", { topic: "T2", clock: true, deadline: s.deadline }, s.deadline);
  assert.equal(next.round, 2); assert.equal(next.phase, "write");
  assert.deepEqual(next.answers, {}); assert.deepEqual(next.log, []);
  assert.deepEqual(next.base, { h: 4, bob: 0, cy: 0 });
  says(() => G.startRound(next, "cy", { topic: "T3", clock: true, deadline: s.deadline }, s.deadline + 5), /already being played/);
});

test("identical answers count for either writer", () => {
  let s = writing(["Ann", "Bob", "Cy"]);
  s = G.submit(s, "h", { text: "a" }, 1);
  s = G.submit(s, "bob", { text: "The Dog" }, 1);
  s = readAll(G.submit(s, "cy", { text: "the dog" }, 1, noShuffle));
  s = G.guess(s, "h", { answer: "bob", target: "cy" }, 1);
  assert.equal(s.last.ok, true);
  assert.deepEqual(s.alive, ["h", "bob"]);
  s = G.guess(s, "h", { answer: "cy", target: "bob" }, 1);
  assert.equal(s.phase, "done"); assert.equal(s.players.h.s, 4);
  assert.deepEqual(G.authors(s), { h: "h", bob: "cy", cy: "bob" });
});

test("after two trips around the table everyone gets a second try, later a third, never more", () => {
  let s = guessing(["Ann", "Bob", "Cy"]);
  const order = ["h", "bob", "cy"];
  const wrong = { h: { answer: "bob", target: "cy" }, bob: { answer: "cy", target: "h" }, cy: { answer: "h", target: "bob" } };
  const miss = () => { s = G.guess(s, s.turn, wrong[s.turn], 1); };
  for (let i = 0; i < 6; i++) { assert.equal(s.allowed, 1); assert.equal(s.turn, order[i % 3]); miss(); }
  assert.equal(s.allowed, 2); assert.equal(s.trips, 2);
  miss();
  assert.equal(s.turn, "h", "first miss of two keeps the turn"); assert.equal(s.misses, 1);
  miss();
  assert.equal(s.turn, "bob"); assert.equal(s.misses, 0);
  for (let i = 0; i < 5; i++) { miss(); miss(); }
  assert.equal(s.allowed, 3);
  for (let i = 0; i < 60; i++) miss();
  assert.equal(s.allowed, 3);
  assert.equal(s.log.length, G.RULES.LOG_MAX, "the guess list is capped");
});

test("winning: checked at the end of a round; one clear leader at the target wins", () => {
  let s = guessing(["Ann", "Bob", "Cy"], { target: 5 });
  s.players.bob.s = 5;
  s = G.guess(s, "h", { answer: "bob", target: "bob" }, 1);
  assert.equal(s.phase, "guess", "reaching the target mid-round does not stop the round");
  s = G.guess(s, "h", { answer: "cy", target: "cy" }, 1);
  assert.equal(s.phase, "over"); assert.deepEqual(s.winners, ["bob"], "h has 4, bob has 5");
  assert.equal(s.deadline, 0);
});

test("winning: level leaders at the target play another round", () => {
  let t = guessing(["Ann", "Bob", "Cy"], { target: 5 });
  t.players.h.s = 2; t.players.bob.s = 6;
  t = G.guess(G.guess(t, "h", { answer: "bob", target: "bob" }, 1), "h", { answer: "cy", target: "cy" }, 1);
  assert.equal(t.phase, "done"); assert.equal(t.note, "tie");
});

test("taking someone out: host only, never the host; scores and seat go", () => {
  const s = table(["Ann", "Bob", "Cy"]);
  says(() => G.remove(s, "bob", { player: "cy" }, 1), /Only the host/);
  says(() => G.remove(s, "h", { player: "h" }, 1), /cannot be taken out/);
  assert.deepEqual(G.seats(G.remove(s, "h", { player: "bob" }, 1)), ["h", "cy"]);
});

test("taking someone out while writing: reading starts if everyone left has answered", () => {
  let s = writing(["Ann", "Bob", "Cy"]);
  s = G.submit(G.submit(s, "h", { text: "a" }, 1), "bob", { text: "b" }, 1);
  s = G.remove(s, "h", { player: "cy" }, 1, noShuffle);
  assert.equal(s.phase, "read"); assert.deepEqual(s.alive, ["h", "bob"]);
});

test("taking the reader out hands the reading to the next player", () => {
  let s = reading(["Ann", "Bob", "Cy", "Dee"]);
  s = G.passReader(s, "h", null, 1);
  s = G.remove(s, "h", { player: "bob" }, 2);
  assert.equal(s.reader, "cy"); assert.equal(s.phase, "read");
  assert.deepEqual(s.last, { kind: "left", by: "", answer: "Bob", target: "", ok: false });
  assert.equal(readAll(s).turn, "cy");
});

test("taking someone out while guessing: their turn moves on, their answer stays as a decoy, a lone survivor ends the round", () => {
  let s = guessing(["Ann", "Bob", "Cy", "Dee"]);
  s = G.guess(s, "h", { answer: "bob", target: "cy" }, 1);
  assert.equal(s.turn, "bob");
  s = G.remove(s, "h", { player: "bob" }, 1);
  assert.equal(s.turn, "cy"); assert.deepEqual(s.alive, ["h", "cy", "dee"]);
  assert.ok(s.shuffle.includes("bob"));
  s = G.guess(s, "cy", { answer: "bob", target: "dee" }, 1);
  assert.equal(s.last.ok, false, "the decoy matches nobody");
  s = G.remove(s, "h", { player: "cy" }, 1);
  s = G.remove(s, "h", { player: "dee" }, 5);
  assert.equal(s.phase, "done"); assert.equal(s.players.h.s, 2);
  assert.equal(G.authors(s).bob, "");
  s.shuffle = ["bob", "h", "cy", "dee"];
  assert.deepEqual(G.authors(s), { bob: "", h: "h", cy: "", dee: "" }, "whatever the order on screen");
});

test("ending: the host can end early; play again keeps players and zeroes scores", () => {
  let s = guessing(["Ann", "Bob", "Cy"]);
  s = G.guess(s, "h", { answer: "bob", target: "bob" }, 1);
  says(() => G.finish(s, "bob"), /Only the host/);
  s = G.finish(s, "h");
  assert.equal(s.phase, "over"); assert.deepEqual(s.winners, ["h"]); assert.equal(s.note, "host");
  s.credited = ["h"];
  says(() => G.playAgain(s, "cy"), /Only the host/);
  const again = G.playAgain(s, "h");
  assert.equal(again.phase, "lobby"); assert.equal(again.round, 0);
  assert.deepEqual(G.seats(again), ["h", "bob", "cy"]);
  assert.equal(again.players.h.s, 0);
  assert.deepEqual(again.credited, []); assert.deepEqual(again.used, [4]);
});

test("moves never change the state they were given", () => {
  const s = guessing(["Ann", "Bob", "Cy"]);
  const before = JSON.stringify(s);
  G.guess(s, "h", { answer: "bob", target: "bob" }, 1);
  G.pass(s, "h", null, 1);
  G.remove(s, "h", { player: "bob" }, 1);
  assert.equal(JSON.stringify(s), before);
});
