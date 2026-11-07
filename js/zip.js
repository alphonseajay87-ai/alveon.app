/*
  Reads .zip files on the phone without loading them whole: finds the file list at the end of the zip,
  then reads (and, when needed, inflates) one file at a time. Handles stored and deflated files and zip64.
*/
(function(){
  var AV = window.AV = window.AV || {};
  var Z = AV.zip = {};

  function rd(file, from, to){ return file.slice(from, to).arrayBuffer(); }
  function u16(v, o){ return v.getUint16(o, true); }
  function u32(v, o){ return v.getUint32(o, true); }
  function u64(v, o){ return v.getUint32(o, true) + v.getUint32(o + 4, true) * 4294967296; }
  var strict = new TextDecoder('utf-8', { fatal: true });
  function name(bytes){
    /* names are UTF-8 in nearly every zip; old zips use a legacy code page, which we show as Latin-1 */
    try { return strict.decode(bytes); } catch (e) {}
    var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s;
  }

  /* list the files inside a zip: [{ name, method, csize, size, off }] */
  Z.list = function(file){
    var n = file.size; if (n < 22) return Promise.reject(new Error('This is not a zip file'));
    var tail = Math.min(n, 65557 + 22 + 20);
    return rd(file, n - tail, n).then(function(buf){
      var v = new DataView(buf), i, eocd = -1;
      for (i = buf.byteLength - 22; i >= 0; i--) if (u32(v, i) === 0x06054b50){ eocd = i; break; }
      if (eocd < 0) throw new Error('This is not a zip file, or it is damaged');
      var count = u16(v, eocd + 10), cdSize = u32(v, eocd + 12), cdOff = u32(v, eocd + 16);
      if (count === 0xFFFF || cdSize === 0xFFFFFFFF || cdOff === 0xFFFFFFFF){
        var loc = eocd - 20;
        if (loc >= 0 && u32(v, loc) === 0x07064b50){
          var z64 = u64(v, loc + 8);
          return rd(file, z64, z64 + 56).then(function(b2){
            var w = new DataView(b2); if (u32(w, 0) !== 0x06064b50) throw new Error('This zip is damaged');
            return { count: u64(w, 32), cdSize: u64(w, 40), cdOff: u64(w, 48) };
          });
        }
      }
      return { count: count, cdSize: cdSize, cdOff: cdOff };
    }).then(function(cd){
      return rd(file, cd.cdOff, cd.cdOff + cd.cdSize).then(function(buf){
        var v = new DataView(buf), u8 = new Uint8Array(buf), p = 0, out = [];
        while (p + 46 <= buf.byteLength && u32(v, p) === 0x02014b50){
          var flags = u16(v, p + 8), method = u16(v, p + 10), csize = u32(v, p + 20), size = u32(v, p + 24), nl = u16(v, p + 28), el = u16(v, p + 30), cl = u16(v, p + 32), off = u32(v, p + 42);
          var nm = name(u8.subarray(p + 46, p + 46 + nl));
          var q = p + 46 + nl, end = q + el;
          while (q + 4 <= end){
            var id = u16(v, q), len = u16(v, q + 2);
            if (id === 1){
              var r = q + 4;
              if (size === 0xFFFFFFFF){ size = u64(v, r); r += 8; }
              if (csize === 0xFFFFFFFF){ csize = u64(v, r); r += 8; }
              if (off === 0xFFFFFFFF){ off = u64(v, r); r += 8; }
            }
            q += 4 + len;
          }
          if (nm.charAt(nm.length - 1) !== '/') out.push({ name: nm, method: method, csize: csize, size: size, off: off, enc: !!(flags & 1) });
          p += 46 + nl + el + cl;
        }
        return out;
      });
    });
  };

  /* the bytes of one file inside the zip, as a Blob */
  Z.read = function(file, e, type){
    if (e.enc) return Promise.reject(new Error('This zip is password-protected'));
    return rd(file, e.off, e.off + 30).then(function(b){
      var v = new DataView(b); if (u32(v, 0) !== 0x04034b50) throw new Error('This zip is damaged');
      var start = e.off + 30 + u16(v, 26) + u16(v, 28), raw = file.slice(start, start + e.csize);
      if (e.method === 0) return new Blob([raw], { type: type || '' });
      if (e.method !== 8) throw new Error('This zip uses a compression the phone cannot open');
      if (typeof DecompressionStream === 'undefined') throw new Error('Unpacking zips needs iOS 16.4 or newer. You can also tap the zip in the Files app to unpack it, then import the folder.');
      return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob().then(function(bl){ return new Blob([bl], { type: type || '' }); });
    });
  };
})();
