// The rules of the game on their own: no Firebase, no page. Run by `npm test`.
import test from "node:test";
import assert from "node:assert/strict";
import * as G from "../game.js";

const noShuffle = () => 0.999999;
function table(names, options) {
  let s = G.newGame("h", options);
  names.forEach((n, i) => { s = G.join(s, i === 0 ? "h" : n.toLowerCase(), { name: n }, 100 + i); });
  return s;
}
function writing(names, options) {
  return G.startRound(table(names, options), "h", { topic: "Things a dog thinks about", index: 4 }, 1000);
}
function guessing(names, options) {
  let s = writing(names, options);
  G.seats(s).forEach(id => { s = G.submit(s, id, { text: "answer of " + id }, 2000, noShuffle); });
  return s;
}
const says = (fn, re) => assert.throws(fn, e => e instanceof G.GameError && re.test(e.message));

test("joining: a name is required, unique, and seats follow join order", () => {
  const s = table(["Ann", "Bob", "Cy"]);
  assert.deepEqual(G.seats(s), ["h", "bob", "cy"]);
  says(() => G.join(s, "x", { name: "  " }, 1), /character name/);
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

test("starting: host only, two players, sets the write clock", () => {
  says(() => G.startRound(table(["Ann"]), "h", { topic: "T" }, 1), /At least 2/);
  says(() => G.startRound(table(["Ann", "Bob"]), "bob", { topic: "T" }, 1), /Only the host/);
  const s = writing(["Ann", "Bob", "Cy"]);
  assert.equal(s.phase, "write"); assert.equal(s.round, 1);
  assert.deepEqual(s.inRound, ["h", "bob", "cy"]);
  assert.deepEqual(s.used, [4]);
  assert.equal(s.deadline, 1000 + G.RULES.WRITE_MS);
});

test("writing: answers stay closed until everyone has submitted, then guessing starts", () => {
  let s = writing(["Ann", "Bob", "Cy"]);
  s = G.submit(s, "h", { text: "  one   two " }, 2000);
  assert.equal(s.answers.h, "one two");
  s = G.submit(s, "bob", { text: "b" }, 2000);
  assert.equal(s.phase, "write");
  s = G.submit(s, "bob", { text: "b2" }, 2000);
  assert.equal(s.answers.bob, "b2", "an answer can be changed while writing");
  s = G.submit(s, "cy", { text: "c" }, 3000, noShuffle);
  assert.equal(s.phase, "guess");
  assert.deepEqual(s.alive, ["h", "bob", "cy"]);
  assert.deepEqual(s.shuffle.slice().sort(), ["bob", "cy", "h"]);
  assert.equal(s.turn, "h");
  assert.equal(s.deadline, 3000 + G.RULES.TURN_MS);
  says(() => G.submit(s, "h", { text: "late" }, 1), /closed/);
});

test("writing: answers sent field by field are revealed by allIn once nobody is missing", () => {
  let s = writing(["Ann", "Bob", "Cy"]);
  s.answers = { h: "a", bob: "b" };
  says(() => G.allIn(s, "cy", null, 5), /Still waiting/);
  s.answers.cy = "c"; s.answers.stray = "not in this round";
  says(() => G.allIn(s, "stranger", null, 5), /not in this game/);
  s = G.allIn(s, "bob", null, 5, noShuffle);
  assert.equal(s.phase, "guess"); assert.deepEqual(s.alive, ["h", "bob", "cy"]);
  assert.equal(s.answers.stray, undefined);
  says(() => G.allIn(s, "bob", null, 6), /already started/);
});

test("writing: a late joiner waits for the next round", () => {
  let s = writing(["Ann", "Bob"]);
  s = G.join(s, "dee", { name: "Dee" }, 1500);
  says(() => G.submit(s, "dee", { text: "x" }, 1600), /next round/);
  s = G.submit(G.submit(s, "h", { text: "a" }, 1), "bob", { text: "b" }, 1);
  assert.equal(s.phase, "guess", "the late joiner does not hold up the round");
});

test("write timer: any player starts the guessing once time is up; the host can earlier", () => {
  let s = writing(["Ann", "Bob", "Cy"]);
  s = G.submit(G.submit(s, "h", { text: "a" }, 1), "bob", { text: "b" }, 1);
  const clock = { clock: true, deadline: s.deadline };
  says(() => G.startGuessing(s, "bob", null, s.deadline + 1), /Only the host/);
  says(() => G.startGuessing(s, "bob", clock, s.deadline - 1), /clock/);
  says(() => G.startGuessing(s, "stranger", clock, s.deadline + 1), /clock/);
  const byClock = G.startGuessing(s, "bob", clock, s.deadline, noShuffle);
  assert.deepEqual(byClock.alive, ["h", "bob"], "the player who never answered sits out");
  assert.equal(G.startGuessing(s, "h", null, 5, noShuffle).phase, "guess");
});

test("write timer: fewer than two answers voids the round", () => {
  let s = G.submit(writing(["Ann", "Bob", "Cy"]), "bob", { text: "b" }, 1);
  s = G.startGuessing(s, "h", null, 5000);
  assert.equal(s.phase, "done"); assert.equal(s.note, "few");
  assert.equal(s.players.bob.s, 0);
  assert.equal(s.deadline, 5000 + G.RULES.NEXT_MS);
});

test("guessing: right scores a point, knocks the writer out and keeps the turn", () => {
  let s = guessing(["Ann", "Bob", "Cy", "Dee"]);
  says(() => G.guess(s, "bob", { answer: "cy", target: "cy" }, 1), /not your turn/);
  says(() => G.guess(s, "h", { answer: "h", target: "bob" }, 1), /yours/);
  says(() => G.guess(s, "h", { answer: "bob", target: "h" }, 1), /someone else/);
  s = G.guess(s, "h", { answer: "cy", target: "cy" }, 3000);
  assert.equal(s.players.h.s, 1);
  assert.deepEqual(s.alive, ["h", "bob", "dee"]);
  assert.equal(s.found.cy, "cy");
  assert.equal(s.turn, "h");
  assert.deepEqual(s.last, { by: "h", answer: "cy", target: "cy", ok: true, skip: false });
  says(() => G.guess(s, "h", { answer: "cy", target: "bob" }, 1), /not in play/);
  says(() => G.guess(s, "h", { answer: "bob", target: "cy" }, 1), /already out/);
});

test("guessing: wrong passes the turn to the next player still in, in join order", () => {
  let s = guessing(["Ann", "Bob", "Cy", "Dee"]);
  s = G.guess(s, "h", { answer: "cy", target: "bob" }, 3000);
  assert.equal(s.turn, "bob"); assert.equal(s.players.h.s, 0); assert.equal(s.last.ok, false);
  s = G.guess(s, "bob", { answer: "cy", target: "cy" }, 3000);
  s = G.guess(s, "bob", { answer: "h", target: "dee" }, 3000);
  assert.equal(s.turn, "dee", "the guessed-out player is skipped");
  s = G.guess(s, "dee", { answer: "h", target: "bob" }, 3000);
  assert.equal(s.turn, "h", "the turn wraps around");
});

test("round end: the last unguessed player scores 2 and the next-round clock starts", () => {
  let s = guessing(["Ann", "Bob", "Cy"]);
  s = G.guess(s, "h", { answer: "bob", target: "bob" }, 3000);
  s = G.guess(s, "h", { answer: "cy", target: "cy" }, 4000);
  assert.equal(s.phase, "done");
  assert.equal(s.players.h.s, 4);
  assert.equal(s.deadline, 4000 + G.RULES.NEXT_MS);
  assert.deepEqual(G.authors(s), { h: "h", bob: "bob", cy: "cy" });
  says(() => G.startRound(s, "bob", { topic: "T" }, s.deadline), /Only the host/);
  says(() => G.startRound(s, "bob", { topic: "T", clock: true, deadline: s.deadline }, s.deadline - 1), /clock/);
  const next = G.startRound(s, "bob", { topic: "T2", clock: true, deadline: s.deadline }, s.deadline);
  assert.equal(next.round, 2); assert.equal(next.phase, "write");
  assert.deepEqual(next.answers, {});
});

test("first guesser rotates each round", () => {
  let s = guessing(["Ann", "Bob", "Cy"]);
  s = G.guess(G.guess(s, "h", { answer: "bob", target: "bob" }, 1), "h", { answer: "cy", target: "cy" }, 1);
  s = G.startRound(s, "h", { topic: "T2" }, 1);
  G.seats(s).forEach(id => { s = G.submit(s, id, { text: "x" + id }, 2, noShuffle); });
  assert.equal(s.turn, "bob");
});

test("identical answers count for either writer", () => {
  let s = writing(["Ann", "Bob", "Cy"]);
  s = G.submit(s, "h", { text: "a" }, 1);
  s = G.submit(s, "bob", { text: "The Dog" }, 1);
  s = G.submit(s, "cy", { text: "the dog" }, 1, noShuffle);
  s = G.guess(s, "h", { answer: "bob", target: "cy" }, 1);
  assert.equal(s.last.ok, true);
  assert.deepEqual(s.alive, ["h", "bob"]);
  s = G.guess(s, "h", { answer: "cy", target: "bob" }, 1);
  assert.equal(s.phase, "done"); assert.equal(s.players.h.s, 4);
  assert.deepEqual(G.authors(s), { h: "h", bob: "cy", cy: "bob" });
});

test("turn timer: any player passes the turn once time is up; the host can earlier", () => {
  let s = guessing(["Ann", "Bob", "Cy"]);
  const clock = { clock: true, deadline: s.deadline };
  says(() => G.skip(s, "bob", null, s.deadline + 1), /Only the host/);
  says(() => G.skip(s, "bob", clock, s.deadline - 1), /clock/);
  const t = G.skip(s, "cy", clock, s.deadline);
  says(() => G.skip(t, "h", clock, s.deadline + 5), /clock/, "the host's phone acting on the same expired clock does not skip a second player");
  assert.equal(t.turn, "bob"); assert.equal(t.last.skip, true); assert.equal(t.last.by, "h");
  assert.equal(t.deadline, s.deadline + G.RULES.TURN_MS);
  assert.equal(G.skip(s, "h", null, 5).turn, "bob");
});

test("after two trips around the table everyone gets a second miss, later a third, never more", () => {
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
  for (let i = 0; i < 40; i++) miss();
  assert.equal(s.allowed, 3);
});

test("winning: checked at the end of a round; one clear leader at the target wins", () => {
  let s = guessing(["Ann", "Bob", "Cy"], { target: 5 });
  s.players.bob.s = 5;
  s = G.guess(s, "h", { answer: "bob", target: "bob" }, 1);
  assert.equal(s.phase, "guess", "reaching the target mid-round does not stop the round");
  s = G.guess(s, "h", { answer: "cy", target: "cy" }, 1);
  assert.equal(s.phase, "over"); assert.deepEqual(s.winners, ["bob"], "h has 4, bob has 5");
});

test("winning: clear leader ends the game; level leaders play another round", () => {
  let s = guessing(["Ann", "Bob", "Cy"], { target: 5 });
  s.players.h.s = 2;
  s = G.guess(G.guess(s, "h", { answer: "bob", target: "bob" }, 1), "h", { answer: "cy", target: "cy" }, 1);
  assert.equal(s.phase, "over"); assert.deepEqual(s.winners, ["h"]); assert.equal(s.deadline, 0);

  let t = guessing(["Ann", "Bob", "Cy"], { target: 5 });
  t.players.h.s = 2; t.players.bob.s = 6;
  t = G.guess(G.guess(t, "h", { answer: "bob", target: "bob" }, 1), "h", { answer: "cy", target: "cy" }, 1);
  assert.equal(t.phase, "done"); assert.equal(t.note, "tie");
});

test("removing: host only, never the host; scores and seat go", () => {
  const s = table(["Ann", "Bob", "Cy"]);
  says(() => G.remove(s, "bob", { player: "cy" }, 1), /Only the host/);
  says(() => G.remove(s, "h", { player: "h" }, 1), /cannot be removed/);
  assert.deepEqual(G.seats(G.remove(s, "h", { player: "bob" }, 1)), ["h", "cy"]);
});

test("removing while writing: the round starts if everyone left has answered", () => {
  let s = writing(["Ann", "Bob", "Cy"]);
  s = G.submit(G.submit(s, "h", { text: "a" }, 1), "bob", { text: "b" }, 1);
  s = G.remove(s, "h", { player: "cy" }, 1, noShuffle);
  assert.equal(s.phase, "guess"); assert.deepEqual(s.alive, ["h", "bob"]);
});

test("removing while guessing: their turn passes, their answer stays as a decoy, a lone survivor ends the round", () => {
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
  assert.equal(s.phase, "over"); assert.deepEqual(s.winners, ["h"]);
  s.credited = ["h"];
  says(() => G.playAgain(s, "cy"), /Only the host/);
  const again = G.playAgain(s, "h");
  assert.equal(again.phase, "lobby"); assert.equal(again.round, 0);
  assert.deepEqual(G.seats(again), ["h", "bob", "cy"]);
  assert.equal(again.players.h.s, 0);
  assert.deepEqual(again.credited, []); assert.deepEqual(again.used, [4]);
});

test("moves never change the state they were given", () => {
  const s = writing(["Ann", "Bob"]);
  const before = JSON.stringify(s);
  G.submit(s, "h", { text: "a" }, 1);
  G.remove(s, "h", { player: "bob" }, 1);
  assert.equal(JSON.stringify(s), before);
});
