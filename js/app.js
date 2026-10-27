/* Start-up: load the library, play the opening animation (mark becomes the name), then bring in the stack. */
(function(){
  var AV = window.AV = window.AV || {};
  var $ = AV.util.$;
  var EASE = 'cubic-bezier(.22,.8,.24,1)';

  function opening(dataReady){
    var sp = $('splash'), row = $('sp-row'), m = $('sp-m'), mark = $('sp-mark'), glow = $('sp-glow'), text = $('sp-text'), veil = $('sp-veil'), brand = $('brand');
    var fast = location.hash === '#fast' || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    var anims = [], over = false, timers = [], canAnimate = !!(mark.animate);
    brand.style.visibility = 'hidden';
    /* the library is never held back: wait for data, but never longer than 2.5s */
    var ready = Promise.race([dataReady, new Promise(function(r){ setTimeout(r, 2500); })]);

    return new Promise(function(done){
      function finish(){
        if (over) return; over = true;
        timers.forEach(clearTimeout);
        anims.forEach(function(a){ try { a.cancel(); } catch (e) {} });
        brand.style.visibility = ''; sp.hidden = true;
        done();
      }
      function later(fn, ms){ timers.push(setTimeout(fn, ms)); }
      function an(el, kf, o){ var a = el.animate(kf, o); anims.push(a); return a; }

      if (fast || !canAnimate){ ready.then(finish); return; }
      /* hard stop: whatever happens, the splash is gone after 7s */
      later(function(){ ready.then(finish); }, 7000);
      sp.addEventListener('click', function(){ ready.then(finish); });

      var tw = text.offsetWidth + 2;          /* width the letters will take */
      var S = 2.7;                                       /* mark starts big, centred on its own */
      var T = 1500, D = 1100;                            /* when the mark shrinks into the A */

      /* 1. the mark glows into view, big and alone */
      an(mark, [{ opacity: 0 }, { opacity: 1 }], { duration: 900, easing: 'ease-out', fill: 'forwards' });
      an(glow, [{ opacity: 0 }, { opacity: 1, offset: .5 }, { opacity: .45 }], { duration: 1500, fill: 'forwards' });
      an(m, [
        { transform: 'translateX(' + (tw / 2) + 'px) scale(' + (S * .86) + ')' },
        { transform: 'translateX(' + (tw / 2) + 'px) scale(' + S + ')' }
      ], { duration: T, easing: 'ease-out', fill: 'forwards' });

      /* 2. it shrinks into the A, and L V é O N write themselves in beside it */
      an(m, [
        { transform: 'translateX(' + (tw / 2) + 'px) scale(' + S + ')' },
        { transform: 'translateX(0px) scale(1)' }
      ], { duration: D, delay: T, easing: EASE, fill: 'forwards' });
      an(glow, [{ opacity: .45 }, { opacity: 0 }], { duration: D, delay: T, fill: 'forwards' });
      Array.prototype.forEach.call(text.children, function(ch, i){
        an(ch, [
          { opacity: 0, transform: 'translateX(-14px)' },
          { opacity: 1, transform: 'translateX(0)' }
        ], { duration: 650, delay: T + 220 + i * 90, easing: EASE, fill: 'forwards' });
      });

      /* 3. the name settles into the header and the stack rises */
      var T3 = T + D + 700;
      later(function(){
        ready.then(function(){
          if (over) return;
          var r = row.getBoundingClientRect(), b = brand.getBoundingClientRect();
          var k = b.width / r.width, dx = b.left - r.left, dy = (b.top + b.height / 2) - (r.top + r.height * k / 2);
          an(row, [{ transform: 'translate(0,0) scale(1)' }, { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + k + ')' }], { duration: 900, easing: EASE, fill: 'forwards' });
          an(veil, [{ opacity: 1 }, { opacity: 0 }], { duration: 700, easing: 'ease-out', fill: 'forwards' });
          try { AV.stack.intro(); } catch (e) {}
          later(finish, 960);
        });
      }, T3);
    });
  }

  /* Hidden help: tap the logo 5 times to see the screen numbers this phone reports. */
  function diag(){
    var el = document.createElement('pre');
    el.style.cssText = 'position:fixed;left:12px;right:12px;top:90px;z-index:99;margin:0;padding:12px;border-radius:12px;background:rgba(0,0,0,.85);color:#fff;font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap';
    var p = document.createElement('div'); p.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px';
    document.body.appendChild(p);
    var vv = window.visualViewport;
    el.textContent = ['inner ' + innerWidth + 'x' + innerHeight, 'client ' + document.documentElement.clientWidth + 'x' + document.documentElement.clientHeight,
      'visual ' + (vv ? Math.round(vv.width) + 'x' + Math.round(vv.height) : '-'), 'screen ' + screen.width + 'x' + screen.height,
      'app ' + Math.round($('app').getBoundingClientRect().height), 'fixedBottom ' + Math.round(p.getBoundingClientRect().bottom),
      'standalone ' + (navigator.standalone === true)].join('\n');
    p.remove(); el.onclick = function(){ el.remove(); }; document.body.appendChild(el);
  }
  (function(){ var n = 0, t; var b = $('brand'); if (!b) return; b.addEventListener('click', function(){ n++; clearTimeout(t); t = setTimeout(function(){ n = 0; }, 1500); if (n >= 5){ n = 0; diag(); } }); })();

  function boot(){
    var ready = AV.store.load().then(AV.store.seed).catch(function(){}).then(function(){
      AV.stack.build();
    });
    AV.ui.init(); AV.player.init();
    opening(ready).then(function(){ AV.stack.skipIntro(); AV.keepData(); });
    if (location.hash === '#fast') ready.then(function(){ AV.stack.skipIntro(); });
  }

  /* Offline shell: when the app is hosted over https, the service worker keeps every file on the phone. */
  try { if ('serviceWorker' in navigator && document.querySelector('link[rel=manifest]') && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').then(function(r){ try { r.update(); } catch (e) {} }).catch(function(){}); } catch (e) {}

  /* when a newer version takes over, load it once */
  try { if ('serviceWorker' in navigator) { var had = !!navigator.serviceWorker.controller; navigator.serviceWorker.addEventListener('controllerchange', function(){ if (had && !window.__reloaded) { window.__reloaded = true; location.reload(); } }); } } catch (e) {}

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
