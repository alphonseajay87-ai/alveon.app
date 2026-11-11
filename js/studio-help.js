/* Studio guide: a small "?" button and a short how-to card, plus plain labels on the decks. Only adds hints; changes no mixing behaviour. */
(function(){
  var AV = window.AV = window.AV || {}, seen = 'alveon.sthelp';
  var STEPS = [
    ['1', 'Pick two songs', 'Tap the top card for song 1 and the bottom card for song 2.'],
    ['2', 'Place the blend', 'Drag a waveform sideways to choose where it sits. Drag the round handle at the end of the window to make the blend longer or shorter.'],
    ['3', 'Choose a style', 'Tap Auto, Fade, Rise, Blend or Cut. Tap a row below to fine tune volume, bass or filter.'],
    ['4', 'Preview, then Save', 'Preview plays the blend from its start. Save keeps it for these two songs.']
  ];
  function safe(f){ try { return f(); } catch (e) { return null; } }
  function card(){
    var c = document.getElementById('st-help'); if (c) return c;
    c = document.createElement('div'); c.id = 'st-help'; c.className = 'st-help'; c.hidden = true;
    c.innerHTML = '<div class="sh-bg"></div><div class="sh-card"><i class="st-grab"></i><h3>Mix Studio</h3>' + STEPS.map(function(s){ return '<div class="sh-row"><b>' + s[0] + '</b><div><strong>' + s[1] + '</strong><span>' + s[2] + '</span></div></div>'; }).join('') +
      '<p class="sh-tip">Green key colours show how well the two songs match. Pinch the waveform to zoom. Double tap to reset the zoom.</p><button type="button" class="sh-ok">Got it</button></div>';
    c.addEventListener('click', function(e){ if (e.target.classList.contains('sh-bg') || e.target.classList.contains('sh-ok')) c.hidden = true; });
    document.getElementById('studio').appendChild(c); return c;
  }
  function show(){ card().hidden = false; safe(function(){ localStorage.setItem(seen, '1'); }); }
  function addButton(){
    var top = document.querySelector('#studio .st-top'); if (!top || top.querySelector('.st-help-b')) return;
    var b = document.createElement('button'); b.type = 'button'; b.className = 'st-help-b'; b.setAttribute('aria-label', 'How to use the Studio'); b.textContent = '?';
    b.addEventListener('click', show); top.insertBefore(b, document.getElementById('st-save'));
  }
  function hint(){
    var bl = document.getElementById('st-blend'); if (!bl || bl.querySelector('.st-hint')) return;
    var h = document.createElement('div'); h.className = 'st-hint'; h.textContent = 'Drag a song to place it · drag the handle to set the length';
    var stage = bl.querySelector('.st-stage'); bl.insertBefore(h, stage);
  }
  function labelDecks(){
    var ctl = document.getElementById('dk-ctl'); if (!ctl || ctl.querySelector('.dk-lab')) return;
    ctl.querySelectorAll('.dk-col').forEach(function(col, i){
      var l = document.createElement('div'); l.className = 'dk-lab ' + (i ? 'b' : 'a'); l.textContent = i ? 'DECK B · song 2' : 'DECK A · song 1'; col.insertBefore(l, col.firstChild);
      var tips = { play: 'Play or pause this deck', cue: 'Jump back to the cue point', setcue: 'Remember the current spot as the cue', loop: 'Repeat a short loop', bass: 'Cut the bass on this deck', sync: 'Match the tempo and beat to the other deck' };
      col.querySelectorAll('button[data-a]').forEach(function(b){ b.title = tips[b.getAttribute('data-a')] || ''; });
    });
    var x = document.querySelector('.dk-xl'); if (x && !x.querySelector('small')){ var s = document.createElement('small'); s.className = 'dk-xs'; s.textContent = 'Crossfader: slide from song 1 to song 2'; x.parentNode.insertBefore(s, x.nextSibling); }
  }
  var DESC = { auto: 'Picks the best style for these two songs.', fade: 'A simple smooth fade between the songs.', rise: 'Builds up with a riser, then drops into song 2.', blend: 'Both songs play together, bass handed over smoothly.', cut: 'A quick, sharp switch from song 1 to song 2.', custom: 'Your own settings.' };
  function presetNote(){
    var pre = document.getElementById('st-pre'); if (!pre) return;
    var on = pre.querySelector('button.on'), n = document.getElementById('st-pre-d');
    if (!n){ n = document.createElement('div'); n.id = 'st-pre-d'; n.className = 'st-pre-d'; pre.parentNode.insertBefore(n, pre.nextSibling); }
    var t = on ? (DESC[on.getAttribute('data-p')] || '') : ''; if (n.textContent !== t) n.textContent = t;
  }
  function tick(){ addButton(); hint(); labelDecks(); presetNote(); }
  document.addEventListener('DOMContentLoaded', function(){
    var root = document.getElementById('studio'); if (!root) return;
    new MutationObserver(tick).observe(root, { childList: true, subtree: true }); tick();
  });
  AV.studioHelp = { show: show };
})();
