/* Cover art helpers: square crop, average colour, colours for the library, and generated artwork. */
(function(){
  var AV = window.AV = window.AV || {};
  var clamp = AV.util.clamp;

  function loadImg(blob){
    return new Promise(function(res, rej){
      var u = URL.createObjectURL(blob), im = new Image();
      im.onload = function(){ res({ im: im, done: function(){ URL.revokeObjectURL(u); } }); };
      im.onerror = function(){ URL.revokeObjectURL(u); rej(new Error('bad image')); };
      im.src = u;
    });
  }

  /* Any image -> 600px square JPEG. */
  AV.toCover = function(blob){
    return loadImg(blob).then(function(o){
      var im = o.im, w = im.naturalWidth, h = im.naturalHeight, s = Math.min(w, h), c = document.createElement('canvas');
      c.width = c.height = 600;
      c.getContext('2d').drawImage(im, (w - s) / 2, (h - s) / 2, s, s, 0, 0, 600, 600);
      o.done();
      return new Promise(function(res){ c.toBlob(function(b){ res(b); }, 'image/jpeg', .9); });
    }).catch(function(){ return null; });
  };

  /* Weighted average that favours colourful pixels. Returns [r, g, b] or null. */
  AV.avgColor = function(blob){
    return loadImg(blob).then(function(o){
      var c = document.createElement('canvas'); c.width = c.height = 14;
      var g = c.getContext('2d'); g.drawImage(o.im, 0, 0, 14, 14); o.done();
      var d = g.getImageData(0, 0, 14, 14).data, r = 0, gr = 0, b = 0, n = 0;
      for (var i = 0; i < d.length; i += 4){
        var mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]), w = .1 + Math.pow((mx - mn) / 255, 1.5) * 2;
        r += d[i] * w; gr += d[i + 1] * w; b += d[i + 2] * w; n += w;
      }
      return [r / n, gr / n, b / n];
    }).catch(function(){ return null; });
  };

  function toHsl(c){
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0;
    if (mx !== mn){
      var d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60;
    }
    return [h, s, l];
  }
  function css(h, s, l){ return 'hsl(' + Math.round(h) + ' ' + Math.round(s * 100) + '% ' + Math.round(l * 100) + '%)'; }

  /* Colours derived from an album: a bright bar for the stack, a deep tone for backgrounds. */
  AV.palette = function(album){
    var c = album && album.color, hsl = c ? toHsl(c) : [album ? album.hue : 220, .5, .5];
    var grey = hsl[1] < .12;
    var h = hsl[0], s = grey ? 0 : clamp(hsl[1] * 1.15, .5, .92);
    var barL = clamp(hsl[2] + .12, .56, .74);
    return {
      bar: css(h, grey ? 0 : s, grey ? .78 : barL),
      barText: '#14130f',
      deep: css(h, grey ? 0 : clamp(s * .8, .35, .75), grey ? .14 : .3),
      mid: css(h, grey ? 0 : s * .72, grey ? .3 : .36),
      h: h
    };
  };

  /* Abstract artwork for albums that have no cover, so the stack always looks right. */
  AV.makeCover = function(style, hue){
    var c = document.createElement('canvas'); c.width = c.height = 600;
    var g = c.getContext('2d'), i;
    var gr = g.createLinearGradient(0, 0, 600, 600);
    gr.addColorStop(0, 'hsl(' + hue + ' 72% 58%)'); gr.addColorStop(1, 'hsl(' + ((hue + 42) % 360) + ' 66% 20%)');
    g.fillStyle = gr; g.fillRect(0, 0, 600, 600);
    if (style === 0){
      g.lineWidth = 3;
      for (i = 0; i < 9; i++){ g.strokeStyle = 'rgba(255,255,255,' + (.55 - i * .05) + ')'; g.beginPath(); g.arc(390, 250, 36 + i * 36, 0, 7); g.stroke(); }
      g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(390, 250, 14, 0, 7); g.fill();
    } else if (style === 1){
      g.fillStyle = 'rgba(255,238,205,.92)'; g.beginPath(); g.arc(300, 240, 130, 0, 7); g.fill();
      for (i = 0; i < 7; i++){ g.fillStyle = 'rgba(8,6,20,' + (.22 + i * .04) + ')'; g.fillRect(0, 380 + i * 32, 600, 12 + i * 3); }
    } else {
      g.save(); g.translate(300, 300); g.rotate(-.55);
      for (i = 0; i < 6; i++){ g.fillStyle = 'rgba(255,255,255,' + (.07 + (i % 3) * .06) + ')'; g.fillRect(-620, -330 + i * 120, 1240, 64); }
      g.restore();
      g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 4; g.beginPath(); g.arc(300, 300, 96, 0, 7); g.stroke();
    }
    return new Promise(function(res){ c.toBlob(function(b){ res(b); }, 'image/jpeg', .9); });
  };
})();
