/* The rules of the game, with no Firebase and no page in them.

   Every move is a function (state, uid, args, now) that returns the next state
   or throws a GameError whose message can be shown to the player. backend.js
   runs a move inside a Firestore transaction, so two phones cannot both apply
   a move to the same state. test/game.test.mjs tests this file on its own.

   State is one document, games/{CODE}:
     host      uid of the Google user who created the game
     created   server timestamp
     target    first to this many points wins (checked at the end of a round)
     pack      topic pack key (see topics.js)
     phase     lobby | write | guess | done | over
     round     0 in the lobby, then 1, 2, ...
     topic     this round's topic
     used      topic numbers already played from this pack
     players   { uid: { n: character name, s: score, j: joined (ms) } }
     inRound   uids playing this round, in seat order
     alive     uids not yet guessed this round, in seat order
     answers   { uid: text }   the page shows the text and hides the uid
     shuffle   uids of answers in the order every phone shows them
     found     { answer uid: uid of the player it was matched to }
     turn      uid whose turn it is to guess
     misses    wrong guesses made this turn
     allowed   wrong guesses allowed per turn (grows as trips go by)
     trips     full trips of the turn around the table this round
     tripLeft  turns left in the current trip
     deadline  ms time the write step, the turn or the pause between rounds ends
     last      the last guess or skip, for the banner
     note      "" | "few" (round void) | "tie" (target reached, top scores level)
     winners   uids, once the phase is over
     credited  Google uids whose saved win counts already include this game */

/* The numbers the owner wants to play with. Change them here only. */
export var RULES = {
  WRITE_MS: 90000,      // time to write an answer
  TURN_MS: 45000,       // time to make a guess
  NEXT_MS: 20000,       // pause before the next round starts by itself
  TRIPS_PER_STEP: 2,    // trips around the table before everyone gets one more miss
  MAX_MISSES: 3,        // most wrong guesses per turn
  BONUS: 2,             // points for the last unguessed player
  TARGETS: [5, 10, 15, 20],
  DEFAULT_TARGET: 10,
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 20,
  NAME_MAX: 20,
  ANSWER_MAX: 80,
  TOPIC_MAX: 120
};

export function GameError(message) {
  this.name = "GameError";
  this.message = message;
}
GameError.prototype = Object.create(Error.prototype);

function fail(message) { throw new GameError(message); }

/* A move made for the clock names the deadline the phone saw. It counts only
   if that deadline is still the current one and has passed, so two phones
   acting on the same expired clock cannot both move the game. */
function clockRanOut(s, uid, args, now) {
  return !!(args && args.clock) && !!s.players[uid] && s.deadline > 0 &&
    args.deadline === s.deadline && now >= s.deadline;
}
function mayMove(s, uid, args, now, what) {
  if (args && args.clock) { if (!clockRanOut(s, uid, args, now)) fail("The clock has already moved on."); }
  else if (uid !== s.host) fail("Only the host can " + what + ".");
}

function clone(s) {
  var created = s.created;
  var c = JSON.parse(JSON.stringify(Object.assign({}, s, { created: null })));
  c.created = created;
  return c;
}

function clean(text, max) {
  return String(text == null ? "" : text).replace(/\s+/g, " ").trim().slice(0, max);
}
function same(a, b) { return a.toLowerCase() === b.toLowerCase(); }

/* Seat order: the order people joined in. */
export function seats(s) {
  return Object.keys(s.players).sort(function (a, b) {
    return (s.players[a].j - s.players[b].j) || (a < b ? -1 : a > b ? 1 : 0);
  });
}

export function leaders(s) {
  var ids = seats(s), top = 0;
  ids.forEach(function (id) { top = Math.max(top, s.players[id].s); });
  return ids.filter(function (id) { return s.players[id].s === top; });
}

export function newGame(hostUid, options) {
  options = options || {};
  return {
    host: hostUid, created: null,
    target: RULES.TARGETS.indexOf(options.target) >= 0 ? options.target : RULES.DEFAULT_TARGET,
    pack: options.pack || "general",
    phase: "lobby", round: 0, topic: "", used: [],
    players: {}, inRound: [], alive: [], answers: {}, shuffle: [], found: {},
    turn: "", misses: 0, allowed: 1, trips: 0, tripLeft: 0, deadline: 0,
    last: null, note: "", winners: [], credited: []
  };
}

/* ---------- joining and setup ---------- */

export function join(s, uid, args, now) {
  s = clone(s);
  var name = clean(args && args.name, RULES.NAME_MAX);
  if (!name) fail("Type a character name first.");
  Object.keys(s.players).forEach(function (id) {
    if (id !== uid && same(s.players[id].n, name)) fail("Someone is already " + s.players[id].n + ". Pick another name.");
  });
  if (s.players[uid]) { s.players[uid].n = name; return s; }
  if (Object.keys(s.players).length >= RULES.MAX_PLAYERS) fail("This game is full.");
  s.players[uid] = { n: name, s: 0, j: now };
  return s;
}

