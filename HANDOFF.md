# Handoff: "Who Said It" party game (room-code version)

You are taking over a small web project from another Claude session. The owner
works from a phone, is not a developer, and wants short, concrete answers. This
file is everything the previous session knew. Read it all before acting.

## What the owner wants

A free, phone-friendly web page for playing a party game modeled on The Game of
Things at family gatherings. One person starts a game and gets a six-character
code; everyone who joins with the code shares one live game (round, answers,
guessed marks, players, scores). Any number of groups can play at once, each
with its own code. No accounts for players.

The game itself: a reader reads a "Things..." topic, everyone secretly writes an
answer on paper, the reader reads the answers aloud, and players take turns
guessing who wrote which. A right guess scores 1 point, knocks that writer out
of the round, and earns another guess; a wrong guess passes the turn left. The
last unguessed writer scores 2. The reader role passes left each round.

## State of the work

Done and in this repository:

- `index.html`: the whole app in one file (HTML, CSS, JS, 60 original topics).
  No build step, no dependencies. Talks to Firebase Realtime Database over its
  REST API (`fetch` for writes, `EventSource` for the live stream).
- `database.rules.json`: Realtime Database security rules.
- `test/three-phones.js`: simulation of three phones against an in-memory mock
  of the Firebase REST + streaming API. Passes. Run with
  `npm i jsdom && node test/three-phones.js`; every numbered line should read
  as a pass (compare against the expectations listed under "Test" below).

Not done:

1. **Database address.** `index.html` has one placeholder, `"__DB_URL__"`, on
   the `var DB_URL = ...` line. Replace it with the real address. Until then
   the page shows an "Almost ready" panel and nothing else.
2. **Firebase side is unconfirmed.** The owner created Firebase project
   "Who-said-it", project ID `who-said-it-8eeaa`. The likely address is
   `https://who-said-it-8eeaa-default-rtdb.firebaseio.com`, but when the
   previous session requested `/rooms/AAAAAA.json` there it got a 4xx error.
   So either the Realtime Database instance does not exist yet (a new project
   has none; it is a different product from Cloud Firestore), or the rules in
   `database.rules.json` are not published. The owner was last using the
   "Gemini in Firebase" panel to do these two things and report the exact URL.
   Ask the owner for that report; do not assume the URL pattern.
3. **Hosting.** Plan: GitHub Pages from this repository's default branch,
   serving `index.html` from the root. Enable Pages, then give the owner the
   URL.
4. **First real test.** Nothing has run against a real Firebase database or on
   a real phone. After hosting, check: with the rules published,
   `GET <db>/rooms/AAAAAA.json` returns `null` with status 200; starting a game
   on one device and joining by code on another shows changes both ways within
   a second or so.

## How the app works

- Views: `#setup` (no database configured), `#lobby` (join by code or start a
  game), `#game`.
- A room lives at `/rooms/<CODE>` where CODE matches `^[A-Z2-9]{6}$`. The code
  is also the URL hash, so the invite link is `<page url>#<CODE>`; the last
  code is remembered in `localStorage` under `things-live-code`.
- Room data:
  - `created`: number (ms)
  - `round`: number, 1 to 60 (index into TOPICS)
  - `players/<id>`: `{ n: name, s: score }`
  - `answers/r<round>/<id>`: `{ t: text, g: guessed? }`
  - `out/r<round>/<playerId>`: `true` while that player is guessed this round
  - Ids come from `newId()`: base-36 timestamp plus random characters, so
    sorting keys gives creation order (seat order for players). Round keys are
    prefixed with `r` on purpose: purely numeric keys can come back from
    Firebase as arrays.
- Every change goes through `write(path, value)`: update the local cache,
  re-render, then `PUT` that path. The stream echoes it to every phone.
- `pending` + `incoming()` guard against a real bug found in testing: with
  network lag, the echo of an older write would briefly undo a newer local one,
  so rapid +1 taps lost points and an answer added right after tapping Next
  landed in the wrong round. While a path has unechoed local writes, older
  values arriving for it are skipped. Stale entries are swept after 5 seconds
  and trigger a full re-fetch (`resync`). `canon()` compares values with sorted
  keys because the server may reorder object keys. Keep this logic if you
  refactor.
- All user-entered text is rendered with `textContent`. Keep it that way.

## Security model, and its limits

The code is the only gate. The rules allow unauthenticated read and write to
any room whose six-character code is known, and nothing above `/rooms/<CODE>`
is readable, so codes cannot be listed. Validation caps string lengths and
rejects unknown fields. This is deliberate: the owner wants no sign-in for
players. It suits a party game and nothing private. Firebase may email a
warning about open rules; that is expected. The rules have not been published
to a real database yet, so a syntax complaint from the console is possible:
fix the syntax, keep the intent.

Free-tier facts checked on 2026-11-26: the Spark plan allows 100 simultaneous
Realtime Database connections; each open phone holds one.

## Test

`test/three-phones.js` expectations: lobby shows first; an unknown code is
refused with a message; starting a game yields a valid code, sets the hash and
goes Live; a second phone joins from the link; players, round and answers
added on phone A appear on B; marks and scores made on B appear on A; five
rapid +1 taps give 5 on both phones; three rapid Next taps then an immediate
answer end on the same round everywhere with the answer in that round; the
next round clears "out" marks; remove-player and zero-scores propagate; a late
joiner typing the code in lowercase gets current state; leaving returns to the
lobby; no HTML from user text is injected; an unconfigured page shows setup.

## Background you should know

- A simpler, older version is live as a Claude artifact titled "Thanksgiving
  Things". It has no backend: the owner's phone republishes the page to "sync".
  It was the stopgap for Thanksgiving 2026 and is not part of this repository.
  Do not try to merge the two.
- The page title is still "Thanksgiving Things" and about half the 60 topics
  are Thanksgiving-themed. The owner named the Firebase project "who said it",
  so a rename and a more general topic set are likely requests. Ask before
  renaming.
- Topics are original. Do not copy cards from the real game.
- Ideas raised but not decided: players submitting answers secretly from their
  own phones instead of paper (would need per-player identity and a reveal
  step); topic packs for other occasions.

## How to work with the owner

Lead with the result. Keep replies to a phone screen. Say plainly what is
tested and what is not. When you need something from them (a URL, a tap in a
console), give numbered steps written for a phone browser.
