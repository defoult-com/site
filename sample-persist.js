/*
 * sample-persist.js — samples loaded into the app's sampler live only in
 * memory (partSamples[] holds decoded AudioBuffers), so they vanish on app
 * restart. This overlay persists the ORIGINAL file bytes in IndexedDB when a
 * sample is loaded and re-decodes them automatically on the next launch.
 * Injected before </body> (repo untouched); runs after the app's script.
 */
(function () {
  'use strict';
  if (!window.indexedDB) return;

  var DB = 'defoult-overlay';
  var STORE = 'samples';
  var storedKeys = {};      // pi -> true (mirror of what's in IDB)
  var restored = false;     // deletion-sync only runs after restore

  function openDb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () {
        if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbPut(pi, rec) {
    return openDb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(rec, pi);
        tx.oncomplete = function () { storedKeys[pi] = true; res(); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  function idbDel(pi) {
    return openDb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(pi);
        tx.oncomplete = function () { delete storedKeys[pi]; res(); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  function idbAll() {
    return openDb().then(function (db) {
      return new Promise(function (res, rej) {
        var st = db.transaction(STORE, 'readonly').objectStore(STORE);
        var keysReq = st.getAllKeys();
        var valsReq = st.getAll();
        var done = 0, keys, vals;
        var fin = function () { if (++done === 2) res(keys.map(function (k, i) { return { key: k, val: vals[i] }; })); };
        keysReq.onsuccess = function () { keys = keysReq.result; fin(); };
        valsReq.onsuccess = function () { vals = valsReq.result; fin(); };
        keysReq.onerror = valsReq.onerror = function (e) { rej(e); };
      });
    });
  }

  function readBytes(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = rej;
      fr.readAsArrayBuffer(file);
    });
  }

  function decodeBytes(bytes) {
    return new Promise(function (res, rej) {
      var ctx = (typeof getCtx === 'function') ? getCtx() : null;
      if (!ctx) return rej(new Error('no ctx'));
      try {
        // Copy: decodeAudioData detaches the buffer it's given.
        var p = ctx.decodeAudioData(bytes.slice(0), res, rej);
        if (p && typeof p.then === 'function') p.then(res, rej);
      } catch (e) { rej(e); }
    });
  }

  // ---- Hook the app's loader: persist bytes after a successful load --------
  function hook() {
    if (typeof window.loadSampleForPart !== 'function') return false;
    var orig = window.loadSampleForPart;
    window.loadSampleForPart = function (pi, file) {
      var r = orig.apply(this, arguments);
      Promise.resolve(r).then(function () {
        try {
          // orig sets the name only when decode succeeded.
          if (typeof partSampleNames !== 'undefined' && partSampleNames[pi] === file.name) {
            readBytes(file).then(function (bytes) {
              idbPut(pi, { name: file.name, bytes: bytes, t: Date.now() });
            }).catch(function () {});
          }
        } catch (e) {}
      }).catch(function () {});
      return r;
    };
    return true;
  }

  // ---- Restore on launch ----------------------------------------------------
  function restore() {
    idbAll().then(function (items) {
      items.forEach(function (it) { storedKeys[it.key] = true; });
      if (!items.length) { restored = true; return; }
      var ok = 0, pending = items.length;
      var finishOne = function () {
        if (--pending > 0) return;
        restored = true;
        if (ok > 0) {
          try {
            if (typeof setStatus === 'function') setStatus('Restored ' + ok + ' sample' + (ok > 1 ? 's' : ''));
            if (typeof buildSoundEditor === 'function' && typeof seOpen !== 'undefined' && seOpen) buildSoundEditor();
          } catch (e) {}
        }
      };
      var tryDecode = function (it, retryOnGesture) {
        decodeBytes(it.val.bytes).then(function (buf) {
          try {
            partSamples[it.key] = buf;
            partSampleNames[it.key] = it.val.name;
            ok++;
          } catch (e) {}
          finishOne();
        }, function () {
          if (retryOnGesture) {
            // Some WebKit builds refuse to decode while the AudioContext is
            // suspended pre-gesture — retry once on the first user tap.
            var once = function () {
              document.removeEventListener('pointerdown', once, true);
              tryDecode(it, false);
            };
            document.addEventListener('pointerdown', once, true);
          } else {
            finishOne();
          }
        });
      };
      items.forEach(function (it) { tryDecode(it, true); });
    }).catch(function () { restored = true; });
  }

  // ---- Mirror in-app sample clearing (e.g. reset-to-defaults) ---------------
  setInterval(function () {
    if (!restored || typeof partSampleNames === 'undefined') return;
    Object.keys(storedKeys).forEach(function (k) {
      var pi = +k;
      if (!partSampleNames[pi]) idbDel(pi).catch(function () {});
    });
  }, 4000);

  // ---- Init: wait for the app's globals -------------------------------------
  var tries = 0;
  var timer = setInterval(function () {
    if (hook()) { clearInterval(timer); restore(); }
    else if (++tries > 100) { clearInterval(timer); }
  }, 100);
})();
