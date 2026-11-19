/*
  The library stack. Each album is a thin slab lying flat in 3D, seen from eye level at the middle of the screen:
  the slab at the middle is edge-on (just its title bar), slabs above show their underside, slabs below show their top.
  Native scrolling with snap drives the position, so momentum feels like the rest of iOS.
*/
(function(){
  var AV = window.AV = window.AV || {};
  var U = AV.util, $ = U.$, S = AV.store, clamp = U.clamp;
  var stack = $('stack'), sc = $('scroller'), snaps = $('snaps'), bg = $('bgfx'), cap = $('cap'), dots = $('dots'), emptyEl = $('empty');
  var G = { s: 270, p: 72, t: 24, P: 900, sp: 80 };
  var slabs = [], H = 0, W = 0, raf = 0, idx = -1, hidden = [], intro = { on: false, t0: 0, dur: 900 }, capTimer = 0, lastDots = '';
  var VIS = 5.6;

  function ease(x){ x = clamp(x, 0, 1); return 1 - Math.pow(1 - x, 3); }

  function metrics(){
    W = sc.clientWidth; H = sc.clientHeight;
    G.s = Math.round(Math.min(W * .72, 330));
    G.t = Math.round(clamp(G.s * .085, 20, 26));
    G.p = Math.round(G.s * .25);
    G.P = Math.round(G.s * 2.5);
    G.sp = Math.round(G.p * 1.1);
    stack.style.setProperty('--s', G.s + 'px');
    stack.style.setProperty('--t', G.t + 'px');
    stack.style.setProperty('--P', G.P + 'px');
    var n = S.albums.length;
    snaps.style.height = (n ? (n - 1) * G.sp + H : 0) + 'px';
    Array.prototype.forEach.call(snaps.children, function(c){ c.style.height = G.sp + 'px'; });
  }

  function build(keep){
    var n = S.albums.length, keepIdx = keep ? Math.max(0, idx) : 0;
    stack.textContent = ''; snaps.textContent = ''; slabs = []; hidden = []; idx = -1;
    emptyEl.hidden = n > 0;
    $('cap').hidden = n === 0; dots.hidden = n === 0;
    S.albums.forEach(function(al, i){
      var pal = AV.palette(al), el = document.createElement('div');
      el.className = 'slab'; el.dataset.i = i; el.setAttribute('role', 'listitem');
      el.style.setProperty('--bar', pal.bar); el.style.setProperty('--bt', pal.barText);
      if (al.coverUrl) el.style.setProperty('--img', 'url("' + al.coverUrl + '")');
      var f = document.createElement('div'); f.className = 'face front';
      var b = document.createElement('b'); b.textContent = al.title; var sp = document.createElement('span'); sp.textContent = al.artist;
      f.appendChild(b); f.appendChild(sp);
      var t = document.createElement('div'); t.className = 'face top-f';
      var bo = document.createElement('div'); bo.className = 'face bot-f';
      el.appendChild(t); el.appendChild(bo); el.appendChild(f);
      stack.appendChild(el); slabs.push(el); hidden.push(false);
      var s = document.createElement('div'); s.className = 'snap'; snaps.appendChild(s);
    });
    metrics();
    sc.scrollTop = keepIdx * G.sp;
    paintBg();
    schedule();
  }

  function paintBg(){
    var n = S.albums.length;
    if (!n){ bg.style.background = 'linear-gradient(180deg,#141a28,#1f1620)'; return; }
    var stops = S.albums.map(function(a){ return AV.palette(a).mid; });
    if (n === 1) stops.push(AV.palette(S.albums[0]).deep);
    bg.style.background = 'linear-gradient(180deg,' + stops.join(',') + ')';
    bg.style.backgroundSize = '100% ' + (n === 1 ? 100 : 100 + Math.min(n - 1, 4) * 60) + '%';
  }

  function render(now){
    raf = 0;
    var n = slabs.length; if (!n) return;
    var pos = sc.scrollTop / G.sp, ie = intro.on ? (now - intro.t0) : 1e9;
    var introActive = intro.on && ie < intro.dur + 600;
    for (var i = 0; i < n; i++){
      var off = i - pos, a = Math.abs(off), el = slabs[i];
      if (a > VIS){ if (!hidden[i]){ el.style.display = 'none'; hidden[i] = true; } continue; }
      if (hidden[i]){ el.style.display = ''; hidden[i] = false; }
      var e = 1;
      if (introActive) e = ease((ie - clamp(a / VIS, 0, 1) * 320) / 620);
      var y = off * G.p * (.5 + .5 * e) + (1 - e) * 90;
      var op = e * clamp(1 - (a - 4.6) * .9, 0, 1);
      var blur = a > 3.6 ? (a - 3.6) * 2 : 0;
      el.style.transform = 'translateY(' + y.toFixed(1) + 'px)';
      el.style.perspectiveOrigin = (G.s / 2) + 'px ' + (G.t / 2 - y).toFixed(1) + 'px';
      el.style.zIndex = String(1000 - Math.round(a * 10));
      el.style.opacity = op.toFixed(3);
      el.style.filter = blur > .05 ? 'blur(' + blur.toFixed(1) + 'px)' : '';
    }
    if (introActive) schedule();
    var now_i = clamp(Math.round(pos), 0, n - 1);
    if (now_i !== idx) setIndex(now_i);
    if (n > 1) bg.style.backgroundPosition = '0 ' + (clamp(pos / (n - 1), 0, 1) * 100).toFixed(2) + '%';
  }
  function schedule(){ if (!raf) raf = requestAnimationFrame(render); }

  function captionFor(al){
    var c = S.tracksOf(al.id).length;
    return (al.artist ? al.artist + ' · ' : '') + c + (c === 1 ? ' song' : ' songs');
  }
  function setIndex(i){
    var first = idx < 0; idx = i;
    var al = S.albums[i]; if (!al) return;
    function put(){ $('cap-t').textContent = al.title; $('cap-a').textContent = captionFor(al); cap.classList.remove('swap'); }
    clearTimeout(capTimer);
    if (first) put(); else { cap.classList.add('swap'); capTimer = setTimeout(put, 110); }
    drawDots();
  }
  function drawDots(){
    var n = S.albums.length, k = Math.min(n, 7), act = n <= 7 ? idx : Math.round(idx / (n - 1) * 6);
    var key = k + ':' + act;
    if (key === lastDots) return; lastDots = key;
    dots.textContent = '';
    for (var i = 0; i < k; i++){ var d = document.createElement('i'); if (i === act) d.className = 'on'; dots.appendChild(d); }
  }

  sc.addEventListener('scroll', schedule, { passive: true });
  sc.addEventListener('click', function(e){
    sc.style.pointerEvents = 'none';
    var el = document.elementFromPoint(e.clientX, e.clientY);
    sc.style.pointerEvents = '';
    var sl = el && el.closest && el.closest('.slab');
    if (!sl) return;
    var i = +sl.dataset.i;
    if (Math.abs(i - sc.scrollTop / G.sp) < .4) AV.ui.openAlbum(S.albums[i]);
    else sc.scrollTo({ top: i * G.sp, behavior: 'smooth' });
  });
  if (window.ResizeObserver) new ResizeObserver(function(){ metrics(); schedule(); }).observe(sc);
  window.addEventListener('resize', function(){ metrics(); schedule(); });

  AV.stack = {
    build: build,
    current: function(){ return S.albums[idx]; },
    refreshCaption: function(){ var al = S.albums[idx]; if (al){ $('cap-t').textContent = al.title; $('cap-a').textContent = captionFor(al); } },
    scrollTo: function(i, smooth){ sc.scrollTo({ top: i * G.sp, behavior: smooth ? 'smooth' : 'auto' }); },
    indexOf: function(al){ return S.albums.indexOf(al); },
    intro: function(){ intro.on = true; intro.t0 = performance.now(); schedule(); },
    skipIntro: function(){ intro.on = false; schedule(); },
    render: schedule
  };
})();
