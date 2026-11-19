/*
  Machine report: everything Claude needs to understand the app's state without asking questions.
  Built from facts only (no tokens, no file names beyond the current song). Used by the diagnostics page (tap the logo 5 times, Copy report).
*/
(function(){
  var AV = window.AV = window.AV || {};
  AV.version = 'v47';
  function safe(f, d){ try { var v = f(); return v === undefined ? d : v; } catch (e) { return d === undefined ? ('ERR ' + (e && e.message)) : d; } }
  function r2(n){ return typeof n === 'number' && isFinite(n) ? Math.round(n * 100) / 100 : n; }
  function elInfo(el, i){ return el ? { i: i, current: el === (AV.player && AV.player.el && AV.player.el()), paused: el.paused, ended: el.ended, t: r2(el.currentTime), dur: r2(el.duration), ready: el.readyState, net: el.networkState, muted: el.muted, hasSrc: !!(el.currentSrc || el.src), err: el.error ? el.error.code : 0 } : null; }
  function build(){
    var P = AV.player, F = AV.fx, S = AV.store, c = P && P.cur && P.cur();
    var cs = getComputedStyle(document.documentElement), vv = window.visualViewport;
    var o = {
      schema: 'alveon-report/1',
      generated: new Date().toISOString(),
      app: { version: AV.version, scripts: Array.prototype.map.call(document.scripts, function(x){ return (x.getAttribute('src') || '').replace(/^js\//, ''); }).filter(Boolean) },
      env: {
        ua: navigator.userAgent, standalone: !!navigator.standalone, displayStandalone: safe(function(){ return matchMedia('(display-mode: standalone)').matches; }, false),
        online: navigator.onLine, lang: navigator.language, tz: safe(function(){ return Intl.DateTimeFormat().resolvedOptions().timeZone; }),
        dpr: window.devicePixelRatio, screen: [screen.width, screen.height], inner: [innerWidth, innerHeight], outer: [outerWidth, outerHeight],
        visualViewport: vv ? [r2(vv.width), r2(vv.height), r2(vv.scale)] : null, hidden: document.hidden,
        safeArea: { top: cs.getPropertyValue('--st').trim(), bottom: cs.getPropertyValue('--sb').trim() },
        app_box: safe(function(){ var b = document.getElementById('app').getBoundingClientRect(); return [r2(b.left), r2(b.top), r2(b.width), r2(b.height)]; }),
        audioSessionType: safe(function(){ return navigator.audioSession ? navigator.audioSession.type + '/' + navigator.audioSession.state : 'unsupported'; }),
        memoryMB: safe(function(){ return performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null; }, null)
      },
      player: P ? {
        playing: !!P.playing, mix: !!P.mix, shuffle: !!P.shuffle, repeat: P.repeat, queue: P.list ? P.list.length : 0, pos: P.pos, ctx: P.ctx,
        track: c ? { id: c.id, title: c.title, artist: c.artist, dur: r2(c.dur), analysed: !!(F && F.analysisOf && F.analysisOf(c.id)) } : null,
        time: r2(safe(function(){ return P.time(); }, 0)), length: r2(safe(function(){ return P.length(); }, 0)),
        internals: safe(function(){ return P.debug(); }, null)
      } : null,
      audio: {
        elements: safe(function(){ return P.deck.els().map(elInfo); }, []),
        ctxState: safe(function(){ return F.state(); }), levels: safe(function(){ return F.levels(); }, null),
        outputLevel: safe(function(){ return F.outLevel ? r2(F.outLevel()) : null; }, null),
        safeMode: safe(function(){ return !!localStorage.getItem('alveon.safe'); }, false)
      },
      library: { albums: S ? S.albums.length : 0, tracks: S ? S.tracks.length : 0, sort: S && S.sortMode },
      overrides: safe(function(){ return Object.keys(JSON.parse(localStorage.getItem('alveon.xo') || '{}')).length; }, 0),
      log: safe(function(){ return AV.playlog.events(80); }, []),
      _help: 'log[].k: ok=info, WARN/STALL/QUIET/CTX=odd moment, ERROR=failure, SILENT=no sound heard and repaired, SAFE=fell back to plain playback. player.internals.interrupted=another app/lock screen paused it. audio.outputLevel~0 while playing=silence. env.app_box vs env.screen shows the bottom-strip problem.'
    };
    return o;
  }
  function text(){
    var o = build(), jobs = [];
    jobs.push(safe(function(){ return caches.keys().then(function(k){ o.app.cacheNames = k; }); }, Promise.resolve()));
    jobs.push(safe(function(){ return navigator.storage.estimate().then(function(e){ o.env.storageMB = { used: Math.round((e.usage || 0) / 1048576), quota: Math.round((e.quota || 0) / 1048576) }; }); }, Promise.resolve()));
    jobs.push(safe(function(){ return navigator.serviceWorker.getRegistration().then(function(r){ o.app.sw = r ? { active: !!r.active, waiting: !!r.waiting } : null; }); }, Promise.resolve()));
    return Promise.all(jobs.map(function(p){ return Promise.resolve(p).catch(function(){}); })).then(function(){
      return 'ALVEON-REPORT (for Claude: the JSON below is the full state of the app; schema alveon-report/1)\n```json\n' + '{\n' + Object.keys(o).map(function(k){ return JSON.stringify(k) + ': ' + JSON.stringify(o[k]); }).join(',\n') + '\n}' + '\n```';
    });
  }
  AV.report = { build: build, text: text };
})();
