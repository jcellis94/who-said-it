/* The only file that talks to Firebase. index.html's game code calls the
   functions returned here and knows nothing about Firestore or Auth.

   makeBackend(sdk, config, options)
     sdk      the Firebase functions, passed in so this file runs unchanged in
              the browser (CDN imports) and in the emulator tests (npm imports)
     config   the web app's firebaseConfig
     options  { appName, googleSignIn(auth), setup(app, auth, db) } for tests

   Data model (see firestore.rules):
     rooms/{CODE}                { host, created, round }
     rooms/{CODE}/players/{id}   { n: name, s: score, o: round guessed out in, 0 = none }
     rooms/{CODE}/answers/{id}   { r: round, t: text, g: guessed } */

export function makeBackend(sdk, config, options) {
  options = options || {};
  var app = sdk.initializeApp(config, options.appName || "[DEFAULT]");
  var auth = sdk.getAuth(app);
  var db = sdk.getFirestore(app);
  if (options.setup) options.setup(app, auth, db);

  var googleSignIn = options.googleSignIn || function (a) {
    return sdk.signInWithPopup(a, new sdk.GoogleAuthProvider());
  };

  function room(code) { return sdk.doc(db, "rooms", code); }
  function player(code, id) { return sdk.doc(db, "rooms", code, "players", id); }
  function answer(code, id) { return sdk.doc(db, "rooms", code, "answers", id); }

  function isHost(u) {
    return !!u && !u.isAnonymous && u.providerData.some(function (p) {
      return p.providerId === "google.com";
    });
  }
  function describe(u) {
    return u ? { uid: u.uid, host: isHost(u), name: u.displayName || "" } : null;
  }
  function toMap(snapshot) {
    var out = {};
    snapshot.forEach(function (d) { out[d.id] = d.data(); });
    return out;
  }
  function batchOver(ids, apply) {
    var chunks = [];
    for (var i = 0; i < ids.length; i += 400) chunks.push(ids.slice(i, i + 400));
    return Promise.all(chunks.map(function (chunk) {
      var b = sdk.writeBatch(db);
      chunk.forEach(function (id) { apply(b, id); });
      return b.commit();
    }));
  }

  return {
    /* ---- who is using this phone ---- */
    onUser: function (cb) {
      return sdk.onAuthStateChanged(auth, function (u) { cb(describe(u)); });
    },
    signInHost: function () {
      return googleSignIn(auth).then(function (r) { return describe(r.user); });
    },
    signInGuest: function () {
      if (auth.currentUser) return Promise.resolve(describe(auth.currentUser));
      return sdk.signInAnonymously(auth).then(function (r) { return describe(r.user); });
    },
    signOut: function () { return sdk.signOut(auth); },

    /* ---- rooms ---- */
    getRoom: function (code) {
      return sdk.getDoc(room(code)).then(function (s) { return s.exists() ? s.data() : null; });
    },
    createRoom: function (code) {
      return sdk.setDoc(room(code), {
        host: auth.currentUser.uid,
        created: sdk.serverTimestamp(),
        round: 1
      });
    },
    setRound: function (code, n) { return sdk.updateDoc(room(code), { round: n }); },

    /* ---- live updates: each returns a function that stops listening ---- */
    watchRoom: function (code, onData, onError) {
      return sdk.onSnapshot(room(code), { includeMetadataChanges: true }, function (s) {
        onData(s.exists() ? s.data() : null, !s.metadata.fromCache);
      }, onError);
    },
    watchPlayers: function (code, onData, onError) {
      return sdk.onSnapshot(sdk.collection(db, "rooms", code, "players"), function (s) {
        onData(toMap(s));
      }, onError);
    },
    watchAnswers: function (code, round, onData, onError) {
      var q = sdk.query(sdk.collection(db, "rooms", code, "answers"), sdk.where("r", "==", round));
      return sdk.onSnapshot(q, function (s) { onData(toMap(s)); }, onError);
    },

    /* ---- players ---- */
    addPlayer: function (code, id, name) {
      return sdk.setDoc(player(code, id), { n: name, s: 0, o: 0 });
    },
    removePlayer: function (code, id) { return sdk.deleteDoc(player(code, id)); },
    bumpScore: function (code, id, delta) {
      return sdk.updateDoc(player(code, id), { s: sdk.increment(delta) });
    },
    zeroScores: function (code, ids) {
      return batchOver(ids, function (b, id) { b.update(player(code, id), { s: 0 }); });
    },
    setOut: function (code, id, round) {
      return sdk.updateDoc(player(code, id), { o: round });
    },

    /* ---- answers ---- */
    addAnswer: function (code, id, round, text) {
      return sdk.setDoc(answer(code, id), { r: round, t: text, g: false });
    },
    setGuessed: function (code, id, on) {
      return sdk.updateDoc(answer(code, id), { g: on });
    },
    clearAnswers: function (code, ids) {
      return batchOver(ids, function (b, id) { b.delete(answer(code, id)); });
    }
  };
}
