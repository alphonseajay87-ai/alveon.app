/* Playback log: quietly notes anything odd about playback (a stall, a quiet moment, a paused song, a failed blend) so it can be read in the diagnostics page (tap the ALVéON logo 5 times). Only watches; changes nothing. */
(function(){
  var AV = window.AV = window.AV || {}, KEY = 'alveon.plog', ev = [], lastCt = null, lastAt = 0, quiet = 0, saveT = 0, beat = 0, wired = false, ctxBad = 0;
  try { ev = JSON.parse(localStorage.getItem(KEY) || '[]'); if (!Array.isArray(ev)) ev = []; } catch (e) { ev = []; }
  function ts(){ var d = new Date(); return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + ' ' + d.toTimeString().slice(0, 8); }
  function save(force){ var n = Date.now(); if (!force && n - saveT < 2500) return; saveT = n; try { localStorage.setItem(KEY, JSON.stringify(ev.slice(-120))); } catch (e) {} }
  function log(kind, msg){ ev.push(ts() + '  ' + kind + '  ' + msg); if (ev.length > 200) ev.shift(); save(kind !== 'ok'); }
  function title(){ var P = AV.player, c = P && P.cur && P.cur(); return c ? c.title : '-'; }
  function wire(){
    var P = AV.player, F = AV.fx; if (wired || !P || !F || !P.deck) return; wired = true;
    P.deck.els().forEach(function(el, i){
      ['waiting', 'stalled', 'emptied', 'abort'].forEach(function(n){ el.addEventListener(n, function(){ if (P.playing && el === P.el()) log('WARN', 'element ' + i + ' ' + n + ' at ' + el.currentTime.toFixed(1) + 's, ready ' + el.readyState + ' (' + title() + ')'); }); });
      el.addEventListener('error', function(){ log('ERROR', 'element ' + i + ' media error ' + (el.error ? el.error.code : '?') + ' (' + title() + ')'); });
      el.addEventListener('pause', function(){ if (P.playing && el === P.el() && !el.ended) log('WARN', 'song paused by the system at ' + el.currentTime.toFixed(1) + 's (' + title() + ')'); });
    });
    if (F.beginMix){ var ob = F.beginMix; F.beginMix = function(){ var r = ob.apply(this, arguments); log(r ? 'ok' : 'ERROR', 'blend ' + (r ? 'started' : 'FAILED to start')); return r; }; }
    if (F.rescue){ var orr = F.rescue; F.rescue = function(){ log('WARN', 'blend cancelled, old song restored (' + title() + ')'); return orr.apply(this, arguments); }; }
  }
  document.addEventListener('visibilitychange', function(){ log('ok', 'app ' + (document.hidden ? 'went to the background' : 'came back') + ' (' + title() + ')'); save(true); });
  window.addEventListener('error', function(e){ log('ERROR', 'script error: ' + String(e.message || '').slice(0, 90) + ' (' + String(e.filename || '').split('/').pop() + ':' + (e.lineno || 0) + ')'); });
  window.addEventListener('unhandledrejection', function(e){ var r = e.reason; log('ERROR', 'promise error: ' + String(r && r.message || r).slice(0, 90)); });
  window.addEventListener('pagehide', function(){ save(true); });
  setInterval(function(){
    wire(); var P = AV.player, F = AV.fx; if (!P || !P.playing || !P.cur()){ lastCt = null; quiet = 0; return; }
    var el = P.el(), now = Date.now(); if (!el) return;
    if (lastCt === null || el.currentTime !== lastCt || el.paused || el.seeking){ lastCt = el.currentTime; lastAt = now; }
    else if (now - lastAt > 1800 && !document.hidden){ log('STALL', 'song stopped moving at ' + el.currentTime.toFixed(1) + 's, ready ' + el.readyState + ', net ' + el.networkState + ' (' + title() + ')'); lastAt = now; }
    if (el.muted) log('WARN', 'element is muted');
    var lv = F && F.levels && F.levels();
    if (lv && !P.deckMode){ var mx = Math.max(lv.A.fade, lv.B.fade); if (mx < .35 && !el.paused){ if (++quiet === 3) log('QUIET', 'sound level very low for 1.5 s: A ' + lv.A.fade + ' B ' + lv.B.fade + ' (' + title() + ')'); } else quiet = 0; }
    var cs = F && F.state && F.state(); if (cs && cs !== 'running' && !document.hidden){ if (++ctxBad === 3) log('CTX', 'audio engine is ' + cs + ' while playing'); } else ctxBad = 0;
    if (++beat % 60 === 0) log('ok', 'playing ' + title() + ' at ' + el.currentTime.toFixed(0) + 's');
  }, 500);
  AV.playlog = {
    report: function(){
      var bad = ev.filter(function(l){ return /  (STALL|QUIET|WARN|ERROR|CTX|SILENT|SAFE)  /.test(l); }).length;
      return 'PLAYBACK LOG\n' + (bad ? bad + ' odd moment(s) noted:' : 'No stalls, quiet moments or errors noted.') + '\n' + ev.slice(-60).join('\n');
    },
    note: log,
    rewire: function(){ wired = false; },
    clear: function(){ ev = []; save(true); }
  };
})();
