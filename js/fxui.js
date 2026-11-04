/* Sound and equalizer page. */
(function(){
  var AV = window.AV = window.AV || {};
  var U = AV.util, $ = U.$, clamp = U.clamp;
  var F = AV.fx, root, body, isOpen = false, dragging = false, refs = {};

  function el(tag, cls, text){ var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function sgn(v){ return (v > 0 ? '+' : '') + (Math.round(v * 2) / 2); }
  var FREQ = ['60', '230', '910', '3.6k', '14k'];

  function toggleRow(title, sub, key, after){
    var r = el('div', 'fx-row'), t = el('div', 't'); t.appendChild(el('b', '', title)); if (sub) t.appendChild(el('small', '', sub));
    var sw = el('button', 'sw'); sw.type = 'button'; sw.setAttribute('role', 'switch');
    sw.addEventListener('click', function(){ var p = {}; p[key] = !F.settings[key]; F.set(p); if (after) after(); });
    r.appendChild(t); r.appendChild(sw); refs['sw_' + key] = sw; return r;
  }
  function hSlider(label, min, max, step, get, set, fmt){
    var r = el('div', 'fx-sl'), inp = el('input'), out = el('output');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step;
    inp.addEventListener('input', function(){ set(+inp.value); out.textContent = fmt(+inp.value); });
    r.appendChild(el('span', '', label)); r.appendChild(inp); r.appendChild(out);
    return { row: r, update: function(){ inp.value = get(); out.textContent = fmt(get()); } };
  }
  function vSlider(i){
    var wrap = el('div', 'eq-b'), out = el('output'), t = el('div', 'eq-t'), fill = el('div', 'eq-f'), knob = el('div', 'eq-k');
    t.appendChild(fill); t.appendChild(knob); wrap.appendChild(out); wrap.appendChild(t); wrap.appendChild(el('small', '', FREQ[i]));
    function paint(){
      var v = F.settings.b[i], h = t.clientHeight || 150, y = (12 - v) / 24 * h, mid = h / 2;
      knob.style.top = y + 'px'; fill.style.top = Math.min(y, mid) + 'px'; fill.style.height = Math.abs(y - mid) + 'px'; out.textContent = sgn(v);
    }
    function at(e){
      var r = t.getBoundingClientRect(), y = clamp(e.clientY - r.top, 0, r.height);
      F.setBand(i, Math.round((12 - y / r.height * 24) * 2) / 2); paint();
    }
    t.addEventListener('pointerdown', function(e){ dragging = true; try { t.setPointerCapture(e.pointerId); } catch (x) {} at(e); });
    t.addEventListener('pointermove', function(e){ if (dragging && t.hasPointerCapture && t.hasPointerCapture(e.pointerId)) at(e); });
    function end(){ dragging = false; refresh(); }
    t.addEventListener('pointerup', end); t.addEventListener('pointercancel', end);
    t.addEventListener('dblclick', function(){ F.setBand(i, 0); paint(); });
    return { node: wrap, update: paint };
  }

  function build(){
    body.textContent = ''; refs = { bands: [] };
    /* 1. engine */
    var c1 = el('div', 'fx-card');
    c1.appendChild(toggleRow('Sound effects', 'Equalizer, volume levelling and transitions. Turn off if music stops when the screen locks, then restart the app.', 'on', function(){ AV.ui.toast(F.settings.on ? 'Sound effects on' : 'Sound effects off · restart the app to bypass them fully', 3200); }));
    c1.appendChild(toggleRow('Auto-adjust per album', 'Measures each album once on this phone, then corrects bass and treble gently.', 'auto'));
    c1.appendChild(toggleRow('Even out volume', 'Albums and songs play at a similar loudness.', 'norm'));
    refs.stat = el('p', 'fx-stat'); c1.appendChild(refs.stat);
    var xh = el('div', 'fx-xh'); xh.appendChild(el('b', '', 'Transitions'));
    var xs = el('small', '', 'DJ mode lines up the beats of both songs and swaps the bass, song by song.'); xh.appendChild(xs); c1.appendChild(xh);
    var seg = el('div', 'seg'); refs.seg = {};
    [['off', 'Off'], ['smooth', 'Smooth'], ['dj', 'DJ']].forEach(function(m){
      var b = el('button', '', m[1]); b.type = 'button';
      b.addEventListener('click', function(){ F.set({ xmode: m[0] }); if (m[0] !== 'off') F.unlockSecond(); refresh(); });
      seg.appendChild(b); refs.seg[m[0]] = b;
    });
    c1.appendChild(seg);
    var xf = el('div', 'fx-x'), xin = el('input'), xout = el('output'), xlab = el('span', 'xl', 'Length');
    xin.type = 'range';
    xin.addEventListener('input', function(){
      if (F.settings.xmode === 'dj'){ F.set({ xlen: +xin.value }); xout.textContent = xin.value + 's'; }
      else { F.set({ xfade: +xin.value }); xout.textContent = +xin.value ? xin.value + 's' : 'Off'; if (+xin.value) F.unlockSecond(); }
      mixLine();
    });
    xf.appendChild(xlab); xf.appendChild(xin); xf.appendChild(xout); c1.appendChild(xf); refs.xin = xin; refs.xout = xout; refs.xlab = xlab; refs.xf = xf;
    refs.mix = el('p', 'fx-stat fx-mix'); c1.appendChild(refs.mix);
    var sh2 = el('div', 'fx-xh'); sh2.appendChild(el('b', '', 'Sounds between songs')); sh2.appendChild(el('small', '', 'A riser, a low boom and (Full) an echo, made on the phone, played at the moment the songs swap.')); c1.appendChild(sh2);
    var sg2 = el('div', 'seg'); refs.sfx = {};
    [['off', 'Off'], ['light', 'Light'], ['full', 'Full']].forEach(function(m){
      var b = el('button', '', m[1]); b.type = 'button'; b.addEventListener('click', function(){ F.set({ sfx: m[0] }); refresh(); }); sg2.appendChild(b); refs.sfx[m[0]] = b;
    });
    c1.appendChild(sg2); refs.sfxSeg = sg2; refs.sfxHead = sh2;
    body.appendChild(c1);

    /* spatial sound */
    var cs = el('div', 'fx-card'), sh = el('div', 'fx-xh'); sh.appendChild(el('b', '', 'Spatial sound'));
    sh.appendChild(el('small', '', 'Gives left and right ears different sound, like 8D audio or a surround room. Best with headphones (AirPods, wired); on the phone speaker it does little.')); cs.appendChild(sh);
    var sg = el('div', 'seg s4'); refs.sp = {};
    [['off', 'Off'], ['wide', 'Wide'], ['8d', '8D'], ['surround', '7.1']].forEach(function(m){
      var b = el('button', '', m[1]); b.type = 'button';
      b.addEventListener('click', function(){ F.set({ space: m[0] }); refresh(); });
      sg.appendChild(b); refs.sp[m[0]] = b;
    });
    cs.appendChild(sg);
    refs.orb = hSlider('Orbit', 4, 20, 1, function(){ return F.settings.orbit; }, function(v){ F.set({ orbit: v }); }, function(v){ return v + 's'; });
    cs.appendChild(refs.orb.row);
    refs.spNote = el('p', 'fx-stat'); cs.appendChild(refs.spNote); body.appendChild(cs);

    /* 2. presets */
    var c2 = el('div', 'fx-card'); c2.appendChild(el('h4', '', 'Presets')); refs.chips = el('div', 'chips'); c2.appendChild(refs.chips);
    var sv = el('div', 'fx-save'), nm = el('input'), sb = el('button', '', 'Save');
    nm.type = 'text'; nm.placeholder = 'Name this sound'; nm.maxLength = 24; nm.autocomplete = 'off'; sb.type = 'button';
    sb.addEventListener('click', function(){ if (F.saveCustom(nm.value)){ nm.value = ''; nm.blur(); AV.ui.toast('Preset saved'); } else AV.ui.toast('Type a name first'); });
    nm.addEventListener('keydown', function(e){ if (e.key === 'Enter') sb.click(); });
    sv.appendChild(nm); sv.appendChild(sb); c2.appendChild(sv); body.appendChild(c2);

    /* 3. equalizer */
    var c3 = el('div', 'fx-card'); c3.appendChild(el('h4', '', 'Bass and treble'));
    refs.bass = hSlider('Bass', -12, 12, .5, function(){ return F.settings.bass; }, F.setBass, sgn);
    refs.treble = hSlider('Treble', -12, 12, .5, function(){ return F.settings.treble; }, F.setTreble, sgn);
    c3.appendChild(refs.bass.row); c3.appendChild(refs.treble.row);
    c3.appendChild(el('h4', '', 'Equalizer'));
    var eq = el('div', 'fxeq'); for (var i = 0; i < 5; i++){ var v = vSlider(i); refs.bands.push(v); eq.appendChild(v.node); } c3.appendChild(eq);
    var rs = el('button', 'chip', 'Reset to flat'); rs.type = 'button'; rs.style.margin = '0 0 14px'; rs.addEventListener('click', function(){ F.reset(); refresh(); }); c3.appendChild(rs);
    body.appendChild(c3);
    body.appendChild(el('p', 'fx-foot', 'Double-tap an equalizer slider to set it back to zero. Auto-adjust and volume levelling are tuned for typical music and never go beyond a gentle correction.'));
    refresh();
  }

  function chips(){
    refs.chips.textContent = '';
    var names = Object.keys(F.PRESETS).concat(F.settings.custom.map(function(c){ return c.name; }));
    names.forEach(function(n){
      var custom = !F.PRESETS[n], c = el('button', 'chip' + (F.settings.preset === n ? ' on' : ''), n); c.type = 'button';
      c.addEventListener('click', function(e){ if (e.target.tagName === 'I'){ F.deleteCustom(n); return; } F.usePreset(n); refresh(); });
      if (custom){ var x = el('i', '', '×'); x.setAttribute('aria-label', 'Delete preset'); c.appendChild(x); }
      refs.chips.appendChild(c);
    });
    if (F.settings.preset === 'Custom'){ var cu = el('button', 'chip on', 'Custom'); cu.type = 'button'; refs.chips.insertBefore(cu, refs.chips.firstChild); }
  }
  function refresh(){
    if (!refs.chips) return;
    ['on', 'auto', 'norm'].forEach(function(k){ var s = refs['sw_' + k]; s.classList.toggle('on', !!F.settings[k]); s.setAttribute('aria-checked', !!F.settings[k]); });
    var md = F.settings.xmode; Object.keys(refs.seg).forEach(function(k){ refs.seg[k].classList.toggle('on', k === md); });
    refs.xf.hidden = md === 'off'; refs.sfxSeg.hidden = refs.sfxHead.hidden = md === 'off';
    Object.keys(refs.sfx).forEach(function(k){ refs.sfx[k].classList.toggle('on', k === F.settings.sfx); });
    if (md === 'dj'){ refs.xin.min = 8; refs.xin.max = 32; refs.xin.step = 4; refs.xin.value = F.settings.xlen; refs.xout.textContent = F.settings.xlen + 's'; refs.xlab.textContent = 'Longest mix'; }
    else { refs.xin.min = 0; refs.xin.max = 12; refs.xin.step = 1; refs.xin.value = F.settings.xfade; refs.xout.textContent = F.settings.xfade ? F.settings.xfade + 's' : 'Off'; refs.xlab.textContent = 'Fade length'; }
    mixLine();
    var sm = F.settings.space; Object.keys(refs.sp).forEach(function(k){ refs.sp[k].classList.toggle('on', k === sm); });
    refs.orb.row.hidden = sm !== '8d'; refs.orb.update();
    refs.spNote.textContent = ({ off: '', wide: 'Widens the stereo picture. Mono recordings stay unchanged.', '8d': 'The sound circles your head once every ' + F.settings.orbit + ' seconds.', surround: 'Virtual 7.1: front, centre, side and back speakers placed around you.' })[sm]; refs.spNote.hidden = !refs.spNote.textContent;
    refs.bass.update(); refs.treble.update(); refs.bands.forEach(function(b){ b.update(); }); chips(); status();
  }
  function mixLine(){
    if (!refs.mix) return; var t = ''; try { t = AV.player.mixInfo(); } catch (e) {}
    refs.mix.textContent = t; refs.mix.hidden = !t;
  }
  function status(){
    if (!refs.stat) return;
    var s = F.status(), a = F.album;
    refs.stat.textContent = F.failed() ? 'Sound effects are not available on this device.' : (s ? 'This album: ' + s : (F.settings.auto || F.settings.norm ? 'Play a song and ALVéON will measure its album.' : ''));
    if (a && a.total > 1 && a.measured < a.total && (F.settings.auto || F.settings.norm)) refs.stat.textContent += (refs.stat.textContent ? '  ·  ' : '') + 'Measured ' + a.measured + ' of ' + a.total + ' songs';
    refs.stat.hidden = !refs.stat.textContent;
  }

  function open(){
    if (isOpen) return; isOpen = true; if (!refs.chips) build(); else refresh();
    root.hidden = false; void root.offsetWidth; root.classList.add('open');
    setTimeout(function(){ refs.bands.forEach(function(b){ b.update(); }); }, 80);
  }
  function close(){
    if (!isOpen) return; isOpen = false; root.classList.remove('open');
    setTimeout(function(){ if (!root.classList.contains('open')) root.hidden = true; }, 600);
  }

  AV.fxui = { open: open, close: close };
  document.addEventListener('DOMContentLoaded', init); if (document.readyState !== 'loading') init();
  var inited = false;
  function init(){
    if (inited || !$('fx')) return; inited = true;
    root = $('fx'); body = $('fx-body');
    $('fx-done').addEventListener('click', close);
    $('np-fx').addEventListener('click', open);
    AV.player.on(function(w){ if (isOpen && w === 'track') mixLine(); });
    F.on(function(w){ if (!isOpen) return; if (w === 'album' || w === 'failed'){ status(); mixLine(); } if (w === 'eq' && !dragging) refresh(); if (w === 'presets') chips(); });
  }
})();
