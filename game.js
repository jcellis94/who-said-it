/* The rules of the game, with no Firebase and no page in them.

   Every move is a function (state, uid, args, now) that returns the next state
   or throws a GameError whose message can be shown to the player. backend.js
   runs a move inside a Firestore transaction, so two phones cannot both apply
   a move to the same state. Two moves are the exception: the page uses join
   and submit only to check a name or an answer against its own copy of the
   game, then writes that one field without a transaction. test/game.test.mjs tests this file on its own.

   A round goes: write (everyone sends one secret answer), guess (all the
   answers appear on every phone at once and players take turns), done. A
   separate read step, where one player revealed the answers one by one, was
   built and removed on 2026-11-27 because it did not work in play.
   There are no clocks. A guesser may pass; the host may pass anyone, may
   close the writing, and starts every round. If nothing has happened for
   STALL_MS during a round, every player may do the host's unsticking. If the
   host is gone or in the way, the other players can vote for a new one.

   State is one document, games/{CODE}:
     host      uid of the Google user who created the game
     created   server timestamp
     target    first to this many points wins (checked at the end of a round)
     pack      topic pack key (see topics.js)
     phase     lobby | write | guess | done | over
     round     0 in the lobby, then 1, 2, ...
     topic     this round's topic
     used      topic numbers already played from this pack
     players   { uid: { n: name, s: score, j: joined (ms) } }
     inRound   uids playing this round, in join order
     alive     uids not yet caught this round, in join order
     answers   { uid: text }   the page shows the text and hides the uid
     shuffle   uids of answers in the order they are read and shown
     found     { answer uid: uid of the player it was matched to }
     turn      uid whose turn it is to guess
     misses    wrong guesses made this turn
     allowed   wrong guesses allowed per turn (grows as trips go by)
     trips     full trips of the turn around the table this round
     tripLeft  turns left in the current trip
     since     ms time of the last thing that happened, for the safety net
     seq       goes up by one with every event, so phones show each one once
     last      the latest event: { kind: guess | pass | left | host, by, answer, target, ok }
                 guess: by guessed that target wrote answer (an answer uid)
                 pass:  by's turn was passed by target (themselves, the host, anyone)
                 left:  the host removed a player; answer holds their name
                 host:  the players voted; by is the new host, answer the old host's name
     log       this round's guesses, oldest first
     base      { uid: score when the round started }, for "this round" points
     note      "" | "few" (round void) | "tie" (target reached, top scores level)
               | "host" (the host ended the game early)
     winners   uids, once the phase is over
     credited  Google uids whose saved win counts already include this game
     votes     uids of players who have voted for a new host */

/* The numbers the owner wants to play with. Change them here only. */
export var RULES = {
  STALL_MS: 120000,     // quiet time before any player may do the host's unsticking
  TRIPS_PER_STEP: 2,    // trips around the table before everyone gets one more try
  MAX_MISSES: 3,        // most wrong guesses per turn
  BONUS: 2,             // points for the last one hiding
  HOST_VOTES: 3,        // votes that replace the host (or every other player, if fewer)
  TARGETS: [5, 10, 15, 20],
  DEFAULT_TARGET: 10,
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 20,
  NAME_MAX: 20,
  ANSWER_MAX: 80,
  TOPIC_MAX: 120,
  LOG_MAX: 40
};

export function GameError(message) {
  this.name = "GameError";
  this.message = message;
}
GameError.prototype = Object.create(Error.prototype);

function fail(message) { throw new GameError(message); }

/* The host, or any player once the game has been quiet for STALL_MS. */
function hostOrStalled(s, uid, now, what) {
  if (uid === s.host) return;
  if (s.players[uid] && now - s.since >= RULES.STALL_MS) return;
  fail("Only the host can " + what + ".");
}
function happened(s, event) {
  s.seq += 1;
  s.last = event;
  if (event && event.kind === "guess") {
    s.log.push(event);
    if (s.log.length > RULES.LOG_MAX) {
      /* Drop the oldest miss: catches stay, because the page reads who
         caught whom from this list. There are never more than 20 catches. */
      var drop = 0;
      for (var i = 0; i < s.log.length; i++) if (!s.log[i].ok) { drop = i; break; }
      s.log.splice(drop, 1);
    }
  }
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
    turn: "", misses: 0, allowed: 1, trips: 0, tripLeft: 0,
    since: 0, seq: 0, last: null, log: [], base: {},
    note: "", winners: [], credited: [], votes: []
  };
}

/* ---------- joining and setup ---------- */

