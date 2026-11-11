/* Songs from a OneDrive share link ("Anyone with the link"). The link is turned into a OneDrive share token, the file or folder is listed, and every song is downloaded onto the phone. */
(function(){
  var AV = window.AV = window.AV || {}, C = AV.cloud = { base: 'https://api.onedrive.com/v1.0' };
  var AUDIO = /\.(mp3|m4a|aac|flac|wav|ogg|opus|aiff?|alac|wma)$/i, ZIP = /\.zip$/i;
  var MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', zip: 'application/zip' };
  function err(code, msg){ var e = new Error(msg); e.code = code; return e; }
  C.clean = function(u){
    u = String(u || '').trim().replace(/^<|>$/g, '');
    var m = u.match(/https?:\/\/[^\s]+/i); if (m) u = m[0];
    if (!/^https?:\/\//i.test(u) && /^[\w.-]+\.[a-z]{2,}\//i.test(u)) u = 'https://' + u;
    if (!/^https?:\/\//i.test(u)) return null;
    try { var h = new URL(u).hostname.toLowerCase(); } catch (e) { return null; }
    if (!(h === '1drv.ms' || h === 'onedrive.live.com' || h === 'photos.onedrive.com' || h === 'onedrive.com' || /\.sharepoint\.com$/.test(h) || /\.onedrive\.com$/.test(h))) return null;
    return u;
  };
  C.token = function(u){ return 'u!' + btoa(unescape(encodeURIComponent(u))).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-'); };
  function getJSON(url, signal){
    return fetch(url, { signal: signal }).then(function(r){
      if (r.status === 401 || r.status === 403) throw err('private', 'private');
      if (r.status === 404) throw err('missing', 'missing');
      if (!r.ok) throw err('http', 'OneDrive answered ' + r.status);
      return r.json();
    }, function(e){ if (e && e.name === 'AbortError') throw err('cancel', 'cancelled'); throw err('blocked', 'blocked'); });
  }
  function ext(n){ var m = /\.([a-z0-9]+)$/i.exec(n || ''); return m ? m[1].toLowerCase() : ''; }
  /* list what is behind the link: [{ name, size, url }] and a name for the album */
  C.list = function(link, signal){
    var u = C.clean(link); if (!u) return Promise.reject(err('badlink', 'badlink'));
    var tk = C.token(u), root = C.base + '/shares/' + tk, out = [], title = '';
    function walk(itemUrl, depth){
      return getJSON(itemUrl + '/children?$top=200', signal).then(function(j){
        var subs = [];
        (j.value || []).forEach(function(it){
          if (it.folder){ if (depth < 2) subs.push(it); return; }
          if (AUDIO.test(it.name) || ZIP.test(it.name)) out.push({ name: it.name, size: it.size || 0, url: it['@content.downloadUrl'] || (root + '/items/' + it.id + '/content') });
        });
        return subs.reduce(function(p, s){ return p.then(function(){ return walk(root + '/items/' + s.id, depth + 1); }); }, Promise.resolve());
      });
    }
    return getJSON(root + '/driveItem', signal).then(function(it){
      title = it.name || '';
      if (it.folder) return walk(root + '/driveItem', 0).then(function(){ return { title: title, folder: true, files: out }; });
      if (!(AUDIO.test(it.name) || ZIP.test(it.name))) throw err('notaudio', 'notaudio');
      return { title: title, folder: false, files: [{ name: it.name, size: it.size || 0, url: it['@content.downloadUrl'] || (root + '/root/content') }] };
    });
  };
  /* download one file with progress; resolves to a File */
  C.get = function(f, onFrac, signal){
    return fetch(f.url, { signal: signal }).then(function(r){
      if (!r.ok) throw err('http', 'OneDrive answered ' + r.status);
      var total = +r.headers.get('content-length') || f.size || 0;
      if (!r.body || !r.body.getReader || !total){ return r.blob().then(function(b){ onFrac(1); return b; }); }
      var rd = r.body.getReader(), parts = [], got = 0;
      function pump(){ return rd.read().then(function(x){ if (x.done) return new Blob(parts); parts.push(x.value); got += x.value.length; onFrac(Math.min(1, got / total)); return pump(); }); }
      return pump();
    }, function(e){ if (e && e.name === 'AbortError') throw err('cancel', 'cancelled'); throw err('blocked', 'blocked'); })
    .then(function(b){ return new File([b], f.name, { type: MIME[ext(f.name)] || b.type || '' }); });
  };
  C.say = function(e){
    switch (e && e.code){
      case 'badlink': return 'That does not look like a OneDrive link. Paste the “Share” link (1drv.ms or onedrive.live.com).';
      case 'private': return 'That link is private. In OneDrive choose Share → “Anyone with the link can view”, then copy it again.';
      case 'missing': return 'OneDrive says that link does not exist any more.';
      case 'notaudio': return 'That link is not a song, a folder of songs or a .zip.';
      case 'blocked': return 'OneDrive would not let the app download this directly. Open the link in Safari, tap Download, then use Import → Songs from Files.';
      case 'cancel': return 'Download cancelled.';
      default: return (e && e.message) || 'Could not download from that link.';
    }
  };
})();