export function setup(s, uid, args) {
  if (uid !== s.host) fail("Only the host can change the game settings.");
  if (s.phase !== "lobby") fail("Settings can only change before the game starts.");
  s = clone(s);
  if (args.target !== undefined) {
    if (RULES.TARGETS.indexOf(args.target) < 0) fail("Pick one of the listed targets.");
    s.target = args.target;
  }
  if (args.pack !== undefined && args.pack !== s.pack) { s.pack = clean(args.pack, 20); s.used = []; }
  return s;
}

/* ---------- a round ---------- */

function setTopic(s, args) {
  var topic = clean(args && args.topic, RULES.TOPIC_MAX);
  if (!topic) fail("The round needs a topic.");
  s.topic = topic;
  if (args.index >= 0 && s.used.indexOf(args.index) < 0) s.used.push(args.index);
}

export function startRound(s, uid, args, now) {
  if (s.phase !== "lobby" && s.phase !== "done") fail("A round is already being played.");
  mayMove(s, uid, args, now, "start the round");
  if (Object.keys(s.players).length < RULES.MIN_PLAYERS) fail("At least " + RULES.MIN_PLAYERS + " players are needed.");
  s = clone(s);
  setTopic(s, args);
  s.round += 1;
  s.phase = "write";
  s.inRound = seats(s);
  s.alive = []; s.answers = {}; s.shuffle = []; s.found = {};
  s.turn = ""; s.misses = 0; s.allowed = 1; s.trips = 0; s.tripLeft = 0;
  s.last = null; s.note = "";
  s.deadline = now + RULES.WRITE_MS;
  return s;
}

export function changeTopic(s, uid, args, now) {
  if (uid !== s.host) fail("Only the host can change the topic.");
  if (s.phase !== "write") fail("The topic can only change while answers are being written.");
  s = clone(s);
  setTopic(s, args);
  s.answers = {};
  s.deadline = now + RULES.WRITE_MS;
  return s;
}

function shuffled(list, rand) {
  var a = list.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var k = Math.floor(rand() * (i + 1)), t = a[i];
    a[i] = a[k]; a[k] = t;
  }
  return a;
}

function endRound(s, now) {
  s.phase = "done";
  s.turn = ""; s.misses = 0;
  s.deadline = now + RULES.NEXT_MS;
  var top = leaders(s);
  if (top.length && s.players[top[0]].s >= s.target) {
    if (top.length === 1) { s.phase = "over"; s.winners = top; s.deadline = 0; }
    else s.note = "tie";
  }
}

/* Writing is over: show the answers and start the guessing. */
function reveal(s, now, rand) {
  var answered = s.inRound.filter(function (id) { return s.answers[id] !== undefined; });
  Object.keys(s.answers).forEach(function (id) { if (answered.indexOf(id) < 0) delete s.answers[id]; });
  if (answered.length < 2) {
    s.alive = []; s.shuffle = [];
    endRound(s, now);
    s.note = "few";
    return;
  }
  s.phase = "guess";
  s.alive = answered;
  s.shuffle = shuffled(answered, rand || Math.random);
  s.turn = answered[(s.round - 1) % answered.length];
  s.misses = 0; s.allowed = 1; s.trips = 0; s.tripLeft = answered.length;
  s.deadline = now + RULES.TURN_MS;
}

export function submit(s, uid, args, now, rand) {
  if (s.phase !== "write") fail("Answers are closed for this round.");
  if (s.inRound.indexOf(uid) < 0) fail("You are in from the next round.");
  var text = clean(args && args.text, RULES.ANSWER_MAX);
  if (!text) fail("Type an answer first.");
  s = clone(s);
  s.answers[uid] = text;
  if (s.inRound.every(function (id) { return s.answers[id] !== undefined; })) reveal(s, now, rand);
  return s;
}

/* Phones send answers one field at a time without a transaction (see
   backend.js put), so the last one in asks for this. */
export function allIn(s, uid, args, now, rand) {
  if (s.phase !== "write") fail("Guessing has already started.");
  if (!s.players[uid]) fail("You are not in this game.");
  if (!s.inRound.length || !s.inRound.every(function (id) { return s.answers[id] !== undefined; })) fail("Still waiting for answers.");
  s = clone(s);
  reveal(s, now, rand);
  return s;
}

/* The host at any time, or any player once the writing time is up. */
export function startGuessing(s, uid, args, now, rand) {
  if (s.phase !== "write") fail("Guessing has already started.");
  mayMove(s, uid, args, now, "start the guessing early");
  s = clone(s);
  reveal(s, now, rand);
  return s;
}

