/* ALVéON storage: everything lives in this device's IndexedDB, so it works with no connection. */
(function(){
  var AV = window.AV = window.AV || {};

  AV.util = {
    clamp: function(x, a, b){ return Math.max(a, Math.min(b, x)); },
    fmt: function(s){ s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); },
    uid: function(p){ return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },
    hash: function(s){ var h = 7; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; },
    $: function(id){ return document.getElementById(id); }
  };

  var dbp = null;
  function open(){
    if (!dbp) dbp = new Promise(function(res, rej){
      var r = indexedDB.open('alveon', 1);
      r.onupgradeneeded = function(){
        var d = r.result;
        d.createObjectStore('albums', { keyPath: 'id' });
        var t = d.createObjectStore('tracks', { keyPath: 'id' });
        t.createIndex('album', 'albumId');
        d.createObjectStore('meta', { keyPath: 'k' });
      };
      r.onsuccess = function(){ res(r.result); };
      r.onerror = function(){ rej(r.error); };
    });
    return dbp;
  }
  function run(stores, mode, fn){
    return open().then(function(d){
      return new Promise(function(res, rej){
        var t = d.transaction(stores, mode), out = fn(t);
        t.oncomplete = function(){ res(out && 'result' in out ? out.result : out); };
        t.onerror = function(){ rej(t.error); };
        t.onabort = function(){ rej(t.error); };
      });
    });
  }

  AV.db = {
    all: function(store){ return run(store, 'readonly', function(t){ return t.objectStore(store).getAll(); }); },
    put: function(store, obj){ return run(store, 'readwrite', function(t){ return t.objectStore(store).put(obj); }); },
    putMany: function(store, list){
      return run(store, 'readwrite', function(t){ var s = t.objectStore(store); list.forEach(function(o){ s.put(o); }); });
    },
    del: function(store, id){ return run(store, 'readwrite', function(t){ return t.objectStore(store).delete(id); }); },
    delAlbum: function(albumId, trackIds){
      return run(['albums', 'tracks'], 'readwrite', function(t){
        t.objectStore('albums').delete(albumId);
        var s = t.objectStore('tracks');
        trackIds.forEach(function(id){ s.delete(id); });
      });
    },
    getMeta: function(k){ return run('meta', 'readonly', function(t){ return t.objectStore('meta').get(k); }).then(function(r){ return r && r.v; }); },
    setMeta: function(k, v){ return AV.db.put('meta', { k: k, v: v }); }
  };

  /* Ask the browser not to evict this data when space runs low. */
  AV.keepData = function(){
    try { if (navigator.storage && navigator.storage.persist) return navigator.storage.persist(); } catch (e) {}
    return Promise.resolve(false);
  };
})();
