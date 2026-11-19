/* Listening history (kept on this phone) and personal mixes built from it and from each song's sound profile. */
(function(){
  var AV = window.AV = window.AV || {}, U = AV.util, clamp = U.clamp;
  var KEY = 'alveon.hist', D = { t: {}, a: {} }, saveT = 0;
  try { var raw = JSON.parse(localStorage.getItem(KEY) || 'null'); if (raw && raw.t) D = raw; } catch (e) {}
  function save(){ clearTimeout(saveT); saveT = setTimeout(function(){ try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) {} }, 2000); }
  function rec(t){ return D.t[t.id] || (D.t[t.id] = { p: 0, s: 0, l: 0 }); }
  function artistOf(t){ var al = AV.store.album(t.albumId); return String(t.artist || (al && al.artist) || '').trim().toLowerCase(); }
  var H = AV.history = {
    plays: function(t){ return (D.t[t.id] || {}).p || 0; },
    skips: function(t){ return (D.t[t.id] || {}).s || 0; },
    last: function(t){ return (D.t[t.id] || {}).l || 0; },
    artistPlays: function(t){ var a = artistOf(t); return a ? (D.a[a] || 0) : 0; },
    total: function(){ var n = 0; for (var k in D.t) n += D.t[k].p; return n; },
    hasData: function(){ return H.total() >= 5; },
    /* 0..1: how much this person seems to like the song (plays, its artist, few skips, not just heard) */
    affinity: function(t){
      var r = D.t[t.id] || { p: 0, s: 0, l: 0 }, ap = H.artistPlays(t), tot = Math.max(1, H.total());
      var a = .55 * (1 - Math.exp(-r.p / 3)) + .35 * Math.min(1, ap / Math.max(4, tot * .2)) - .35 * (r.s / Math.max(1, r.p + r.s));
      if (r.l && Date.now() - r.l < 3 * 3600e3) a -= .25;                 /* just heard it: give it a rest */
      return clamp(a, 0, 1);
    },
    skipPenalty: function(t){ var r = D.t[t.id]; return r && r.s > r.p ? Math.min(2, (r.s - r.p) * .6) : 0; },
    topArtists: function(n){
      var names = {}, list = [];
      AV.store.tracks.forEach(function(t){ var a = artistOf(t); if (a && !names[a]) names[a] = (AV.store.album(t.albumId) || {}).artist === undefined ? t.artist : (t.artist || (AV.store.album(t.albumId) || {}).artist); });
      for (var a in names) list.push({ key: a, name: names[a], plays: D.a[a] || 0, songs: AV.store.tracks.filter(function(t){ return artistOf(t) === a; }).length });
      list.sort(function(x, y){ return (y.plays - x.plays) || (y.songs - x.songs); });
      return list.slice(0, n);
    },
    artistKey: artistOf
  };
  /* watch what is played and what is skipped */
  var cur = null, maxT = 0, lenT = 0;
  function settle(){
    if (!cur) return;
    var frac = lenT ? maxT / lenT : 0, r = rec(cur), skipped = AV.player && AV.player.lastSkip && (Date.now() - AV.player.lastSkip < 2500);
    if (maxT >= 30 || frac >= .5){ r.p++; r.l = Date.now(); var a = artistOf(cur); if (a) D.a[a] = (D.a[a] || 0) + 1; }
    else if (skipped && maxT < 25 && frac < .3){ r.s++; }
    save();
  }
  setInterval(function(){
    var P = AV.player; if (!P) return; var t = P.cur();
    if (t && cur && t.id === cur.id){ var x = P.time(); if (P.playing && x > maxT) maxT = x; lenT = P.length() || lenT; return; }
    settle(); cur = t; maxT = 0; lenT = t ? P.length() : 0;
  }, 1000);

  /* ---------- building the mixes ---------- */
  function feat(t){ var a = AV.fx.analysisOf(t.id), s = a && a.sp; return s ? s : null; }
  function vec(s){ return [s.energy, s.danceability, s.valence, s.acousticness, s.instrumentalness, clamp((s.bpm - 60) / 120, 0, 1)]; }
  function dist(a, b){ var d = 0; for (var i = 0; i < a.length; i++) d += (a[i] - b[i]) * (a[i] - b[i]); return Math.sqrt(d); }
  function centroid(list){ var c = [0, 0, 0, 0, 0, 0], n = 0; list.forEach(function(t){ var s = feat(t); if (!s) return; var v = vec(s); for (var i = 0; i < 6; i++) c[i] += v[i]; n++; }); return n ? c.map(function(x){ return x / n; }) : null; }
  function dayKey(){ var d = new Date(); return d.getFullYear() * 400 + d.getMonth() * 32 + d.getDate(); }
  function seeded(id, salt){ var s = id + ':' + salt, h = 2166136261; for (var i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return (h % 10000) / 10000; }
  /* order songs so that each one follows well from the one before (tempo, key, energy) */
  function flow(list, startId){
    if (list.length < 3) return list.slice();
    var left = list.slice(), out = [], first = startId ? left.filter(function(t){ return t.id === startId; })[0] : null;
    if (!first) first = left[0]; left.splice(left.indexOf(first), 1); out.push(first);
    while (left.length){
      var prev = out[out.length - 1], best = null, bs = -1e9;
      left.forEach(function(c){ var s = AV.player.compat(prev, c) + (c.albumId !== prev.albumId ? .8 : 0) + Math.random() * .3; if (s > bs){ bs = s; best = c; } });
      left.splice(left.indexOf(best), 1); out.push(best);
    }
    return out;
  }
  function spreadAlbums(list, perAlbum){ var cnt = {}; return list.filter(function(t){ cnt[t.albumId] = (cnt[t.albumId] || 0) + 1; return cnt[t.albumId] <= perAlbum; }); }
  function pick(all, score, n, perAlbum){
    var ranked = all.map(function(t){ return { t: t, s: score(t) }; }).sort(function(a, b){ return b.s - a.s; }).map(function(x){ return x.t; });
    return spreadAlbums(ranked, perAlbum || 4).slice(0, n);
  }
  function mk(id, title, sub, tracks, hue){ return tracks.length >= 4 ? { id: id, title: title, sub: sub, tracks: tracks, hue: hue } : null; }
  function plural(n){ return n + (n === 1 ? ' song' : ' songs'); }

  AV.mixes = {
    build: function(){
      var all = AV.store.tracks.slice(); if (all.length < 4) return [];
      var out = [], day = dayKey(), hasH = H.hasData();
      var favs = pick(all, function(t){ return H.affinity(t); }, 12, 3), cen = centroid(hasH ? favs : all);
      function simTo(c){ return function(t){ var s = feat(t); return s && c ? 1 - dist(vec(s), c) : .4; }; }
      /* Daily Mix: what you like, refreshed each day, ordered to flow */
      var daily = pick(all, function(t){ return H.affinity(t) * 3 + seeded(t.id, day) * 1.6 + (cen ? simTo(cen)(t) : 0); }, 25, 4);
      out.push(mk('daily', 'Daily Mix', hasH ? 'Your favourites, refreshed today · ' + plural(daily.length) : 'A fresh pick for today · ' + plural(daily.length), flow(daily, daily[0] && daily[0].id), 215));
      /* Discovery Mix: songs you have not played much, closest in feel to what you love */
      var fresh = all.filter(function(t){ return H.plays(t) <= 1 && H.skips(t) < 2; });
      var disc = pick(fresh, function(t){ return (cen ? simTo(cen)(t) * 3 : 0) + seeded(t.id, day + 7); }, 25, 3);
      out.push(mk('discover', 'Discovery Mix', 'Songs you have barely played, close to your taste · ' + plural(disc.length), flow(disc), 160));
      /* Artist Mixes: an artist you play, with songs that sound like them */
      H.topArtists(3).forEach(function(ar, i){
        var own = all.filter(function(t){ return H.artistKey(t) === ar.key; }), c = centroid(own), rest = all.filter(function(t){ return H.artistKey(t) !== ar.key; });
        var simi = pick(rest, simTo(c), Math.max(6, 22 - Math.min(own.length, 12)), 3), set = spreadAlbums(own, 6).slice(0, 12).concat(simi);
        out.push(mk('artist' + i, (ar.name || 'Artist') + ' Mix', own.length + ' by them, the rest sounds like them · ' + plural(set.length), flow(set, own[0] && own[0].id), 330 - i * 40));
      });
      /* Genre Mixes: groups found by how songs sound (tempo, energy, acoustic or electric), not by tags */
      var withF = all.filter(feat);
      if (withF.length >= 12){
        var k = withF.length >= 40 ? 4 : 3, cs = [], i, j; var step = Math.floor(withF.length / k);
        var srt = withF.slice().sort(function(a, b){ return feat(a).energy - feat(b).energy; });
        for (i = 0; i < k; i++) cs.push(vec(feat(srt[Math.min(srt.length - 1, Math.floor((i + .5) * step))])));
        var asg;
        for (var it = 0; it < 8; it++){
          asg = withF.map(function(t){ var v = vec(feat(t)), b = 0, bd = 9; cs.forEach(function(c, ci){ var d = dist(v, c); if (d < bd){ bd = d; b = ci; } }); return b; });
          cs = cs.map(function(c, ci){ var m = withF.filter(function(_, ti){ return asg[ti] === ci; }); return m.length ? centroid(m) : c; });
        }
        var used = {};
        cs.forEach(function(c, ci){
          var m = withF.filter(function(_, ti){ return asg[ti] === ci; }); if (m.length < 5) return;
          var nm = c[3] > .6 && c[0] < .5 ? 'Acoustic & Mellow' : c[4] > .75 ? 'Instrumental' : c[0] > .55 && c[1] > .5 ? 'Dance Floor' : c[5] < .3 ? 'Slow & Smooth' : c[5] > .6 ? 'Up-tempo' : 'Easy Groove';
          used[nm] = (used[nm] || 0) + 1; if (used[nm] > 1) nm += ' ' + used[nm];
          var g = pick(m, function(t){ return H.affinity(t) * 2 + seeded(t.id, day + ci); }, 25, 4);
          out.push(mk('genre' + ci, 'Genre Mix · ' + nm, plural(g.length) + ' that sound alike', flow(g), 20 + ci * 70));
        });
      }
      /* Mood Mixes */
      var moods = [['Feel Good', function(s){ return s.valence > .52 && s.energy > .4; }, 48], ['Chill', function(s){ return s.valence >= .42 && s.energy <= .4; }, 190], ['Dark & Moody', function(s){ return s.valence < .42 && s.energy <= .5; }, 270], ['Intense', function(s){ return s.valence < .52 && s.energy > .5; }, 0]];
      moods.forEach(function(m){
        var pool = withF.filter(function(t){ return m[1](feat(t)); }); if (pool.length < 5) return;
        var g = pick(pool, function(t){ return H.affinity(t) * 2 + seeded(t.id, day + 3); }, 25, 4); out.push(mk('mood' + m[0], 'Mood Mix · ' + m[0], plural(g.length) + ' with that atmosphere', flow(g), m[2]));
      });
      /* Energy Mix: starts easy and builds */
      var en = pick(withF, function(t){ return H.affinity(t) * 1.5 + feat(t).energy + seeded(t.id, day + 5); }, 24, 4);
      if (en.length >= 6){ en.sort(function(a, b){ return feat(a).energy - feat(b).energy; }); var ramp = []; for (var q = 0; q < en.length; q += 6) ramp = ramp.concat(flow(en.slice(q, q + 6))); out.push(mk('energy', 'Energy Mix', 'Starts gentle and builds up · ' + plural(ramp.length), ramp, 8)); }
      /* Late Night Mix: slow, soft, low energy, gently fading */
      var ln = pick(withF.filter(function(t){ var s = feat(t); return s.energy < .55 && (!s.bpm || s.bpm < 118); }), function(t){ var s = feat(t); return (1 - s.energy) * 2 + s.acousticness + (1 - s.valence) * .5 + H.affinity(t) + seeded(t.id, day + 9) * .5; }, 22, 4);
      if (ln.length >= 5){ ln.sort(function(a, b){ return feat(b).energy - feat(a).energy; }); var lat = []; for (var z = 0; z < ln.length; z += 5) lat = lat.concat(flow(ln.slice(z, z + 5))); out.push(mk('late', 'Late Night Mix', 'Slow and soft, fading out · ' + plural(lat.length), lat, 250)); }
      /* Throwback Mix: the oldest songs in your library you have not heard lately */
      var old = all.slice().sort(function(a, b){ return (a.added || 0) - (b.added || 0); }).slice(0, Math.max(8, Math.floor(all.length * .4)));
      var tb = pick(old, function(t){ return H.affinity(t) * 2 + (Date.now() - H.last(t) > 7 * 864e5 ? 1 : 0) + seeded(t.id, day + 11); }, 25, 4);
      out.push(mk('throwback', 'Throwback Mix', 'From early in your library · ' + plural(tb.length), flow(tb), 30));
      return out.filter(Boolean);
    },
    play: function(m){ AV.player.playList(m.tracks, null, m.title, false, true); }
  };
})();
