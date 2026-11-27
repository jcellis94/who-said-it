# Handoff: "Who Said It" party game

You are taking over a small web project from another Claude session. The owner
works from a phone, is not a developer, and wants short, concrete answers. Read
this whole file before acting.

## State on 2026-11-27

**Live.** The redesign is deployed at https://who-said-it-8eeaa.web.app
(rules first, then hosting, both from branch `claude/bold-allen-05u2q8`, with
the owner's go-ahead and a one-session Firebase CLI login).

Checked on the live site as a guest, in a phone-sized browser: the page loads
the Firebase SDK from Google's CDN with no errors, a guest is signed in
anonymously, and an unknown code reads as "No game has the code".

Next:

1. The owner plays one real game on two phones. Google sign-in on a real
   phone and a full round against the real project have not been tested.
2. Later, delete the prototype's `rooms` block from `firestore.rules` and
   redeploy the rules. It is unchanged and harmless until then.
3. Anonymous test accounts from the probes (three from the prototype, one from
   this deploy check) can be deleted in Authentication > Users.

To deploy again: `npx firebase login --no-localhost` prints a link and a
session ID; the owner opens the link, checks the ID, signs in, and pastes back
a one-time code; then `npx firebase login <code>`, and
`npx firebase deploy --only firestore:rules` before `--only hosting`. The
cloud environment `who-said-it` already allows the hosts this needs.

## The game, as agreed with the owner

Source of each rule is marked: **said** (owner's words), **chose** (owner picked
it when asked, on 2026-11-27), **mine** (this session's default; the owner saw
the list and did not object, but did not pick it).

- A signed-in (Google) host creates a game and gets a six-character code.
  Anyone joins with the code; sign-in is optional for them. (said)
- Each player picks a character name before anything else. (said) Everyone at
  the table knows who is which character; it is just a fun name. (chose)
- Each round has a topic. Every player sends one answer from their own phone.
  (said) Answers appear on every phone, shuffled, once everyone has sent one.
  (chose)
- Players take turns guessing which character wrote which answer. Right: one
  point and another guess. Wrong: the turn passes to the next player in join
  order. A guessed player is out for the round and grayed out. The last
  unguessed player scores 2 extra. (said / chose)
- Timers: 90 seconds to write; players who have not answered sit that round
  out. 45 seconds per turn; then the turn passes. The host can also start the
  guessing or skip a turn early. (chose)
- After two full trips of the turn around the table, everyone gets 2 wrong
  guesses per turn; after two more, 3; never more. The owner's idea, and they
  expect to tune it: "Will need to play with thresholds." (said / chose)
- First to a target score wins; the host picks 5, 10, 15 or 20, default 10.
  It is checked at the end of a round; level top scores play another round.
  Scores carry across rounds. (said / chose)
- The host can remove a player at any time; mid-round their answer stays on
  the list as a decoy. (chose)
- A late joiner plays from the next round. (chose)
- If the host is gone, timers carry the game: the next round starts by itself
  20 seconds after a round ends. (chose)
- A guest who signs in with Google keeps their seat on any phone and gets a
  saved count of games won. (chose)
- Title "Who Said It"; the host picks a topic pack: General, Thanksgiving,
  Christmas. (chose)
- Mine: the host also plays; the app draws the topic and the host can redraw
  or type one; the first guesser rotates each round; at most 20 players; two
  identical answers count for either writer; you cannot pick your own answer;
  the host can end the game early; "Play again" keeps players, zeroes scores.

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
  module script that loads the Firebase SDK from Google's CDN and the three
  files below. All typed text is rendered with `textContent`. Keep it so.
- `game.js`: the rules of play as pure functions `(state, uid, args, now)`
  that return the next state or throw a `GameError` with a message for the
  player. No Firebase, no page.
- `topics.js`: the packs. Topics are original. Do not copy cards from any
  published game.
- `backend.js`: the only file that talks to Firebase.
  `makeBackend(sdk, config, options)` takes the SDK as an argument so the
  browser and the tests share it.
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
- A player's own seat and own answer are single-field writes with no
  transaction (`backend.put`), because everyone does those at the same moment
  and transactions on one document queue up (five simultaneous answers took
  eight seconds before this change). After sending an answer the phone asks
  for `allIn`, which starts the guessing if nobody is missing. The rules
  refuse answer changes outside the write step.
- Timers have no server. The game stores a `deadline`; when it passes, the
  phone it concerns (host or turn holder) makes the move, and the other phones
  try about a second later in case that phone is gone. A clock move names the
  deadline it saw and `game.js` refuses it if the clock has moved on, so two
  phones cannot both act on one expired clock. Phones use their own clocks; a
  phone whose clock is far off will show the wrong countdown.
- The page takes the game state only from the live listener, never from the
  result of its own write. Keep that: the result can be older than what the
  listener already delivered.

## What is tested and what is not

`npm install && npm test` (needs Java for the emulator):

- `test/game.test.mjs`: 23 tests of the rules on their own.
- `test/phones.mjs`: five simulated phones run the real page and real SDK
  against the Auth and Firestore emulators with the real rules: three rounds
  including the timers, removal, winning, saved wins and play again; then 70
  direct attacks on the rules. 123 checks, ending `all passed`.

Also done once by hand in this session: a round played in real phone-sized
Chromium (real module loading, light and dark) against the emulators, with no
page errors and no sideways scrolling.

Not tested anywhere: a game played on the real Firebase project; the real
Google sign-in popup on a phone; more than five phones; phones with bad
connections or wrong clocks.

The security rules follow Firebase's `firestore-rules-creation` skill
(validators shared by create and update, strict field lists, size limits,
immutable host and creation time, its attack checklist run as emulator tests).
The skill is not installed in cloud sessions; it was read from a clone of the
public repository `firebase/agent-skills` (`skills/firestore-rules-creation/
SKILL.md`). Do the same if the plugin is missing. Firebase's compiler
accepted them (`deploy --only firestore:rules --dry-run`) before they were
published. The rules are a prototype: review them before sharing the game widely.

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
