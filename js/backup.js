/* ALVéON backup: the whole library (albums, covers, details, songs and their audio) in one file you keep.
   File layout:  "ALVEON01" (8 bytes) | header length (4 bytes, little endian) | header JSON | audio and cover bytes.
   The header lists every album, song and setting, and says where each cover or song starts inside the bytes. */
(function(){
  var AV = window.AV = window.AV || {};
  var MAGIC = 'ALVEON01', VERSION = 1;

  function u32(n){ var b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; }
  function clone(o){ var c = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) c[k] = o[k]; return c; }
  function isBlob(x){ return typeof Blob !== 'undefined' && x instanceof Blob; }
  function tick(){ return new Promise(function(r){ setTimeout(r, 0); }); }

  /* ---------- export ---------- */
  function build(progress){
    return Promise.all([AV.db.all('albums'), AV.db.all('tracks'), AV.db.all('meta')]).then(function(r){
      var albums = r[0], tracks = r[1], meta = r[2], parts = [], off = 0, files = 0;
      function ref(b, extra){
        var o = { o: off, l: b.size, t: b.type || '' };
        if (extra && b.name) o.n = b.name;
        if (extra && b.lastModified) o.m = b.lastModified;
        parts.push(b); off += b.size; files++; return o;
      }
      var outAlbums = albums.map(function(a){ var c = clone(a); c.cover = isBlob(a.cover) ? ref(a.cover, false) : null; return c; });
      var outTracks = tracks.map(function(t){ var c = clone(t); c.blob = isBlob(t.blob) ? ref(t.blob, true) : null; return c; });
      var head = {
        format: 'alveon-backup', version: VERSION, app: 'ALVéON', created: new Date().toISOString(),
        counts: { albums: albums.length, tracks: tracks.length, meta: meta.length, files: files },
        payloadBytes: off, albums: outAlbums, tracks: outTracks, meta: meta
      };
      var json = new TextEncoder().encode(JSON.stringify(head));
      var blob = new Blob([MAGIC, u32(json.length), json].concat(parts), { type: 'application/octet-stream' });
      var expect = 12 + json.length + off;
      if (blob.size !== expect) throw new Error('Backup size check failed (' + blob.size + ' vs ' + expect + ')');
      return { blob: blob, albums: albums.length, tracks: tracks.length, files: files, bytes: blob.size };
    });
  }

  /* ---------- read a backup file's header ---------- */
  function inspect(file){
    if (!file || file.size < 13) return Promise.reject(new Error('That file is empty or too small'));
    return file.slice(0, 12).arrayBuffer().then(function(buf){
      var dv = new DataView(buf), magic = '';
      for (var i = 0; i < 8; i++) magic += String.fromCharCode(dv.getUint8(i));
      if (magic !== MAGIC) throw new Error('This is not an ALVéON backup');
      var hl = dv.getUint32(8, true);
      if (hl < 2 || 12 + hl > file.size) throw new Error('This backup is damaged (header)');
      return file.slice(12, 12 + hl).arrayBuffer().then(function(hb){
        var head;
        try { head = JSON.parse(new TextDecoder().decode(hb)); } catch (e) { throw new Error('This backup is damaged (header)'); }
        if (!head || head.format !== 'alveon-backup') throw new Error('This is not an ALVéON backup');
        if (head.version > VERSION) throw new Error('This backup is from a newer ALVéON. Update the app first.');
        var base = 12 + hl;
        if (file.size !== base + head.payloadBytes) throw new Error('This backup is incomplete (' + file.size + ' of ' + (base + head.payloadBytes) + ' bytes). Copy it again.');
        function inside(rf){ return !rf || (rf.o >= 0 && rf.l >= 0 && rf.o + rf.l <= head.payloadBytes); }
        head.albums.forEach(function(a){ if (!inside(a.cover)) throw new Error('This backup is damaged (cover)'); });
        head.tracks.forEach(function(t){ if (!inside(t.blob)) throw new Error('This backup is damaged (song)'); });
        return { head: head, base: base };
      });
    });
  }

  /* ---------- restore ---------- */
  function piece(file, base, rf, withName){
    var sl = file.slice(base + rf.o, base + rf.o + rf.l, rf.t || '');
    /* copy the bytes into memory so the stored song never depends on the picked file */
    return sl.arrayBuffer().then(function(buf){
      if (buf.byteLength !== rf.l) throw new Error('A song could not be read completely');
      if (withName && rf.n){ try { return new File([buf], rf.n, { type: rf.t || '', lastModified: rf.m || Date.now() }); } catch (e) {} }
      return new Blob([buf], { type: rf.t || '' });
    });
  }

  function restore(file, mode, progress){
    return inspect(file).then(function(info){
      var head = info.head, base = info.base, total = head.albums.length + head.tracks.length, done = 0;
      function step(){ done++; if (progress) progress(done, total); return tick(); }
      var start = mode === 'replace' ? clearAll() : Promise.resolve();
      return start.then(function(){
        return head.albums.reduce(function(p, a){
          return p.then(function(){
            var rec = clone(a), rf = a.cover; rec.cover = null;
            return (rf ? piece(file, base, rf, false) : Promise.resolve(null)).then(function(b){ rec.cover = b; return AV.db.put('albums', rec); }).then(step);
          });
        }, Promise.resolve());
      }).then(function(){
        return head.tracks.reduce(function(p, t){
          return p.then(function(){
            var rec = clone(t), rf = t.blob; rec.blob = null;
            return (rf ? piece(file, base, rf, true) : Promise.resolve(null)).then(function(b){ rec.blob = b; return AV.db.put('tracks', rec); }).then(step);
          });
        }, Promise.resolve());
      }).then(function(){
        return head.meta.reduce(function(p, m){ return p.then(function(){ return AV.db.put('meta', m); }); }, Promise.resolve());
      }).then(function(){ return verify(head); });
    });
  }

  function clearAll(){
    return Promise.all([AV.db.all('albums'), AV.db.all('tracks')]).then(function(r){
      var p = Promise.resolve();
      r[0].forEach(function(a){ p = p.then(function(){ return AV.db.del('albums', a.id); }); });
      r[1].forEach(function(t){ p = p.then(function(){ return AV.db.del('tracks', t.id); }); });
      return p;
    });
  }

  /* After restoring: read everything back from the phone's storage and compare it with the backup's list. */
  function verify(head){
    return Promise.all([AV.db.all('albums'), AV.db.all('tracks')]).then(function(r){
      var al = {}, tr = {}, problems = [], bytes = 0;
      r[0].forEach(function(a){ al[a.id] = a; }); r[1].forEach(function(t){ tr[t.id] = t; });
      head.albums.forEach(function(a){
        var s = al[a.id];
        if (!s) { problems.push('Album missing: ' + a.title); return; }
        if (s.title !== a.title || (s.artist || '') !== (a.artist || '')) problems.push('Album details differ: ' + a.title);
        if (a.cover && !(isBlob(s.cover) && s.cover.size === a.cover.l)) problems.push('Cover differs: ' + a.title);
        if (a.cover) bytes += a.cover.l;
      });
      head.tracks.forEach(function(t){
        var s = tr[t.id];
        if (!s) { problems.push('Song missing: ' + t.title); return; }
        if (s.title !== t.title || s.albumId !== t.albumId || s.no !== t.no) problems.push('Song details differ: ' + t.title);
        if (t.blob) { if (!(isBlob(s.blob) && s.blob.size === t.blob.l)) problems.push('Audio differs: ' + t.title); else bytes += t.blob.l; }
        else if (s.blob) problems.push('Unexpected audio: ' + t.title);
      });
      return { ok: problems.length === 0, albums: head.albums.length, tracks: head.tracks.length, bytes: bytes, problems: problems };
    });
  }

  AV.backup = { build: build, inspect: inspect, restore: restore, verify: verify, fileName: function(){ return 'ALVeON-library-' + new Date().toISOString().slice(0, 10) + '.alveon'; } };
})();
