/* Navigation, the album page, import, and the editors for albums and songs. */
(function(){
  var AV = window.AV = window.AV || {};
  var U = AV.util, $ = U.$, S = AV.store, fmt = U.fmt;
  var app, albumEl, npEl, sheet, veil, toastEl, toastT = 0;
  var curAlbum = null, albumOpen = false, npOpen = false, pickAlbum = null, imgTarget = null;

  function el(tag, cls, text){ var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function icon(id, cls){
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'ic' + (cls ? ' ' + cls : ''));
    var u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.appendChild(u); return s;
  }
  function plural(n, w){ return n + ' ' + w + (n === 1 ? '' : 's'); }

  var ui = AV.ui = {};
  ui.toast = function(msg, ms){
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function(){ toastEl.classList.remove('show'); }, ms || 2600);
  };

  /* ---------- pages ---------- */
  function slideIn(e){ e.hidden = false; void e.offsetWidth; e.classList.add('open'); }
  function slideOut(e){ e.classList.remove('open'); setTimeout(function(){ if (!e.classList.contains('open')) e.hidden = true; }, 600); }
  function deep(){ app.classList.toggle('deep', albumOpen || npOpen); }

  ui.openAlbum = function(al){
    if (!al) return;
    curAlbum = al; paintAlbum(); albumEl.querySelector('.sheet-scroll').scrollTop = 0;
    albumOpen = true; slideIn(albumEl); deep();
  };
  function closeAlbum(){ albumOpen = false; slideOut(albumEl); deep(); }
  ui.openNP = function(){
    if (!AV.player.cur()) return;
    npOpen = true; slideIn(npEl); AV.player.setOpen(true); deep();
  };
  function closeNP(){ npOpen = false; AV.player.setOpen(false); slideOut(npEl); deep(); }

  function paintAlbum(){
    var al = curAlbum; if (!al) return;
    var pal = AV.palette(al), tr = S.tracksOf(al.id), ol = $('al-tracks'), P = AV.player;
    albumEl.style.setProperty('--c1', pal.mid); albumEl.style.setProperty('--c2', pal.deep);
    var img = al.coverUrl ? 'url("' + al.coverUrl + '")' : 'none';
    albumEl.style.setProperty('--img', img); $('al-cover').style.setProperty('--img', img);
    $('al-title').textContent = al.title; $('al-artist').textContent = al.artist || ' ';
    var total = tr.reduce(function(a, t){ return a + (t.dur || 0); }, 0);
    $('al-meta').textContent = tr.length ? plural(tr.length, 'song') + ' · ' + Math.max(1, Math.round(total / 60)) + ' min' : 'No songs yet';
    $('al-play').disabled = $('al-shuffle').disabled = !tr.length;
    ol.textContent = '';
    if (!tr.length){ ol.appendChild(el('li', 'nothing', 'This album is empty. Add songs from your Files app.')); return; }
    var cur = P.cur();
    tr.forEach(function(t, i){
      var li = el('li', 'row'); li.dataset.id = t.id;
      var no = el('span', 'no', String(i + 1));
      var nm = el('span', 'nm'); nm.appendChild(el('b', '', t.title));
      if (t.artist && t.artist !== al.artist) nm.appendChild(el('small', '', t.artist));
      var du = el('span', 'du', fmt(t.dur));
      var mo = el('button', 'mo'); mo.type = 'button'; mo.setAttribute('aria-label', 'Song options'); mo.appendChild(icon('i-more'));
      li.appendChild(no); li.appendChild(nm); li.appendChild(du); li.appendChild(mo);
      ol.appendChild(li);
    });
    markRows();
  }
  function markRows(){
    var P = AV.player, cur = P.cur(), rows = $('al-tracks').querySelectorAll('.row');
    Array.prototype.forEach.call(rows, function(li, i){
      var on = cur && li.dataset.id === cur.id, no = li.querySelector('.no');
      li.classList.toggle('on', !!on);
      if (on){
        if (!no.querySelector('.eq')){ no.textContent = ''; var q = el('span', 'eq'); q.appendChild(el('i')); q.appendChild(el('i')); q.appendChild(el('i')); no.appendChild(q); }
        no.querySelector('.eq').classList.toggle('paused', !P.playing);
      } else if (no.querySelector('.eq')) no.textContent = String(i + 1);
    });
  }

  /* ---------- mini player ---------- */
  function paintMini(){
    var t = AV.player.cur(), m = $('mini');
    if (!t){ m.hidden = true; return; }
    var al = S.album(t.albumId);
    $('mini-t').textContent = t.title; $('mini-a').textContent = t.artist || (al && al.artist) || '';
    $('mini-art').style.setProperty('--img', al && al.coverUrl ? 'url("' + al.coverUrl + '")' : 'none');
    m.hidden = false;
  }

  /* ---------- action sheets ---------- */
  function openSheetUI(){ veil.hidden = false; sheet.hidden = false; void sheet.offsetWidth; veil.classList.add('show'); sheet.classList.add('open'); }
  function closeSheetUI(cb){
    veil.classList.remove('show'); sheet.classList.remove('open');
    setTimeout(function(){ if (!sheet.classList.contains('open')){ sheet.hidden = true; veil.hidden = true; } if (cb) cb(); }, 420);
  }
  function startSheet(title, sub){
    sheet.textContent = ''; sheet.scrollTop = 0;
    sheet.appendChild(el('div', 'grabber'));
    if (title) sheet.appendChild(el('h3', '', title));
    if (sub) sheet.appendChild(el('p', 'sub', sub));
  }
  function actionList(items){
    var box = el('div', 'acts-list');
    items.forEach(function(it){
      var b = el('button', 'act' + (it.bad ? ' bad' : '')); b.type = 'button';
      b.appendChild(icon(it.icon)); b.appendChild(el('span', '', it.label));
      b.addEventListener('click', function(){ closeSheetUI(it.fn); }); box.appendChild(b);
    });
    sheet.appendChild(box);
  }
  function cancelBtn(){
    var b = el('button', 'pill-btn', 'Cancel'); b.type = 'button'; b.addEventListener('click', function(){ closeSheetUI(); }); sheet.appendChild(b);
  }
  function confirmSheet(title, sub, label, fn){
    startSheet(title, sub);
    var row = el('div', 'sheet-btns');
    var c = el('button', 'pill-btn', 'Cancel'); c.type = 'button'; c.addEventListener('click', function(){ closeSheetUI(); });
    var d = el('button', 'pill-btn bad', label); d.type = 'button'; d.addEventListener('click', function(){ closeSheetUI(fn); });
    row.appendChild(c); row.appendChild(d); sheet.appendChild(row); openSheetUI();
  }

  /* ---------- importing ---------- */
  function pickSongs(albumId){ pickAlbum = albumId || null; $('file-any').click(); }
  function onSongs(e){
    var files = Array.prototype.slice.call(e.target.files); e.target.value = '';
    if (!files.length) return;
    ui.toast('Reading ' + plural(files.length, 'song') + '…', 60000);
    S.importFiles(files, { albumId: pickAlbum }, function(i, n){ if (n > 1) ui.toast('Importing ' + i + ' of ' + n + '…', 60000); }).then(function(r){
      var msg = r.added ? 'Added ' + plural(r.added, 'song') : 'Nothing was added';
      if (r.bad) msg += ' · ' + r.bad + ' could not be read';
      ui.toast(msg, 3400);
      if (!pickAlbum && r.firstAlbum){
        var i = S.albums.indexOf(r.firstAlbum);
        if (i >= 0) setTimeout(function(){ AV.stack.scrollTo(i, true); }, 120);
      }
    }).catch(function(){ ui.toast('Something went wrong while importing', 3400); });
  }

  /* ---------- editors ---------- */
  function coverButton(initialUrl){
    var b = el('button', 'cv'); b.type = 'button'; b.appendChild(icon('i-image')); b.appendChild(el('span', '', 'Add cover'));
    function show(url){ if (url){ b.style.backgroundImage = 'url("' + url + '")'; b.classList.add('has'); } else { b.style.backgroundImage = ''; b.classList.remove('has'); } }
    show(initialUrl);
    return { btn: b, show: show };
  }
  function field(label, id, value, attrs){
    var l = el('label'); l.setAttribute('for', id); l.appendChild(document.createTextNode(label));
    var i = el('input'); i.id = id; i.type = 'text'; i.value = value || ''; i.maxLength = 90; i.autocomplete = 'off'; i.setAttribute('autocapitalize', 'words');
    if (attrs) for (var k in attrs) i.setAttribute(k, attrs[k]);
    l.appendChild(i); return { label: l, input: i };
  }
  function saveRow(onSave, label){
    var row = el('div', 'sheet-btns');
    var c = el('button', 'pill-btn', 'Cancel'); c.type = 'button'; c.addEventListener('click', function(){ closeSheetUI(); });
    var s = el('button', 'pill-btn primary', label || 'Save'); s.type = 'submit';
    row.appendChild(c); row.appendChild(s); return row;
  }

  function albumForm(al){
    var isNew = !al, pending = null, pendUrl = null;
    startSheet(isNew ? 'New album' : 'Edit album');
    var form = el('form'); form.style.display = 'grid'; form.style.gap = '14px';
    var row = el('div', 'frow');
    var cv = coverButton(al && al.coverUrl);
    var f = el('div', 'fields'); var ft = field('Album name', 'f-title', al ? al.title : ''), fa = field('Artist', 'f-artist', al ? al.artist : '');
    f.appendChild(ft.label); f.appendChild(fa.label); row.appendChild(cv.btn); row.appendChild(f);
    form.appendChild(row); form.appendChild(saveRow(null, isNew ? 'Create' : 'Save'));
    sheet.appendChild(form);
    cv.btn.addEventListener('click', function(){
      imgTarget = function(blob){ pending = blob; if (pendUrl) URL.revokeObjectURL(pendUrl); pendUrl = URL.createObjectURL(blob); cv.show(pendUrl); };
      $('file-img').click();
    });
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var title = ft.input.value.trim(), artist = fa.input.value.trim();
      if (!title){ ft.input.focus(); return; }
      closeSheetUI(function(){
        if (isNew){
          S.addAlbum({ title: title, artist: artist, cover: pending }).then(function(a){
            setTimeout(function(){ AV.stack.scrollTo(S.albums.indexOf(a), false); ui.openAlbum(a); }, 80);
          });
        } else S.updateAlbum(al, { title: title, artist: artist, cover: pending }).then(function(){ ui.toast('Saved'); });
      });
    });
    openSheetUI();
  }

  function trackForm(t){
    startSheet('Edit song');
    var form = el('form'); form.style.display = 'grid'; form.style.gap = '14px';
    var f = el('div', 'fields');
    var ft = field('Title', 'f-title', t.title), fa = field('Artist', 'f-artist', t.artist), fn = field('Track number', 'f-no', String(t.no || ''), { inputmode: 'numeric', pattern: '[0-9]*' });
    f.appendChild(ft.label); f.appendChild(fa.label); f.appendChild(fn.label);
    form.appendChild(f); form.appendChild(saveRow());
    sheet.appendChild(form);
    form.addEventListener('submit', function(e){
      e.preventDefault();
      closeSheetUI(function(){
        S.updateTrack(t, { title: ft.input.value.trim(), artist: fa.input.value.trim(), no: parseInt(fn.input.value, 10) || undefined }).then(function(){ ui.toast('Saved'); });
      });
    });
    openSheetUI();
  }

  function moveSheet(t){
    startSheet('Move to album', t.title);
    var items = S.albums.filter(function(a){ return a.id !== t.albumId; }).map(function(a){
      return { icon: 'i-music', label: a.title, fn: function(){ S.updateTrack(t, { albumId: a.id }).then(function(){ ui.toast('Moved to ' + a.title); }); } };
    });
    if (items.length) actionList(items); else sheet.appendChild(el('p', 'sub', 'There is no other album yet.'));
    cancelBtn(); openSheetUI();
  }

  function trackMenu(t){
    startSheet(t.title, t.artist);
    actionList([
      { icon: 'i-pen', label: 'Edit song', fn: function(){ trackForm(t); } },
      { icon: 'i-list', label: 'Move to another album', fn: function(){ moveSheet(t); } },
      { icon: 'i-trash', label: 'Delete song', bad: true, fn: function(){
        confirmSheet('Delete “' + t.title + '”?', 'It is removed from this phone.', 'Delete song', function(){ AV.player.dropTrack(t); S.deleteTrack(t).then(function(){ ui.toast('Song deleted'); }); });
      } }
    ]);
    cancelBtn(); openSheetUI();
  }

  function albumMenu(al){
    startSheet(al.title, al.artist);
    actionList([
      { icon: 'i-pen', label: 'Edit name and cover', fn: function(){ albumForm(al); } },
      { icon: 'i-plus', label: 'Add songs', fn: function(){ pickSongs(al.id); } },
      { icon: 'i-trash', label: 'Delete album', bad: true, fn: function(){
        confirmSheet('Delete “' + al.title + '”?', 'The album and its songs are removed from this phone.', 'Delete album', function(){
          S.tracksOf(al.id).forEach(function(t){ AV.player.dropTrack(t); });
          closeAlbum(); S.deleteAlbum(al).then(function(){ ui.toast('Album deleted'); });
        });
      } }
    ]);
    cancelBtn(); openSheetUI();
  }

  function addMenu(){
    startSheet('Add to your library', 'Everything stays on this phone and plays without a connection.');
    var items = [
      { icon: 'i-music', label: 'Import songs from Files', fn: function(){ pickSongs(null); } },
      { icon: 'i-plus', label: 'New album', fn: function(){ albumForm(null); } }
    ];
    if (S.albums.some(function(a){ return a.sample; })) items.push({ icon: 'i-trash', label: 'Remove sample albums', bad: true, fn: function(){
      confirmSheet('Remove sample albums?', 'Only the built-in sample music is removed.', 'Remove', function(){
        var list = S.albums.filter(function(a){ return a.sample; });
        list.reduce(function(p, a){
          return p.then(function(){ S.tracksOf(a.id).forEach(function(t){ AV.player.dropTrack(t); }); return S.deleteAlbum(a); });
        }, Promise.resolve()).then(function(){ ui.toast('Sample albums removed'); });
      });
    } });
    actionList(items); cancelBtn(); openSheetUI();
  }

  /* ---------- wiring ---------- */
  ui.init = function(){
    app = $('app'); albumEl = $('album'); npEl = $('np'); sheet = $('sheet'); veil = $('veil'); toastEl = $('toast');
    var P = AV.player;
    $('btn-add').addEventListener('click', addMenu); $('empty-add').addEventListener('click', addMenu);
    $('brand').addEventListener('click', function(){ AV.stack.scrollTo(0, true); });
    $('cap').addEventListener('click', function(){ ui.openAlbum(AV.stack.current()); });
    $('al-back').addEventListener('click', closeAlbum);
    $('al-more').addEventListener('click', function(){ if (curAlbum) albumMenu(curAlbum); });
    $('al-add').addEventListener('click', function(){ if (curAlbum) pickSongs(curAlbum.id); });
    $('al-play').addEventListener('click', function(){ if (curAlbum) P.playList(S.tracksOf(curAlbum.id), null, curAlbum.title, false); });
    $('al-shuffle').addEventListener('click', function(){ if (curAlbum) P.playList(S.tracksOf(curAlbum.id), null, curAlbum.title, true); });
    $('al-tracks').addEventListener('click', function(e){
      var li = e.target.closest('.row'); if (!li) return;
      var t = S.track(li.dataset.id); if (!t) return;
      if (e.target.closest('.mo')){ trackMenu(t); return; }
      if (P.cur() === t){ ui.openNP(); return; }
      P.playList(S.tracksOf(curAlbum.id), t, curAlbum.title);
    });
    $('mini-open').addEventListener('click', ui.openNP);
    $('np-down').addEventListener('click', closeNP);
    $('np-edit').addEventListener('click', function(){ var t = P.cur(); if (t) trackForm(t); });
    veil.addEventListener('click', function(){ closeSheetUI(); });
    $('file-any').addEventListener('change', onSongs);
    $('file-img').addEventListener('change', function(e){
      var f = e.target.files[0]; e.target.value = '';
      if (!f || !imgTarget) return;
      AV.toCover(f).then(function(b){ if (b) imgTarget(b); else ui.toast('That image could not be read'); });
    });

    P.on(function(w){
      if (w === 'track'){ paintMini(); if (albumOpen) markRows(); }
      if (w === 'state' && albumOpen) markRows();
    });
    S.on(function(w){
      if (w === 'albums'){ AV.stack.build(true); }
      if (w === 'tracks'){ AV.stack.refreshCaption(); }
      if (albumOpen){
        if (curAlbum && S.albums.indexOf(curAlbum) < 0) closeAlbum(); else paintAlbum();
      }
      paintMini();
    });
  };
})();
