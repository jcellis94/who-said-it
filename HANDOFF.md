# Handoff: "Who Said It" party game

You are taking over a small web project from another Claude session. The owner
works from a phone, is not a developer, and wants short, concrete answers. Read
this whole file before acting.

## What the owner wants

A free, phone-friendly web page for playing a party game modeled on The Game of
Things at family gatherings, run the way Jackbox runs a room: one host signs in
with Google and starts a game, which gets a six-character code; everyone else
joins with the code and no account. All phones share one live game (round,
answers, guessed marks, players, scores). Any number of groups can play at
once, each with its own code.

The game itself: a reader reads a "Things..." topic, everyone secretly writes an
answer on paper, the reader reads the answers aloud, and players take turns
guessing who wrote which. A right guess scores 1 point, knocks that writer out
of the round, and earns another guess; a wrong guess passes the turn left. The
last unguessed writer scores 2. The reader role passes left each round.

## State of the work

Done and in this repository:

- `index.html`: page, styles, 60 original topics and all game logic. No build
  step. It never touches Firebase directly; it calls the adapter.
- `backend.js`: the only file that talks to Firebase (Auth + Cloud Firestore).
  `makeBackend(sdk, config, options)` takes the SDK functions as an argument, so
  the same file runs in the browser (SDK imported from Google's CDN by the
  module script at the bottom of `index.html`) and in the tests (SDK from npm).
- `firestore.rules`: Firestore Security Rules. `firebase.json` and
  `.firebaserc` point the Firebase CLI at them and at project
  `who-said-it-8eeaa`.
- `test/three-phones.mjs`: three simulated phones run the real page with the
  real Firebase SDK against the Auth and Firestore emulators with the real
  rules loaded, then attack the rules directly. Run `npm install && npm test`.
  It needs Java (for the emulator) and ends with `all passed`.

Done in the real Firebase project `who-said-it-8eeaa` on 2026-11-27 (via the
Firebase CLI, logged in by the owner for that session only):

- Web app registered; its config is in `index.html`.
- Firestore database `(default)` created: Standard edition, location `nam5`.
- `firestore.rules` published.
- Google and Anonymous sign-in enabled.
- Checked against the real project as a guest: anonymous sign-in works, an
  unknown room reads as missing, and the rules refuse a guest creating a room,
  listing rooms, and writing elsewhere.

Not done:

1. **Hosting.** `firebase.json` is ready for Firebase Hosting (serves
   `index.html` and `backend.js` at `who-said-it-8eeaa.web.app`, an address
   already authorized for sign-in). The deploy
   (`npx firebase deploy --only hosting`) needs the owner's explicit go-ahead
   and a Firebase CLI login. GitHub Pages is the alternative; it also needs
   `jcellis94.github.io` added under Authentication > Settings > Authorized
   domains.
2. **First real test** on two phones: host signs in with Google and starts a
   game, guest joins by code, changes show both ways within a second or so.
3. Three leftover anonymous test accounts in Authentication > Users from the
   2026-11-27 probes can be deleted.

## What is tested and what is not

Tested (emulator): the join and start flows, every game action syncing between
phones, rapid taps, and 26 rule refusals. Also checked once in headless
Chromium: the page loads the SDK modules and reaches the lobby.

Not tested anywhere: the real Google sign-in popup on a phone, the SDK loading
from `www.gstatic.com/firebasejs/13.4.0/` (the cloud container blocks that
host; the files were served locally instead), and anything against the real
project.

## How the app works

- Views: `#setup` (no config), `#lobby` (join by code, or sign in and start),
  `#game`.
- Joining signs the phone in anonymously, then reads `rooms/<CODE>`. Starting
  signs in with a Google popup, then creates the room. The code is also the URL
  hash, so the invite link is `<page url>#<CODE>`; the last code is remembered
  in `localStorage` under `things-live-code`.
- Data (Firestore):
  - `rooms/<CODE>`: `{ host: uid, created: timestamp, round: 1..500 }`
  - `rooms/<CODE>/players/<id>`: `{ n: name, s: score, o: round the player was
    guessed out in, 0 for none }`
  - `rooms/<CODE>/answers/<id>`: `{ r: round, t: text, g: guessed }`
  - Ids come from `newId()`: 9 base-36 timestamp characters plus 6 random ones,
    so sorting ids gives creation order (seat order for players).
- Three listeners per phone: the room, its players, and the answers for the
  current round (re-subscribed when the round changes).
- Scores change with Firestore `increment`, so taps from two phones add up.
- Round changes are applied on the phone first. While one is unconfirmed
  (`roundWrites > 0`), that phone ignores older round numbers arriving from the
  database, so rapid Next taps are not undone. Keep this if you refactor.
- All user-entered text is rendered with `textContent`. Keep it that way.

## Security model, and its limits

Everyone must be signed in: hosts with Google, guests anonymously. Only a
Google user can create a room. Rooms can be fetched by code and never listed,
so the code is what admits a guest. Any signed-in person who knows a code can
run that game (round, players, scores, answers); that is deliberate. The rules
fix field names, types and sizes, keep names and answer text immutable, limit a
score change to -1, +1, +2 or a reset to 0, and forbid deleting rooms.

Limits: nothing caps how many players or answers a code-holder can add, rooms
are never cleaned up, and there is no App Check. The rules are a prototype and
should be reviewed before the page is shared widely.

## Background you should know

- A simpler, older version is live as a Claude artifact titled "Thanksgiving
  Things". It has no backend and is not part of this repository. Do not merge
  the two.
- An earlier version of this repo used Realtime Database with no sign-in. The
  owner replaced that with Auth + Firestore on 2026-11-27.
- The page title is still "Thanksgiving Things" and about half the 60 topics
  are Thanksgiving-themed. A rename to "Who Said It" and general topics has
  been offered and not yet answered. Ask before renaming.
- Topics are original. Do not copy cards from the real game.
- Ideas raised but not decided: players submitting answers secretly from their
  own phones instead of paper; topic packs for other occasions; host-only
  controls.

## How to work with the owner

Lead with the result. Keep replies to a phone screen. Say plainly what is
tested and what is not. When you need something from them (a value, a tap in a
console), give numbered steps written for a phone browser, and explain any
choice in plain words with a recommendation.
