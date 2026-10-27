/* The library: albums and tracks held in memory, saved to IndexedDB on every change. */
(function(){
  var AV = window.AV = window.AV || {};
  var U = AV.util;
  var listeners = [];

  var S = AV.store = {
    albums: [],
    tracks: [],
    on: function(fn){ listeners.push(fn); },
    emit: function(what){ listeners.forEach(function(fn){ try { fn(what); } catch (e) {} }); },
    album: function(id){ return S.albums.filter(function(a){ return a.id === id; })[0]; },
    track: function(id){ return S.tracks.filter(function(t){ return t.id === id; })[0]; },
    tracksOf: function(albumId){
      return S.tracks.filter(function(t){ return t.albumId === albumId; }).sort(function(a, b){ return (a.no - b.no) || (a.added - b.added); });
    }
  };

  function setCover(album, blob){
    if (album.coverUrl) URL.revokeObjectURL(album.coverUrl);
    album.cover = blob || null;
    album.coverUrl = blob ? URL.createObjectURL(blob) : null;
    return blob ? AV.avgColor(blob).then(function(c){ album.color = c; }) : Promise.resolve();
  }
  function stripped(a){ return { id: a.id, title: a.title, artist: a.artist, cover: a.cover, color: a.color, hue: a.hue, created: a.created, sample: !!a.sample, autoCover: !!a.autoCover }; }
  function saveAlbum(a){ return AV.db.put('albums', stripped(a)); }

  S.load = function(){
    return Promise.all([AV.db.all('albums'), AV.db.all('tracks')]).then(function(r){
      var pending = [];
      r[0].sort(function(a, b){ return a.created - b.created; }).forEach(function(a){
        var al = { id: a.id, title: a.title, artist: a.artist, color: a.color || null, hue: a.hue, created: a.created, sample: !!a.sample, autoCover: !!a.autoCover };
        S.albums.push(al);
        if (a.cover){
          al.cover = a.cover; al.coverUrl = URL.createObjectURL(a.cover);
          if (!al.color) pending.push(AV.avgColor(a.cover).then(function(c){ al.color = c; saveAlbum(al); }));
        }
      });
      S.tracks = r[1];
      return Promise.all(pending);
    });
  };

  /* First launch: three sample albums so the library is never empty. */
  S.seed = function(){
    return AV.db.getMeta('seeded').then(function(done){
      if (done || S.albums.length) return;
      var t0 = Date.now(), chain = Promise.resolve();
      AV.SAMPLES.forEach(function(sp, ai){
        chain = chain.then(function(){ return AV.makeCover(sp.style, sp.hue); }).then(function(blob){
          var al = { id: U.uid('a'), title: sp.title, artist: sp.artist, hue: sp.hue, created: t0 + ai, sample: true, color: null };
          return setCover(al, blob).then(function(){
            S.albums.push(al);
            var tr = sp.tracks.map(function(t, i){
              return { id: U.uid('t'), albumId: al.id, no: i + 1, title: t.title, artist: sp.artist, dur: AV.synthLength(t), blob: null, synth: t, added: t0 + ai * 10 + i };
            });
            S.tracks = S.tracks.concat(tr);
            return saveAlbum(al).then(function(){ return AV.db.putMany('tracks', tr); });
          });
        });
      });
      return chain.then(function(){ return AV.db.setMeta('seeded', 1); });
    });
  };

  S.addAlbum = function(o){
    var hue = U.hash(o.title + Date.now());
    var al = { id: U.uid('a'), title: o.title || 'Untitled album', artist: o.artist || '', hue: hue, created: Date.now(), color: null, autoCover: false };
    var p = o.cover ? Promise.resolve(o.cover) : AV.makeCover(hue % 3, hue).then(function(b){ al.autoCover = true; return b; });
    return p.then(function(blob){ return setCover(al, blob); }).then(function(){
      S.albums.push(al); S.emit('albums'); return saveAlbum(al).then(function(){ return al; });
    });
  };

  S.updateAlbum = function(al, o){
    if (o.title !== undefined) al.title = o.title || al.title;
    if (o.artist !== undefined) al.artist = o.artist;
    var p = Promise.resolve();
    if (o.cover){ al.autoCover = false; p = setCover(al, o.cover); }
    return p.then(function(){ S.emit('albums'); return saveAlbum(al); });
  };

  S.deleteAlbum = function(al){
    var ids = S.tracksOf(al.id).map(function(t){ return t.id; });
    S.tracks = S.tracks.filter(function(t){ return t.albumId !== al.id; });
    S.albums = S.albums.filter(function(a){ return a !== al; });
    if (al.coverUrl) URL.revokeObjectURL(al.coverUrl);
    S.emit('albums');
    return AV.db.delAlbum(al.id, ids);
  };

  S.updateTrack = function(t, o){
    if (o.title !== undefined) t.title = o.title || t.title;
    if (o.artist !== undefined) t.artist = o.artist;
    if (o.no !== undefined && o.no > 0) t.no = o.no;
    if (o.albumId && o.albumId !== t.albumId){
      t.albumId = o.albumId;
      if (!(o.no > 0)) t.no = S.tracksOf(o.albumId).length + 1;
    }
    S.emit('tracks');
    return AV.db.put('tracks', t);
  };

  S.deleteTrack = function(t){
    S.tracks = S.tracks.filter(function(x){ return x !== t; });
    S.emit('tracks');
    return AV.db.del('tracks', t.id);
  };

  /* Length of an audio file, or -1 when this device cannot play it. */
  function probe(f){
    return new Promise(function(res){
      var u = URL.createObjectURL(f), a = new Audio(), done = false;
      function fin(v){ if (done) return; done = true; a.removeAttribute('src'); URL.revokeObjectURL(u); res(v); }
      a.preload = 'metadata';
      a.onloadedmetadata = function(){ fin(isFinite(a.duration) ? a.duration : 0); };
      a.onerror = function(){ fin(-1); };
      setTimeout(function(){ fin(0); }, 6000);
      a.src = u;
    });
  }

  /*
    Import audio files. With opts.albumId every file goes into that album.
    Otherwise files are grouped into albums by their tags (a "Singles" album when there are none).
    Resolves { added, bad, firstAlbum }.
  */
  S.importFiles = function(files, opts, progress){
    opts = opts || {};
    var added = 0, bad = 0, firstAlbum = null, cache = {};
    function findAlbum(title, artist, tagCover){
      var key = title.toLowerCase();
      if (cache[key]) return Promise.resolve(cache[key]);
      var ex = S.albums.filter(function(a){ return a.title.toLowerCase() === key; })[0];
      if (ex){
        cache[key] = ex;
        if (ex.autoCover && tagCover) return AV.toCover(tagCover).then(function(b){ return b ? S.updateAlbum(ex, { cover: b }) : null; }).then(function(){ return ex; });
        return Promise.resolve(ex);
      }
      return (tagCover ? AV.toCover(tagCover) : Promise.resolve(null)).then(function(b){
        return S.addAlbum({ title: title, artist: artist, cover: b });
      }).then(function(al){ cache[key] = al; return al; });
    }
    var list = Array.prototype.slice.call(files), idx = 0, fresh = [];
    return list.reduce(function(chain, f){
      return chain.then(function(){
        if (progress) progress(++idx, list.length);
        return Promise.all([probe(f), AV.readTags(f)]);
      }).then(function(r){
        var d = r[0], tag = r[1];
        if (d < 0){ bad++; return; }
        var guess = AV.nameFromFile(f.name);
        var title = tag.title || guess.title, artist = tag.artist || guess.artist;
        var alP;
        if (opts.albumId) alP = Promise.resolve(S.album(opts.albumId));
        else if (tag.album) alP = findAlbum(tag.album, tag.albumArtist || artist, tag.cover);
        else alP = findAlbum('Singles', 'Various', null);
        return alP.then(function(al){
          if (!firstAlbum) firstAlbum = al;
          var needCover = al.autoCover && tag.cover && opts.albumId;
          var coverP = needCover ? AV.toCover(tag.cover).then(function(b){ return b ? S.updateAlbum(al, { cover: b }) : null; }) : Promise.resolve();
          return coverP.then(function(){
            var no = tag.no || (S.tracksOf(al.id).length + fresh.filter(function(x){ return x.albumId === al.id; }).length + 1);
            var t = { id: U.uid('t'), albumId: al.id, no: no, title: title, artist: artist || al.artist, dur: d, blob: f, synth: null, added: Date.now() + idx };
            S.tracks.push(t); fresh.push(t); added++;
            return AV.db.put('tracks', t);
          });
        });
      });
    }, Promise.resolve()).then(function(){
      S.emit('tracks');
      return { added: added, bad: bad, firstAlbum: firstAlbum };
    });
  };
})();
