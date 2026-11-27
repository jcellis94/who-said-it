// backend.js against a stand-in for the Firebase SDK. Run by `npm test`.
import test from "node:test";
import assert from "node:assert/strict";
import { makeBackend } from "../backend.js";

// An SDK whose saved sign-in arrives a moment after the page starts, as it
// does in a real browser on reload.
function slowSdk(savedUser, restoreAfterMs) {
  const auth = { currentUser: null }, listeners = [], calls = [];
  setTimeout(() => { auth.currentUser = savedUser; listeners.forEach(fn => fn(savedUser)); }, restoreAfterMs);
  return {
    calls,
    initializeApp: () => ({}), getAuth: () => auth, getFirestore: () => ({}),
    onAuthStateChanged(a, fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    signInAnonymously() { calls.push("anonymous"); auth.currentUser = { uid: "new-guest", isAnonymous: true, providerData: [] }; return Promise.resolve({ user: auth.currentUser }); }
  };
}

test("a reload does not replace the saved Google user with a new guest", async () => {
  const host = { uid: "host-uid", isAnonymous: false, displayName: "Jordan", providerData: [{ providerId: "google.com" }] };
  const sdk = slowSdk(host, 30);
  const be = makeBackend(sdk, {});
  const who = await be.signInGuest();   // called at once, as the page does for a link with a code
  assert.deepEqual(who, { uid: "host-uid", google: true, name: "Jordan" });
  assert.deepEqual(sdk.calls, [], "no anonymous sign-in happened");
});

test("a reload keeps a guest's own anonymous user", async () => {
  const guest = { uid: "guest-uid", isAnonymous: true, providerData: [] };
  const sdk = slowSdk(guest, 30);
  const who = await makeBackend(sdk, {}).signInGuest();
  assert.equal(who.uid, "guest-uid"); assert.deepEqual(sdk.calls, []);
});

test("a phone with nobody saved is signed in as a new guest", async () => {
  const sdk = slowSdk(null, 10);
  const who = await makeBackend(sdk, {}).signInGuest();
  assert.equal(who.uid, "new-guest"); assert.deepEqual(sdk.calls, ["anonymous"]);
});
