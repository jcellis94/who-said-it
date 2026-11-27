# Handoff: "Who Said It" party game

You are taking over a small web project from another Claude session. The owner
works from a phone, is not a developer, and wants short, concrete answers. Read
this whole file before acting.

## State on 2026-11-27

**Version 2 ("Read it out") is live** at https://who-said-it-8eeaa.web.app,
deployed from branch `claude/bold-allen-05u2q8` (rules, then hosting) with the
owner's go-ahead. Checked on the live site as a guest: the page loads with no
errors and an unknown code reads "Can't find game". No real game has been
played on it yet. If a guest's guess is refused on the real project, suspect
the expression limit (see Data) and redeploy the previous commit's hosting and
rules while fixing it.

How version 2 came about: the owner played version 1 on real phones ("It all
works!"), then had a designer agent review the flow. The review is not in the
repository; its conclusions are built in and summarised here. The owner's
insight: the fun is reading aloud and pointing at people, which is lost if
everyone types and taps silently. They tested a house rule (one person reads
aloud, say the guess before tapping) and reported: "Reading aloud gets laughs.
Tapping after is fine to end the turn."

Next:

1. The owner plays one real game. A game created by version 1 cannot be continued by
   version 2; the page says "That game has ended."
2. Watch for the things the designer wanted tested with a real family: does
   the reader read aloud unprompted; how long until someone notices their
   turn; can the least confident player finish a guess alone; does anyone ask
   who a name belongs to; what a caught player does for a minute.
3. Later, delete the prototype's `rooms` block from `firestore.rules`.
4. Anonymous test accounts from the probes can be deleted in
   Authentication > Users.

To deploy: `npx firebase login --no-localhost` prints a link and a session
ID; the owner opens the link, checks the ID, signs in, and pastes back a
one-time code; then `npx firebase login <code>`, and
`npx firebase deploy --only firestore:rules` before `--only hosting`. The
cloud environment `who-said-it` already allows the hosts this needs.

## The game, as agreed with the owner

Source of each rule is marked: **said** (owner's words), **chose** (owner
picked it when asked), **mine** (a session's default the owner has seen and
not objected to).

- A signed-in (Google) host creates a game and gets a six-character code.
  Anyone joins with the code; sign-in is optional for them. (said)
- Each player gives a name before anything else: "What's your name tonight?",
  real or silly, with a "Give me a silly one" button. Everyone at the table
  knows who is who. (chose; replaces "Pick your character")
- A round has four steps: **write, read, guess, scores**.
- Write: every player sends one answer from their own phone. (said) No clock.
  (said: "I'm rethinking any timers now, pass is now doable by host or person
  guessing")
- Read: a reader shows the answers one at a time on every phone and reads
  them aloud, then guesses first. The reader rotates each round and can hand
  the job on with "Let someone else read". (chose, after the house-rule test)
- Guess: players take turns. Tap an answer, tap a name, then "That's my
  guess" under the words "Say it out loud!". Right: one point and another
  guess. Wrong: the turn moves to the next player in join order. A caught
  player is out of the guessing for the round. The last one hiding scores 2
  extra. (said / chose)
- You may name someone for your own answer, to throw people off; it is a
  wrong guess. (said: "You should be able to guess someone for your own
  answer to throw people")
- No turn clock. The guesser can pass; the host can pass anyone's turn and can
  start the reading without players who have not answered. (said)
- Quiet safety net: if nothing has happened for 2 minutes, every player gets
  the button the host has (skip the turn, or start without the missing
  players), so a missing host cannot freeze the game. If the reader does
  nothing for 20 seconds the next answer shows itself. (chose)
- After two full trips of the turn around the table, everyone gets 2 tries
  per turn; after two more, 3; never more ("second chances"). The owner's
  idea, and they expect to tune it. (said / chose)
- First to a target score wins; the host picks 5, 10, 15 or 20, default 10.
  Checked at the end of a round; level top scores play another round. Scores
  carry across rounds. (said / chose)
- The next round starts by itself 60 seconds after a round ends; the host
  normally starts it sooner and can swap or write the next topic first.
  (chose)
- The host can take a player out at any time; mid-round their answer stays on
  the list as a decoy. (chose)
- A late joiner plays from the next round. (chose)
- A guest who signs in with Google keeps their seat on any phone and gets a
  saved count of games won. (chose)
- Title "Who Said It"; the host picks a topic pack: General, Thanksgiving,
  Christmas. (chose)
- Words: hide and seek. Caught, still hiding, last one hiding, second
  chances. The screens do not say character, seat, trip or sit out. (chose)
- Mine: the host also plays; at most 20 players; two identical answers count
  for either writer; the host can end the
  game early; "Play again" keeps players and zeroes scores; every guess shows
  a three-second result on every phone, worded for the guesser, the person
  named and everyone else; a "So far" list keeps the last five guesses;
  scores are in the menu during a round; a buzz and a short sound on your
  turn where the phone allows, with a switch in the menu.

Not built from the designer's review, on purpose or for later: a TV screen
with a narrator voice (the owner's "Jackbox rendition", offered as a later
option); varying the "Things…" opening of the topics; showing real name and
silly name together.

All the numbers above are in one place: `RULES` at the top of `game.js`.

## Secrecy: what the owner decided

Asked whether authorship must be hidden from a determined player, the owner
answered: "this is a casual family game. If your talking about someone hacking
to win? I don't care forget it". So the simple design was built:

- The page never shows who wrote an unguessed answer, and shows no answers
  until everyone has sent one.
- The data does contain it. `answers` is keyed by the writer's id, and every
  phone in the game receives the whole game document. A player who opens
  developer tools can read who wrote what.
- The security rules stop a player from changing anyone else's seat, score or
  answer, the target, or the pack, and from scoring outside their own turn.
  They do not check that a claimed guess was right or whose turn comes next,
  so on their own turn such a player could take a point they did not earn.
  The emulator test states this as a check labelled "KNOWN LIMIT".
- If that ever matters, the stronger design is: answer texts in a document
  nobody can read until reveal, one author record per player readable only by
  that player, and a two-step guess (lock the guess in publicly, then record
  the result, which the security rules verify with `get()` on the author
  record). Free plan, no server code. It was designed and not built.

## Files

- `index.html`: the page. One classic script (`startWhoSaidIt(deps)`) plus a
  module script that loads the Firebase SDK from Google's CDN and the files
  below. All typed text is rendered with `textContent`. Keep it so.
- `game.js`: the rules of play as pure functions `(state, uid, args, now)`
  that return the next state or throw a `GameError` with a message for the
  player. No Firebase, no page.
- `topics.js`: the packs. Topics are original. Do not copy cards from any
  published game.
- `backend.js`: the only file that talks to Firebase.
  `makeBackend(sdk, config, options)` takes the SDK as an argument so the
  browser and the tests share it.
- `qr.js`: a vendored copy of `qrcode-generator` 1.4.4 (MIT, Kazuhiko Arase),
  unchanged, for the invite QR code. The page works without it.
- `firestore.rules`, `firebase.json`, `.firebaserc`: project
  `who-said-it-8eeaa`, Firestore Standard in `nam5`, Hosting serves the
  repository root.

## Data

- `games/{CODE}`: the whole game in one document. Fields are listed at the top
  of `game.js`.
- `users/{uid}`: `{ w: games won, g: games finished }`, Google users only.
- `rooms/...`: the prototype's data. Unused by the new page.

How writes work, and why:

- Most moves run in a Firestore transaction (`backend.act`): read the game,
  apply the move from `game.js`, write only the fields that changed.
- A player's own name and own answer are field writes with no transaction
  (`backend.put`), because everyone does those at the same moment and
  transactions on one document queue up (five simultaneous answers took eight
  seconds before this change). After sending an answer the phone asks for
  `allIn`, which hands the answers to the reader if nobody is missing. The
  rules refuse answer changes outside the write step.
- Things phones do by themselves (start the next round after the pause, show
  the next answer when the reader is quiet) name what they saw (the deadline,
  the answer count); `game.js` refuses the move if that has changed, so two
  phones cannot both act. The host's phone goes first, the others about a
  second later. Phones use their own clocks.
- Every event (guess, pass, player taken out) bumps `seq` and is stored in
  `last`; a phone shows the result moment when it sees `seq` change.
- The page takes the game state only from the live listener, never from the
  result of its own write. Keep that: the result can be older than what the
  listener already delivered.
- **The security rules have a hard limit of 1,000 evaluated expressions per
  request**, and one 30-field document uses most of it. A non-host player's
  guess is the most expensive path. Version 2 first hit the limit (every
  guest's guess was refused in the emulator) and the validator was rewritten
  to be cheap; the margin is now roughly 45 extra simple comparisons. Before
  adding a field or a check, measure: pad the rule with N copies of
  `after.round >= 0`, play a guest's guess in the emulator, and see where it
  starts failing. Production may count slightly differently from the emulator.

## What is tested and what is not

`npm install && npm test` (needs Java for the emulator):

- `test/game.test.mjs`: 27 tests of the rules on their own.
- `test/phones.mjs`: five simulated phones run the real page and real SDK
  against the Auth and Firestore emulators with the real rules: three rounds
  covering reading, the guess panel, result moments, passing, both safety
  nets, a changed topic, taking a player out, winning, saved wins and play
  again; then about 70 direct attacks on the rules. 161 checks, ending
  `all passed`; it ran clean six times in a row.

Also done once by hand for version 2: a round played in real phone-sized
Chromium (real module loading, light and dark) against the emulators, with no
page errors, no sideways scrolling, and the QR code drawn.

Not tested anywhere for version 2: anything on the real Firebase project
(including whether production counts rule expressions like the emulator); the
buzz, sound and screen-awake on real phones (iPhones do not vibrate for web
pages); scanning the QR code with a phone camera; more than five phones.

The security rules follow Firebase's `firestore-rules-creation` skill where
the expression limit allows (strict field count, types, sizes, immutable host
and creation time, per-player limits, its attack checklist as emulator tests).
The skill is not installed in cloud sessions; it was read from a clone of the
public repository `firebase/agent-skills`. The rules are a prototype: review
them before sharing the game widely.

## Limits to know about

- Games are never cleaned up, and there is no App Check.
- A removed player's phone returns to the character screen and can rejoin.
- A guest who signs in with Google after taking a seat gets a new seat; sign
  in first. The page only offers Google sign-in on the home screen.

## How to work with the owner

Lead with the result. Keep replies to a phone screen. Say plainly what is
tested and what is not. When you need something from them (a value, a tap in a
console), give numbered steps written for a phone browser, and explain any
choice in plain words with a recommendation. Asking a few multiple-choice
questions at a time, each with a recommended answer, worked well.

## Background

- An older no-backend version is live as a Claude artifact titled
  "Thanksgiving Things". It is not part of this repository. Do not merge them.
- The game is modeled on The Game of Things. Mechanics only; no cards, names
  or artwork from it.
