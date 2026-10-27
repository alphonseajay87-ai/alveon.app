/* Reads title, artist, album, track number and cover art from MP3 (ID3v2) and M4A/AAC (MP4) files. */
(function(){
  var AV = window.AV = window.AV || {};

  /* ---------- MP3 ---------- */
  function synchsafe(u, p){ return ((u[p] & 127) << 21) | ((u[p + 1] & 127) << 14) | ((u[p + 2] & 127) << 7) | (u[p + 3] & 127); }
  function decodeText(u, s, e){
    var enc = u[s], a = s + 1, label = 'iso-8859-1';
    if (enc === 1){
      if (u[a] === 0xFE && u[a + 1] === 0xFF){ label = 'utf-16be'; a += 2; }
      else { label = 'utf-16le'; if (u[a] === 0xFF && u[a + 1] === 0xFE) a += 2; }
    } else if (enc === 2) label = 'utf-16be';
    else if (enc === 3) label = 'utf-8';
    try { return new TextDecoder(label).decode(u.subarray(a, e)).replace(/\u0000+$/, '').trim(); } catch (x) { return ''; }
  }
  function parseId3(buf){
    var u = new Uint8Array(buf), v = new DataView(buf), out = {};
    if (u[0] !== 73 || u[1] !== 68 || u[2] !== 51) return out;
    var ver = u[3], size = synchsafe(u, 6), p = 10;
    if (u[5] & 64){ var es = ver === 4 ? synchsafe(u, p) : v.getUint32(p); p += ver === 4 ? es : es + 4; }
    var end = Math.min(buf.byteLength, 10 + size);
    while (p + 10 <= end){
      var id = String.fromCharCode(u[p], u[p + 1], u[p + 2], u[p + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      var fs = ver === 4 ? synchsafe(u, p + 4) : v.getUint32(p + 4), s = p + 10, e = s + fs;
      if (fs <= 0 || e > buf.byteLength) break;
      if (id === 'TIT2') out.title = decodeText(u, s, e);
      else if (id === 'TPE1') out.artist = decodeText(u, s, e);
      else if (id === 'TPE2') out.albumArtist = decodeText(u, s, e);
      else if (id === 'TALB') out.album = decodeText(u, s, e);
      else if (id === 'TRCK') out.no = parseInt(decodeText(u, s, e), 10) || 0;
      else if (id === 'APIC' && !out.cover){
        var enc = u[s], q = s + 1;
        while (q < e && u[q] !== 0) q++;
        var mime = String.fromCharCode.apply(null, u.subarray(s + 1, q));
        q += 2;
        if (enc === 1 || enc === 2){ while (q + 1 < e && !(u[q] === 0 && u[q + 1] === 0)) q += 2; q += 2; }
        else { while (q < e && u[q] !== 0) q++; q++; }
        if (q < e) out.cover = new Blob([u.slice(q, e)], { type: /^image\//.test(mime) ? mime : 'image/jpeg' });
      }
      p = e;
    }
    return out;
  }

  /* ---------- M4A / AAC ---------- */
  function boxes(u, start, end, cb){
    var p = start;
    while (p + 8 <= end){
      var len = ((u[p] << 24) | (u[p + 1] << 16) | (u[p + 2] << 8) | u[p + 3]) >>> 0;
      var type = String.fromCharCode(u[p + 4], u[p + 5], u[p + 6], u[p + 7]);
      if (len === 0) len = end - p;
      if (len < 8) break;
      cb(type, p + 8, Math.min(end, p + len));
      p += len;
    }
  }
  function parseMoov(buf){
    var u = new Uint8Array(buf), out = {};
    function item(key, flags, data){
      var txt = function(){ try { return new TextDecoder('utf-8').decode(data).trim(); } catch (e) { return ''; } };
      if (key === '©nam') out.title = txt();
      else if (key === '©ART') out.artist = txt();
      else if (key === 'aART') out.albumArtist = txt();
      else if (key === '©alb') out.album = txt();
      else if (key === 'trkn' && data.length >= 4) out.no = (data[2] << 8) | data[3];
      else if (key === 'covr' && !out.cover) out.cover = new Blob([data.slice()], { type: flags === 14 ? 'image/png' : 'image/jpeg' });
    }
    boxes(u, 0, u.length, function(t, s, e){
      if (t !== 'udta') return;
      boxes(u, s, e, function(t2, s2, e2){
        if (t2 !== 'meta') return;
        boxes(u, s2 + 4, e2, function(t3, s3, e3){
          if (t3 !== 'ilst') return;
          boxes(u, s3, e3, function(key, ks, ke){
            boxes(u, ks, ke, function(t4, ds, de){
              if (t4 !== 'data') return;
              var flags = ((u[ds] << 24) | (u[ds + 1] << 16) | (u[ds + 2] << 8) | u[ds + 3]) & 0xffffff;
              item(key, flags, u.subarray(ds + 8, de));
            });
          });
        });
      });
    });
    return out;
  }
  function readMp4(file){
    var pos = 0, size = file.size;
    function next(){
      if (pos + 8 > size) return Promise.resolve({});
      return file.slice(pos, pos + 16).arrayBuffer().then(function(b){
        var h = new DataView(b), len = h.getUint32(0), hdr = 8, type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
        if (len === 1 && b.byteLength >= 16){ len = h.getUint32(8) * 4294967296 + h.getUint32(12); hdr = 16; }
        if (len === 0) len = size - pos;
        if (len < 8) return {};
        if (type === 'moov' && len < 40 * 1024 * 1024) return file.slice(pos + hdr, pos + len).arrayBuffer().then(parseMoov);
        pos += len;
        return next();
      });
    }
    return next();
  }

  /* ---------- entry point ---------- */
  AV.readTags = function(file){
    return file.slice(0, 12).arrayBuffer().then(function(b){
      var u = new Uint8Array(b);
      if (u[0] === 73 && u[1] === 68 && u[2] === 51) return file.slice(0, 4 * 1024 * 1024).arrayBuffer().then(parseId3);
      if (String.fromCharCode(u[4], u[5], u[6], u[7]) === 'ftyp') return readMp4(file);
      return {};
    }).catch(function(){ return {}; });
  };

  /* "Artist - Title.mp3" -> { artist, title } when the file has no tags. */
  AV.nameFromFile = function(name){
    var base = name.replace(/\.[^.]+$/, '').replace(/_+/g, ' ').trim();
    var m = base.match(/^(.+?)\s+-\s+(.+)$/);
    return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: base || 'Untitled' };
  };
})();
