/* The only file that talks to Firebase. The page calls the functions returned
   here and knows nothing about Firestore or Auth; the rules of the game live
   in game.js and know nothing about Firebase either.

   makeBackend(sdk, config, options)
     sdk      the Firebase functions, passed in so this file runs unchanged in
              the browser (CDN imports) and in the emulator tests (npm imports)
     config   the web app's firebaseConfig
     options  { appName, googleSignIn(auth), setup(app, auth, db) } for tests

   Data (see firestore.rules):
     games/{CODE}   the whole game, one document (fields listed in game.js)
     users/{uid}    { w: games won, g: games finished }, Google users only */

export function makeBackend(sdk, config, options) {
  options = options || {};
  var app = sdk.initializeApp(config, options.appName || "[DEFAULT]");
  var auth = sdk.getAuth(app);
  var db = sdk.getFirestore(app);
  if (options.setup) options.setup(app, auth, db);

  var googleSignIn = options.googleSignIn || function (a) {
    return sdk.signInWithPopup(a, new sdk.GoogleAuthProvider());
  };

  function game(code) { return sdk.doc(db, "games", code); }
  function user(uid) { return sdk.doc(db, "users", uid); }

  function isGoogle(u) {
    return !!u && !u.isAnonymous && u.providerData.some(function (p) {
      return p.providerId === "google.com";
    });
  }
  function describe(u) {
    return u ? { uid: u.uid, google: isGoogle(u), name: u.displayName || "" } : null;
  }

  return {
    /* ---- who is using this phone ---- */
    onUser: function (cb) {
      return sdk.onAuthStateChanged(auth, function (u) { cb(describe(u)); });
    },
    signInGoogle: function () {
      return googleSignIn(auth).then(function (r) { return describe(r.user); });
    },
    /* No account: an anonymous sign-in the player never sees. */
    signInGuest: function () {
      if (auth.currentUser) return Promise.resolve(describe(auth.currentUser));
      return sdk.signInAnonymously(auth).then(function (r) { return describe(r.user); });
    },
    signOut: function () { return sdk.signOut(auth); },

    /* ---- games ---- */
    getGame: function (code) {
      return sdk.getDoc(game(code)).then(function (s) { return s.exists() ? s.data() : null; });
    },
    createGame: function (code, state) {
      return sdk.setDoc(game(code), Object.assign({}, state, { created: sdk.serverTimestamp() }));
    },
    watchGame: function (code, onData, onError) {
      return sdk.onSnapshot(game(code), function (s) {
        onData(s.exists() ? s.data() : null);
      }, onError);
    },
    /* Apply one move from game.js. The transaction re-runs the move if another
       phone changed the game first, so no move is applied to a stale state.
       Only what the move changed is written, and players one seat at a time,
       so two people taking a seat at the same moment do not collide. */
    act: function (code, move) {
      var ref = game(code);
      return sdk.runTransaction(db, function (tx) {
        return tx.get(ref).then(function (snap) {
          if (!snap.exists()) throw new Error("That game no longer exists.");
          var before = snap.data(), next = move(before), args = [];
          function differs(a, b) { return JSON.stringify(a) !== JSON.stringify(b); }
          Object.keys(next).forEach(function (k) {
            if (k === "created" || k === "players" || !differs(before[k], next[k])) return;
            args.push(new sdk.FieldPath(k), next[k]);
          });
          Object.keys(next.players).forEach(function (id) {
            if (differs(before.players[id], next.players[id])) args.push(new sdk.FieldPath("players", id), next.players[id]);
          });
          Object.keys(before.players).forEach(function (id) {
            if (!next.players[id]) args.push(new sdk.FieldPath("players", id), sdk.deleteField());
          });
          if (args.length) tx.update.apply(tx, [ref].concat(args));
          return next;
        });
      }, { maxAttempts: 10 });
    },
    /* Write one field without reading first: a player's own seat or answer.
       Everyone does these at the same moment (joining, the last seconds of
       the write clock), and transactions on one document would queue up. */
    put: function (code, path, value) {
      return sdk.updateDoc(game(code), new sdk.FieldPath(path[0], path[1]), value);
    },

    /* ---- saved wins (Google users only) ---- */
    watchStats: function (uid, onData) {
      return sdk.onSnapshot(user(uid), function (s) {
        onData(s.exists() ? s.data() : { w: 0, g: 0 });
      }, function () { onData(null); });
    },
    /* Once per finished game: add it to this user's counts. */
    creditGame: function (code) {
      var u = auth.currentUser;
      if (!isGoogle(u)) return Promise.resolve(false);
      var gref = game(code), uref = user(u.uid);
      return sdk.runTransaction(db, function (tx) {
        return tx.get(gref).then(function (gs) {
          return tx.get(uref).then(function (us) {
            var g = gs.exists() ? gs.data() : null;
            if (!g || g.phase !== "over" || !g.players[u.uid] || g.credited.indexOf(u.uid) >= 0) return false;
            var have = us.exists() ? us.data() : { w: 0, g: 0 };
            var won = g.winners.indexOf(u.uid) >= 0;
            tx.set(uref, { w: have.w + (won ? 1 : 0), g: have.g + 1 });
            tx.update(gref, { credited: g.credited.concat([u.uid]) });
            return true;
          });
        });
      });
    }
  };
}
