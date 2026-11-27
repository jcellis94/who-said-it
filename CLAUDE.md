# who-said-it

A party game web page backed by Firebase Authentication and Cloud Firestore: `index.html` (the page), `game.js` (the rules of play, no Firebase), `topics.js` (topic packs) and `backend.js` (the only file that talks to Firebase). Run `npm install && npm test` after changing any of them or `firestore.rules`. Read `HANDOFF.md` for the current state and how to work with the owner.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `jcellis94/who-said-it`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root, created when first needed. See `docs/agents/domain.md`.