export function join(s, uid, args, now) {
  s = clone(s);
  var name = clean(args && args.name, RULES.NAME_MAX);
  if (!name) fail("Type a name first.");
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

/* Only the host starts a round; nothing starts by itself. */
export function startRound(s, uid, args, now) {
  if (s.phase !== "lobby" && s.phase !== "done") fail("A round is already being played.");
  if (uid !== s.host) fail("Only the host can start the round.");
  if (Object.keys(s.players).length < RULES.MIN_PLAYERS) fail("At least " + RULES.MIN_PLAYERS + " players are needed.");
  s = clone(s);
  setTopic(s, args);
  s.round += 1;
  s.phase = "write";
  s.inRound = seats(s);
  s.alive = []; s.answers = {}; s.shuffle = []; s.found = {};
  s.turn = ""; s.misses = 0; s.allowed = 1; s.trips = 0; s.tripLeft = 0;
  s.log = []; s.note = ""; s.base = {};
  s.inRound.forEach(function (id) { s.base[id] = s.players[id].s; });
  s.since = now;
  happened(s, null);
  return s;
}

export function changeTopic(s, uid, args, now) {
  if (uid !== s.host) fail("Only the host can change the topic.");
  if (s.phase !== "write") fail("The topic can only change while answers are being written.");
  s = clone(s);
  setTopic(s, args);
  s.answers = {};
  s.since = now;
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

/* Between rounds: is there a winner? One clear leader at the target wins;
   level leaders at the target play another round. */
function settle(s) {
  var top = leaders(s);
  if (s.note === "tie") s.note = "";
  if (top.length && s.players[top[0]].s >= s.target) {
    if (top.length === 1) { s.phase = "over"; s.winners = top; s.note = ""; }
    else s.note = "tie";
  }
}

function endRound(s, now) {
  s.phase = "done";
  s.turn = ""; s.misses = 0;
  s.since = now;
  settle(s);
}

/* Writing is over: show the answers and start the guessing. */
function reveal(s, now, rand) {
  var answered = s.inRound.filter(function (id) { return s.answers[id] !== undefined; });
  Object.keys(s.answers).forEach(function (id) { if (answered.indexOf(id) < 0) delete s.answers[id]; });
  if (answered.length < 2) {
    s.alive = []; s.shuffle = [];
    endRound(s, now);
    if (s.phase === "done") s.note = "few";   // not when the game has just ended
    return;
  }
  /* Straight to guessing: every phone shows all the answers at once. */
  s.phase = "guess";
  s.alive = answered;
  s.shuffle = shuffled(answered, rand || Math.random);
  s.turn = answered[(s.round - 1) % answered.length];
  s.misses = 0; s.allowed = 1; s.trips = 0; s.tripLeft = answered.length;
  s.since = now;
}

/* Checks an answer and, when it is the last one in, closes the writing.
   The page uses this to check an answer before sending it as one field. */
export function submit(s, uid, args, now, rand) {
  if (s.phase !== "write") fail("Answers are closed for this round.");
  if (s.inRound.indexOf(uid) < 0) fail("You'll play from the next round.");
  var text = clean(args && args.text, RULES.ANSWER_MAX);
  if (!text) fail("Type an answer first.");
  s = clone(s);
  s.answers[uid] = text;
  s.since = now;
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

/* Start without the players who have not answered. */
export function closeWriting(s, uid, args, now, rand) {
  if (s.phase !== "write") fail("Guessing has already started.");
  hostOrStalled(s, uid, now, "start without the others");
  s = clone(s);
  reveal(s, now, rand);
  return s;
}

/* ---------- guessing ---------- */

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
  s.since = now;
}

function knockOut(s, id, now) {
  /* A trip is over when everyone still hiding has had a turn. If this player
     had not had theirs yet this trip, the trip is one turn shorter. */
  var n = s.alive.length, ahead = (s.alive.indexOf(id) - s.alive.indexOf(s.turn) + n) % n;
  if (ahead < s.tripLeft) s.tripLeft -= 1;
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
  /* Naming someone for your own answer is allowed: a bluff that costs a try. */
  if (target === uid) fail("Guess someone else.");
  if (s.alive.indexOf(target) < 0) fail("That player is already caught.");
  s = clone(s);
  /* Two players who wrote the same thing are interchangeable. */
  var right = answer === target || same(s.answers[answer], s.answers[target]);
  happened(s, { kind: "guess", by: uid, answer: answer, target: target, ok: right });
  s.since = now;
  if (right) {
    s.found[answer] = target;
    s.players[uid].s += 1;
    knockOut(s, target, now);
  } else {
    s.misses += 1;
    if (s.misses >= s.allowed) passTurn(s, now);
  }
  return s;
}

/* The guesser passes their own turn; the host passes anyone's; any player
   may once the game has been quiet for STALL_MS. */
export function pass(s, uid, args, now) {
  if (s.phase !== "guess") fail("Nobody is guessing right now.");
  /* The page says whose turn it means to pass, so a tap that arrives after
     the turn has changed does not skip the next player. */
  if (args && args.turn && args.turn !== s.turn) fail("That turn is already over.");
  if (uid !== s.turn) hostOrStalled(s, uid, now, "pass someone else's turn");
  s = clone(s);
  happened(s, { kind: "pass", by: s.turn, answer: "", target: uid, ok: false });
  passTurn(s, now);
  return s;
}

/* ---------- host controls ---------- */

/* Take a player out of the game, wherever the round is. */
function takeOut(s, id, now, rand, quiet) {
  var name = s.players[id].n;
  delete s.players[id];
  delete s.base[id];
  s.inRound = s.inRound.filter(function (x) { return x !== id; });
  s.winners = s.winners.filter(function (x) { return x !== id; });
  s.votes = s.votes.filter(function (x) { return x !== id; });
  if (s.phase === "write") {
    delete s.answers[id];
    if (s.inRound.length && s.inRound.every(function (x) { return s.answers[x] !== undefined; })) reveal(s, now, rand);
  } else if (s.phase === "guess" && s.alive.indexOf(id) >= 0) {
    /* Their answer stays on the list as a decoy nobody can match. */
    if (!quiet) happened(s, { kind: "left", by: "", answer: name, target: "", ok: false });
    if (s.turn === id) passTurn(s, now);
    knockOut(s, id, now);
  } else {
    /* between rounds: every list of player ids must still name real players */
    s.alive = s.alive.filter(function (x) { return x !== id; });
    /* a tie at the target may have just been settled by this player going */
    if (s.phase === "done") settle(s);
  }
  return name;
}

export function remove(s, uid, args, now, rand) {
  var id = args && args.player;
  if (uid !== s.host) fail("Only the host can take someone out.");
  if (id === s.host) fail("The host cannot be taken out.");
  if (!s.players[id]) fail("That player has already left.");
  s = clone(s);
  takeOut(s, id, now, rand, false);
  return s;
}

/* How many votes replace the host: HOST_VOTES, or every other player if
   there are fewer than that. */
export function votesNeeded(s) {
  var others = Object.keys(s.players).filter(function (id) { return id !== s.host; }).length;
  return Math.max(1, Math.min(RULES.HOST_VOTES, others));
}

/* A player votes for a new host, or takes the vote back. With enough votes
   the host is taken out of the game and the longest-seated other player
   becomes host. The page says which it wants (args.on) and which host it
   means (args.host), so a late tap cannot flip a vote or hit a new host. A voter asking again once the count is reached
   (it can be reached by players leaving) completes the change. */
export function voteHost(s, uid, args, now, rand) {
  if (!s.players[uid]) fail("You are not in this game.");
  if (uid === s.host) fail("You are the host.");
  /* The page says which host the vote is about, so a vote that arrives after
     the host has changed is not counted against the new one. */
  if (args && args.host && args.host !== s.host) fail("The host has already changed.");
  s = clone(s);
  var has = s.votes.indexOf(uid) >= 0;
  var want = args && typeof args.on === "boolean" ? args.on : !has;
  if (!want) {
    s.votes = s.votes.filter(function (x) { return x !== uid; });
    return s;
  }
  if (!has) s.votes.push(uid);
  if (s.votes.length < votesNeeded(s)) return s;
  var old = s.host, oldName = s.players[old] ? s.players[old].n : "The host";
  s.host = seats(s).filter(function (id) { return id !== old; })[0];
  s.votes = [];
  if (s.players[old]) takeOut(s, old, now, rand, true);
  happened(s, { kind: "host", by: s.host, answer: oldName, target: "", ok: false });
  return s;
}

export function finish(s, uid) {
  if (uid !== s.host) fail("Only the host can end the game.");
  if (s.phase === "lobby" || s.phase === "over") fail("There is no game to end.");
  s = clone(s);
  s.phase = "over"; s.turn = ""; s.note = "host";
  /* Whoever is ahead wins; with no points scored, nobody does. */
  var top = leaders(s);
  s.winners = top.length && s.players[top[0]].s > 0 ? top : [];
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
