/* ALVéON offline shell: cache every app file on first visit, then serve from the phone. */
var V = 'alveon-v3';
var FILES = ['./', 'index.html', 'manifest.webmanifest', 'css/app.css', 'css/sheets.css',
  'js/db.js', 'js/tags.js', 'js/media.js', 'js/synth.js', 'js/store.js', 'js/stack.js', 'js/player.js', 'js/ui.js', 'js/app.js',
  'img/logo.png', 'img/icon-180.png', 'img/icon-192.png', 'img/icon-512.png'];
self.addEventListener('install', function(e){
  e.waitUntil(caches.open(V).then(function(c){ return c.addAll(FILES); }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(ks){ return Promise.all(ks.filter(function(k){ return k !== V; }).map(function(k){ return caches.delete(k); })); }).then(function(){ return self.clients.claim(); }));
});
/* Network first: when online you always get the newest files (and they are re-saved); offline, the saved copy is served. */
self.addEventListener('fetch', function(e){
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(function(res){
      if (res && res.ok) { var copy = res.clone(); caches.open(V).then(function(c){ c.put(e.request, copy); }); }
      return res;
    }).catch(function(){
      return caches.match(e.request, { ignoreSearch: true }).then(function(r){ return r || caches.match('index.html'); });
    })
  );
});
