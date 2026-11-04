/* Screen diagnostics: tap the ALVéON logo 5 times. Only measures and reports; the test buttons change one thing at a time and can be reset. */
(function(){
  var AV = window.AV = window.AV || {};
  var panel = null, marker = null, current = 'none';

  function r1(n){ return Math.round(n * 10) / 10; }
  function wh(w, h){ return r1(w) + ' x ' + r1(h); }
  function rect(el){
    if (!el) return 'not found';
    var b = el.getBoundingClientRect();
    return 'x ' + r1(b.left) + '  y ' + r1(b.top) + '  w ' + r1(b.width) + '  h ' + r1(b.height) + '  bottom ' + r1(b.bottom);
  }
  function probe(css){
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:0;top:0;width:1px;visibility:hidden;pointer-events:none;' + css;
    document.body.appendChild(d);
    var cs = getComputedStyle(d), out = { h: d.offsetHeight, pt: cs.paddingTop, pr: cs.paddingRight, pb: cs.paddingBottom, pl: cs.paddingLeft, bottom: d.getBoundingClientRect().bottom };
    d.remove(); return out;
  }
  function meta(name){ var m = document.querySelector('meta[name="' + name + '"]'); return m ? m.getAttribute('content') : '(none)'; }
  function mq(q){ try { return matchMedia(q).matches; } catch (e) { return 'n/a'; } }
  function cs(el, props){ if (!el) return 'n/a'; var s = getComputedStyle(el); return props.map(function(p){ return p + ':' + s.getPropertyValue(p); }).join('  '); }

  function collect(){
    var L = [], de = document.documentElement, vv = window.visualViewport, app = document.getElementById('app');
    function sec(t){ L.push(''); L.push('== ' + t + ' =='); }
    function row(k, v){ L.push(k + ': ' + v); }

    sec('Sizes');
    row('window.innerHeight', window.innerHeight + '   (innerWidth ' + window.innerWidth + ')');
    row('window.outerHeight', window.outerHeight + '   (outerWidth ' + window.outerWidth + ')');
    row('documentElement.clientHeight', de.clientHeight + '   (clientWidth ' + de.clientWidth + ')');
    row('body.clientHeight', document.body.clientHeight);
    row('visualViewport.height', vv ? r1(vv.height) + '   (width ' + r1(vv.width) + ', scale ' + r1(vv.scale) + ', offsetTop ' + r1(vv.offsetTop) + ', pageTop ' + r1(vv.pageTop) + ')' : 'n/a');
    row('screen', screen.width + ' x ' + screen.height + '   (avail ' + screen.availWidth + ' x ' + screen.availHeight + ')');
    row('devicePixelRatio', window.devicePixelRatio);
    row('orientation', (screen.orientation && screen.orientation.type) || (window.orientation + ' deg'));
    row('scroll', 'window ' + window.pageXOffset + ',' + window.pageYOffset + '  doc scrollHeight ' + de.scrollHeight);
    row('screen.height - clientHeight', (screen.height - de.clientHeight));

    sec('Safe-area insets');
    var sa = probe('padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);');
    row('env() top / right / bottom / left', sa.pt + ' / ' + sa.pr + ' / ' + sa.pb + ' / ' + sa.pl);
    var rs = getComputedStyle(de);
    row('app variables --st / --sb', rs.getPropertyValue('--st').trim() + ' / ' + rs.getPropertyValue('--sb').trim());

    sec('Height units (CSS probes)');
    ['100%', '100vh', '100dvh', '100svh', '100lvh', '-webkit-fill-available'].forEach(function(u){
      var p = probe('height:' + u + ';'); row('height: ' + u, p.h);
    });
    row('fixed element at bottom:0 ends at', probe('top:auto;bottom:0;height:1px;').bottom);
    var hit = document.elementFromPoint(window.innerWidth / 2, Math.max(0, screen.height - 6));
    row('element at 6px above screen bottom', hit ? (hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '')) : 'none');

    sec('Top bar and app boxes');
    row('top bar (.top)', rect(document.querySelector('#lib .top')));
    row('logo button', rect(document.getElementById('brand')));
    row('add button', rect(document.getElementById('btn-add')));
    row('#app', rect(app));
    row('#lib', rect(document.getElementById('lib')));
    row('#app inline height', (app && app.style.height) || '(none)');

    sec('Home Screen app setup');
    var vm = document.querySelector('meta[name="viewport"]');
    row('viewport meta', vm ? vm.getAttribute('content') : '(none)');
    var ml = document.querySelector('link[rel="manifest"]');
    row('manifest link', ml ? ml.getAttribute('href') : '(none)');
    row('apple-mobile-web-app-capable', meta('apple-mobile-web-app-capable'));
    row('mobile-web-app-capable', meta('mobile-web-app-capable'));
    row('apple status-bar-style', meta('apple-mobile-web-app-status-bar-style'));
    row('apple web-app title', meta('apple-mobile-web-app-title'));
    row('theme-color meta', meta('theme-color'));
    row('navigator.standalone', String(navigator.standalone));
    row('display-mode standalone / fullscreen / browser', mq('(display-mode: standalone)') + ' / ' + mq('(display-mode: fullscreen)') + ' / ' + mq('(display-mode: browser)'));
    row('html style', cs(de, ['position', 'height', 'min-height', 'overflow']));
    row('body style', cs(document.body, ['position', 'height', 'min-height', 'overflow']));
    row('#app style', cs(app, ['position', 'top', 'bottom', 'height', 'overflow']));
    row('marker bar', marker ? rect(marker) : '(no test active)');
    row('user agent', navigator.userAgent);
    row('active test', current);
    return L.join('\n');
  }

  function addManifest(txt, done){
    var ml = document.querySelector('link[rel="manifest"]');
    if (!ml || !window.fetch) { done(txt); return; }
    fetch(ml.href, { cache: 'no-store' }).then(function(r){ return r.json(); }).then(function(j){
      done(txt + '\n\n== manifest file ==\ndisplay: ' + j.display + '\norientation: ' + j.orientation + '\nstart_url: ' + j.start_url + '\nscope: ' + j.scope + '\ntheme_color: ' + j.theme_color + '\nbackground_color: ' + j.background_color);
    }).catch(function(){ done(txt + '\n\n== manifest file ==\n(could not be read)'); });
  }

  function setMarker(on){
    var app = document.getElementById('app');
    if (marker) { marker.remove(); marker = null; }
    if (on && app) {
      marker = document.createElement('div');
      marker.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:8px;background:#ff3b30;z-index:98';
      marker.addEventListener('click', function(){ marker.style.background = '#34c759'; });
      app.appendChild(marker);
    }
  }
  /* Each test changes ONE layout idea. Reset puts every touched style back first. */
  var TESTS = {
    lvh:    { label: 'Test 1: app height 100lvh (fixed)',            app: { height: '100lvh' } },
    vh:     { label: 'Test 2: app height 100vh (fixed)',             app: { height: '100vh' } },
    abs:    { label: 'Test 3: app absolute, height 100lvh',          app: { position: 'absolute', top: '0', bottom: 'auto', height: '100lvh' } },
    page:   { label: 'Test 4: page 100lvh, app absolute inside',     html: { height: '100lvh' }, body: { height: '100lvh', overflow: 'visible' }, app: { position: 'absolute', top: '0', bottom: 'auto', height: '100%' } }
  };
  var TOUCHED = { html: ['height', 'overflow'], body: ['height', 'overflow'], app: ['position', 'top', 'bottom', 'height'] };
  function styleOf(k){ return k === 'html' ? document.documentElement : k === 'body' ? document.body : document.getElementById('app'); }
  function resetAll(){ Object.keys(TOUCHED).forEach(function(k){ var el = styleOf(k); TOUCHED[k].forEach(function(p){ el.style[p] = ''; }); }); window.scrollTo(0, 0); }
  function apply(name){
    resetAll(); current = name; setMarker(false);
    var t = TESTS[name]; if (!t) { current = 'none'; return; }
    ['html', 'body', 'app'].forEach(function(k){ if (t[k]) Object.keys(t[k]).forEach(function(p){ styleOf(k).style[p] = t[k][p]; }); });
    setMarker(true);
  }

  function btn(label, fn, primary){
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = label;
    b.style.cssText = 'flex:1 1 auto;padding:9px 10px;border-radius:10px;font:600 12px -apple-system,sans-serif;color:' + (primary ? '#000' : '#fff') + ';background:' + (primary ? '#fff' : 'rgba(255,255,255,.16)');
    b.addEventListener('click', fn); return b;
  }

  function show(){
    if (panel) { panel.remove(); panel = null; return; }
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;left:8px;right:8px;top:calc(var(--st,0px) + 8px);z-index:99;max-height:82vh;display:flex;flex-direction:column;border-radius:14px;background:rgba(0,0,0,.92);color:#fff;border:1px solid rgba(255,255,255,.2);font:11px/1.45 ui-monospace,Menlo,monospace';
    var pre = document.createElement('pre');
    pre.style.cssText = 'margin:0;padding:12px;overflow:auto;white-space:pre-wrap;word-break:break-word;flex:1 1 auto;-webkit-user-select:text;user-select:text;-webkit-overflow-scrolling:touch';
    var note = document.createElement('div');
    note.style.cssText = 'padding:8px 12px;border-top:1px solid rgba(255,255,255,.16);font:11px/1.4 -apple-system,sans-serif;color:rgba(255,255,255,.7)';
    note.textContent = 'Tests change one thing at a time. A red bar appears at the bottom of the app. If it sits at the very bottom edge of your screen, that test reaches the bottom. Tap the bar: it turns green if it receives the tap.';
    var tests = document.createElement('div'); tests.style.cssText = 'display:flex;gap:6px;padding:0 10px 8px;flex-wrap:wrap';
    var acts = document.createElement('div'); acts.style.cssText = 'display:flex;gap:6px;padding:8px 10px 10px;border-top:1px solid rgba(255,255,255,.16)';

    var last = '';
    function refresh(){ pre.textContent = 'Measuring…'; setTimeout(function(){ addManifest(collect(), function(t){ last = t; pre.textContent = t; }); }, 60); }
    Object.keys(TESTS).forEach(function(n){ tests.appendChild(btn(TESTS[n].label, function(){ apply(n); refresh(); })); });
    tests.appendChild(btn('Reset test', function(){ apply('none'); refresh(); }));
    acts.appendChild(btn('Copy report', function(){
      function done(ok){ this.textContent = ok ? 'Copied' : 'Select and copy'; }
      var self = this;
      try { navigator.clipboard.writeText(last).then(function(){ self.textContent = 'Copied'; }, function(){ self.textContent = 'Select the text'; }); } catch (e) { self.textContent = 'Select the text'; }
    }, true));
    acts.appendChild(btn('Measure again', refresh));
    acts.appendChild(btn('Close', function(){ panel.remove(); panel = null; }));
    panel.appendChild(pre); panel.appendChild(note); panel.appendChild(tests); panel.appendChild(acts);
    document.body.appendChild(panel); refresh();
  }

  AV.diag = { show: show, collect: collect, apply: apply };
})();