function passTurn(s, now) {
  var i = s.alive.indexOf(s.turn);
  s.turn = s.alive[(i + 1) % s.alive.length];
  s.misses = 0;
  s.tripLeft -= 1;
  if (s.tripLeft <= 0) {
    s.trips += 1;
    s.tripLeft = s.alive.length;
    s.allowed = Math.min(RULES.MAX_MISSES, 1 + Math.floor(s.trips / RULES.TRIPS_PER_STEP));
  }
  s.deadline = now + RULES.TURN_MS;
}

function knockOut(s, id, now) {
  s.alive = s.alive.filter(function (x) { return x !== id; });
  if (s.alive.length === 1) {
    s.players[s.alive[0]].s += RULES.BONUS;
    endRound(s, now);
  }
}

export function guess(s, uid, args, now) {
  if (s.phase !== "guess") fail("Nobody is guessing right now.");
  if (s.turn !== uid) fail("It is not your turn.");
  var answer = args && args.answer, target = args && args.target;
  if (s.shuffle.indexOf(answer) < 0 || s.found[answer]) fail("That answer is not in play.");
  if (answer === uid) fail("That one is yours. Pick another answer.");
  if (target === uid) fail("Guess someone else.");
  if (s.alive.indexOf(target) < 0) fail("That player is already out.");
  s = clone(s);
  /* Two players who wrote the same thing are interchangeable. */
  var right = answer === target || same(s.answers[answer], s.answers[target]);
  s.last = { by: uid, answer: answer, target: target, ok: right, skip: false };
  if (right) {
    s.found[answer] = target;
    s.players[uid].s += 1;
    s.deadline = now + RULES.TURN_MS;
    knockOut(s, target, now);
  } else {
    s.misses += 1;
    if (s.misses >= s.allowed) passTurn(s, now);
    else s.deadline = now + RULES.TURN_MS;
  }
  return s;
}

/* The host at any time, or any player once the turn's time is up. */
export function skip(s, uid, args, now) {
  if (s.phase !== "guess") fail("Nobody is guessing right now.");
  mayMove(s, uid, args, now, "skip a turn early");
  s = clone(s);
  s.last = { by: s.turn, answer: "", target: "", ok: false, skip: true };
  passTurn(s, now);
  return s;
}

/* ---------- host controls ---------- */

export function remove(s, uid, args, now, rand) {
  var id = args && args.player;
  if (uid !== s.host) fail("Only the host can remove a player.");
  if (id === s.host) fail("The host cannot be removed.");
  if (!s.players[id]) fail("That player has already left.");
  s = clone(s);
  delete s.players[id];
  s.inRound = s.inRound.filter(function (x) { return x !== id; });
  s.winners = s.winners.filter(function (x) { return x !== id; });
  if (s.phase === "write") {
    delete s.answers[id];
    if (s.inRound.every(function (x) { return s.answers[x] !== undefined; })) reveal(s, now, rand);
  } else if (s.phase === "guess" && s.alive.indexOf(id) >= 0) {
    /* Their answer stays on the list as a decoy nobody can match. */
    if (s.turn === id) passTurn(s, now);
    knockOut(s, id, now);
  }
  return s;
}

export function finish(s, uid) {
  if (uid !== s.host) fail("Only the host can end the game.");
  if (s.phase === "lobby" || s.phase === "over") fail("There is no game to end.");
  s = clone(s);
  s.phase = "over"; s.turn = ""; s.deadline = 0; s.note = "";
  s.winners = leaders(s);
  return s;
}

export function playAgain(s, uid) {
  if (uid !== s.host) fail("Only the host can start a new game.");
  if (s.phase !== "over") fail("This game is still being played.");
  var fresh = newGame(s.host, { target: s.target, pack: s.pack });
  s = clone(s);
  Object.keys(s.players).forEach(function (id) { s.players[id].s = 0; });
  fresh.created = s.created; fresh.players = s.players; fresh.used = s.used;
  return fresh;
}

/* Who wrote each answer, as far as the round has shown it. Used by the page:
   matched answers during the round, everything once the round is over. */
export function authors(s) {
  var out = {}, taken = {};
  s.shuffle.forEach(function (a) { if (s.found[a]) { out[a] = s.found[a]; taken[s.found[a]] = true; } });
  if (s.phase === "done" || s.phase === "over") {
    /* A player still in the game wrote their own answer, unless an identical
       one was matched to them. Then whoever is left takes what is left; a
       removed player's answer belongs to nobody. */
    s.shuffle.forEach(function (a) {
      if (out[a] === undefined && s.players[a] && !taken[a]) { out[a] = a; taken[a] = true; }
    });
    s.shuffle.forEach(function (a) {
      if (out[a] !== undefined) return;
      var who = s.alive.filter(function (x) { return !taken[x]; })[0];
      if (who) { out[a] = who; taken[who] = true; } else out[a] = "";
    });
  }
  return out;
}
