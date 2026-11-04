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
  function deep(){ app.classList.toggle('deep', albumOpen || npOpen || searchOpen); }

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
  /* the strip some iPhones leave under the page takes the page colour, so it follows the sheet */
  function canvas(c){ document.documentElement.style.background = c || ''; }
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
  var busy = false, resumeJob = null, impEl = null;
  var AUDIO_RE = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|aiff?|aif|caf|mp4)$/i;
  function isAudio(f){ return AUDIO_RE.test(f.name || '') || /^audio\//.test(f.type || ''); }
  function pickSongs(albumId){ pickAlbum = albumId || null; $('file-any').click(); }

  /* progress card with a bar and a Cancel button; shared by every kind of import and download */
  function progressUI(title){
    if (!impEl){ impEl = el('div', 'imp'); impEl.id = 'imp'; app.appendChild(impEl); }
    impEl.textContent = '';
    var t = el('b', '', title), sub = el('small', '', 'Starting…'), bar = el('div', 'imp-bar'), fill = el('i'), x = el('button', 'imp-x', 'Cancel'); x.type = 'button';
    bar.appendChild(fill); impEl.appendChild(t); impEl.appendChild(sub); impEl.appendChild(bar); impEl.appendChild(x);
    void impEl.offsetWidth; impEl.classList.add('show');
    var o = { cancelled: false, onCancel: null,
      frac: function(f, txt){ fill.style.width = Math.max(0, Math.min(1, f)) * 100 + '%'; if (txt != null) sub.textContent = txt; },
      title: function(tx){ t.textContent = tx; },
      finish: function(msg, ms){ impEl.classList.remove('show'); if (msg) ui.toast(msg, ms || 4200); } };
    x.addEventListener('click', function(){ o.cancelled = true; x.disabled = true; x.textContent = 'Stopping…'; if (o.onCancel) try { o.onCancel(); } catch (e) {} });
    return o;
  }
  function summary(r){
    var parts = [];
    parts.push(r.added ? 'Added ' + plural(r.added, 'song') : 'Nothing new was added');
    if (r.skipped) parts.push(r.skipped + ' already here');
    if (r.bad) parts.push(r.bad + ' could not be read');
    if (r.left && r.left.length) parts.push(r.left.length + ' left · resume from + > Import music');
    return parts.join(' · ');
  }
  function focusNew(r){
    if (!pickAlbum && r.firstAlbum){ var i = S.albums.indexOf(r.firstAlbum); if (i >= 0) setTimeout(function(){ AV.stack.scrollTo(i, true); }, 160); }
  }
  /* import a list of files with progress, skipping duplicates; Cancel keeps what is done and offers Resume */
  function runImport(files, opts, title){
    if (busy){ ui.toast('Another import is still running'); return Promise.resolve(); }
    if (!files.length){ ui.toast('No songs found'); return Promise.resolve(); }
    busy = true; var pr = progressUI(title || 'Importing'), base = opts || {}, o = {}, k;
    for (k in base) o[k] = base[k]; o.cancel = function(){ return pr.cancelled; };
    return S.importFiles(files, o, function(i, n, f){ pr.frac((i - 1) / n, i + ' of ' + n + ' · ' + f.name); }).then(function(r){
      busy = false; resumeJob = r.left.length ? { kind: 'files', files: r.left, opts: base, title: title } : null;
      pr.frac(1); pr.finish(summary(r)); focusNew(r);
    }, function(){ busy = false; pr.finish('Something went wrong while importing'); });
  }
  function onSongs(e){
    var files = Array.prototype.slice.call(e.target.files).filter(isAudio); e.target.value = '';
    runImport(files, { albumId: pickAlbum }, files.length > 1 ? 'Importing songs' : 'Importing song');
  }
  /* a whole folder: the folder name becomes the album when songs have no album tag; cover.jpg / folder.jpg is used as the cover */
  function onFolder(e){
    var all = Array.prototype.slice.call(e.target.files); e.target.value = ''; pickAlbum = null;
    var covers = {};
    all.forEach(function(f){
      if (!/\.(jpe?g|png|webp)$/i.test(f.name)) return;
      var dir = (f.webkitRelativePath || '').replace(/[^\/]*$/, ''), pri = /^(cover|folder|front|album|artwork)/i.test(f.name) ? 0 : 1, c = covers[dir];
      if (!c || pri < c.p || (pri === c.p && f.size > c.f.size)) covers[dir] = { p: pri, f: f };
    });
    var audio = all.filter(isAudio).sort(function(a, b){ var x = a.webkitRelativePath || a.name, y = b.webkitRelativePath || b.name; return x.localeCompare(y, undefined, { numeric: true }); });
    audio.forEach(function(f){ var dir = (f.webkitRelativePath || '').replace(/[^\/]*$/, ''); if (covers[dir]){ f.avMeta = f.avMeta || {}; f.avMeta.cover = covers[dir].f; } });
    runImport(audio, {}, 'Importing folder');
  }

  /* an album in a .zip: unpacked one song at a time, so a big zip never has to fit in memory */
  function runZip(file){
    if (busy){ ui.toast('Another import is still running'); return; }
    busy = true; pickAlbum = null; var pr = progressUI('Opening zip'); pr.frac(0, file.name);
    var tot = { added: 0, skipped: 0, bad: 0, firstAlbum: null, left: [] }, aborted = null;
    AV.zip.list(file).then(function(entries){
      var audio = entries.filter(function(e){ return isAudio({ name: e.name }) && !/(^|\/)(__MACOSX\/|\._)/.test(e.name); });
      if (!audio.length) throw new Error('There are no songs in this zip');
      audio.sort(function(a, b){ return a.name.localeCompare(b.name, undefined, { numeric: true }); });
      function dirOf(n){ return n.replace(/[^\/]*$/, ''); }
      var dirs = {}; audio.forEach(function(e){ dirs[dirOf(e.name)] = 1; });
      var many = Object.keys(dirs).length > 1;
      var base = file.name.replace(/\.zip$/i, '').replace(/_+/g, ' ').trim(), m = base.match(/^(.+?)\s+-\s+(.+)$/), zt = m ? m[2].trim() : base, za = m ? m[1].trim() : '';
      var dk = Object.keys(dirs); if (!m && dk.length === 1 && dk[0]) zt = dk[0].replace(/\/$/, '').split('/').pop() || zt;
      var imgs = {}; entries.forEach(function(e){
        if (!/\.(jpe?g|png|webp)$/i.test(e.name) || /(^|\/)(__MACOSX\/|\._)/.test(e.name)) return;
        var d = dirOf(e.name), pri = /(^|\/)(cover|folder|front|album|artwork)[^\/]*$/i.test(e.name) ? 0 : 1, c = imgs[d];
        if (!c || pri < c.p || (pri === c.p && e.size > c.e.size)) imgs[d] = { p: pri, e: e };
      });
      var coverCache = {};
      function coverFor(d){
        var c = imgs[d] || (!many ? imgs[Object.keys(imgs)[0]] : null); if (!c) return Promise.resolve(null);
        var key = c.e.name; if (!coverCache[key]) coverCache[key] = AV.zip.read(file, c.e, 'image/jpeg').catch(function(){ return null; });
        return coverCache[key];
      }
      var n = audio.length, i = 0;
      return audio.reduce(function(chain, e){
        return chain.then(function(){
          if (aborted) return;
          if (pr.cancelled){ tot.left.push(e); return; }
          pr.frac(i / n, 'Unpacking ' + (++i) + ' of ' + n + ' · ' + e.name.replace(/^.*\//, ''));
          return AV.zip.read(file, e, 'audio/mpeg').then(function(blob){
            var nm = e.name.replace(/^.*\//, ''), f = new File([blob], nm, { type: blob.type || 'audio/mpeg' }), dir = dirOf(e.name);
            var lead = nm.match(/^(\d{1,3})[\s._-]/); f.avMeta = lead ? { no: parseInt(lead[1], 10) } : {};
            return coverFor(dir).then(function(cv){
              var fb = many ? { title: dir.replace(/\/$/, '').split('/').pop() || zt, artist: '', cover: cv } : { title: zt, artist: za, cover: cv };
              return S.importFiles([f], { fallback: fb }, null);
            });
          }).then(function(r){
            tot.added += r.added; tot.skipped += r.skipped; tot.bad += r.bad; if (!tot.firstAlbum) tot.firstAlbum = r.firstAlbum;
          }, function(err){
            if (err && /password|compression|iOS/.test(err.message)){ aborted = err; return; }
            tot.bad++;
          });
        });
      }, Promise.resolve());
    }).then(function(){
      busy = false;
      if (aborted){ pr.finish(aborted.message, 6000); return; }
      resumeJob = tot.left.length ? { kind: 'zip', file: file } : null; pr.frac(1); pr.finish(summary(tot)); focusNew(tot);
    }, function(err){ busy = false; pr.finish((err && err.message) || 'That zip could not be opened', 5200); });
  }
  function onZip(e){ var f = e.target.files[0]; e.target.value = ''; if (f) runZip(f); }

  function importMenu(){
    startSheet('Import music', 'Everything is copied onto this phone and plays offline. Songs you already have are skipped.');
    var items = [];
    if (resumeJob) items.push({ icon: 'i-play', label: 'Resume the last import', fn: function(){
      var j = resumeJob; resumeJob = null;
      if (j.kind === 'files') runImport(j.files, j.opts, j.title); else if (j.kind === 'zip') runZip(j.file);
    } });
    items.push({ icon: 'i-music', label: 'Songs from Files', fn: function(){ pickSongs(null); } });
    items.push({ icon: 'i-list', label: 'A whole folder', fn: function(){ pickAlbum = null; $('file-dir').click(); } });
    items.push({ icon: 'i-down', label: 'Album from a .zip', fn: function(){ $('file-zip').click(); } });
    actionList(items); cancelBtn(); openSheetUI();
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
      { icon: 'i-down', label: 'Import music', fn: importMenu },
      { icon: 'i-plus', label: 'New album', fn: function(){ albumForm(null); } }
    ];
    var az = S.sortMode === 'az';
    items.splice(2, 0, { icon: 'i-list', label: az ? 'Order albums by date added' : 'Order albums A to Z', fn: function(){
      var keep = AV.stack.current(); S.setSort(az ? 'added' : 'az'); S.emit('albums');
      if (keep) AV.stack.scrollTo(S.albums.indexOf(keep), false);
      ui.toast(az ? 'Albums in the order you added them' : 'Albums A to Z');
    } });
    items.splice(2, 0, { icon: 'i-eq', label: 'Sound & equalizer', fn: function(){ AV.fxui.open(); } });
    items.push({ icon: 'i-down', label: 'Back up library', fn: backupFlow });
    items.push({ icon: 'i-music', label: 'Restore from backup', fn: function(){ $('file-bak').click(); } });
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

  /* ---------- search ---------- */
  var srEl, srIn, srList, srClear, searchOpen = false, srTimer = 0;
  function norm(s){ return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
  function artEl(al){ var a = el('span', 'sr-art'); if (al){ var pal = AV.palette(al); a.style.setProperty('--bar', pal.bar); if (al.coverUrl) a.style.setProperty('--img', 'url("' + al.coverUrl + '")'); } return a; }
  function srRow(al, title, sub, on, fn, i){
    var b = el('button', 'sr-row' + (on ? ' on' : '')); b.type = 'button'; b.style.animationDelay = Math.min(i, 10) * 18 + 'ms';
    b.appendChild(artEl(al));
    var t = el('span', 'sr-t'); t.appendChild(el('b', '', title)); t.appendChild(el('small', '', sub)); b.appendChild(t);
    b.addEventListener('click', fn); return b;
  }
  function paintSearch(){
    var q = norm(srIn.value).trim(), terms = q ? q.split(/\s+/) : [];
    srClear.hidden = !srIn.value; srList.textContent = ''; srList.scrollTop = 0;
    if (!terms.length){
      var e0 = el('div', 'sr-empty'); e0.appendChild(icon('i-search')); e0.appendChild(el('b', '', 'Search your library'));
      e0.appendChild(el('span', '', plural(S.tracks.length, 'song') + ' in ' + plural(S.albums.length, 'album')));  srList.appendChild(e0); return;
    }
    function hit(s){ var n = norm(s); return terms.every(function(t){ return n.indexOf(t) >= 0; }); }
    var albums = S.albums.filter(function(a){ return hit(a.title + ' ' + (a.artist || '')); });
    var songs = S.tracks.filter(function(t){ var al = S.album(t.albumId); return hit(t.title + ' ' + (t.artist || '') + ' ' + (al ? al.title + ' ' + (al.artist || '') : '')); });
    if (!albums.length && !songs.length){
      var e1 = el('div', 'sr-empty'); e1.appendChild(icon('i-search')); e1.appendChild(el('b', '', 'No results'));
      e1.appendChild(el('span', '', 'Nothing matches “' + srIn.value.trim() + '”. Try a different spelling.')); srList.appendChild(e1); return;
    }
    var n = 0;
    if (albums.length){
      srList.appendChild(el('div', 'sr-h', 'Albums'));
      albums.slice(0, 30).forEach(function(a){
        var c = S.tracksOf(a.id).length;
        srList.appendChild(srRow(a, a.title, (a.artist ? a.artist + ' · ' : '') + plural(c, 'song'), false, function(){ closeSearch(true); setTimeout(function(){ ui.openAlbum(a); }, 60); }, n++));
      });
    }
    if (songs.length){
      srList.appendChild(el('div', 'sr-h', 'Songs'));
      songs.slice(0, 100).forEach(function(t){
        var al = S.album(t.albumId);
        srList.appendChild(srRow(al, t.title, (t.artist || (al && al.artist) || '') + (al ? ' · ' + al.title : ''), AV.player.cur() === t, function(){
          if (AV.player.cur() === t){ srIn.blur(); AV.player.toggle(); return; }
          srIn.blur(); AV.player.playList(S.tracksOf(t.albumId), t, al ? al.title : '');
          Array.prototype.forEach.call(srList.querySelectorAll('.sr-row.on'), function(r){ r.classList.remove('on'); }); this.classList.add('on');
        }, n++));
      });
      if (songs.length > 100) srList.appendChild(el('div', 'sr-h', 'Showing 100 of ' + songs.length + ' — type more to narrow down'));
    }
  }

  function openSearch(){
    if (searchOpen) return; searchOpen = true; srIn.value = ''; paintSearch();
    slideIn(srEl); app.classList.add('deep'); setTimeout(function(){ try { srIn.focus(); } catch (e) {} }, 60);
  }
  function closeSearch(keepDeep){
    if (!searchOpen) return; searchOpen = false; srIn.blur(); slideOut(srEl);
    if (!keepDeep) deep();
  }
  function kbPad(){
    var vv = window.visualViewport; if (!vv) return;
    var kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    srEl.style.setProperty('--kb', Math.round(kb) + 'px');
  }

  /* ---------- backup and restore ---------- */
  function mb(n){ return n >= 1048576 ? (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function saveFile(blob, name){
    var f = null; try { f = new File([blob], name, { type: 'application/octet-stream' }); } catch (e) {}
    return { share: function(){
      if (f && navigator.canShare && navigator.canShare({ files: [f] })) return navigator.share({ files: [f], title: name }).catch(function(e){ if (e && e.name !== 'AbortError') throw e; });
      return Promise.reject(new Error('share-unavailable'));
    }, download: function(){
      var a = document.createElement('a'), u = URL.createObjectURL(blob);
      a.href = u; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function(){ a.remove(); URL.revokeObjectURL(u); }, 60000);
    } };
  }
  function backupFlow(){
    startSheet('Back up library', 'Preparing your albums, covers and songs…'); var note = sheet.lastChild;
    var wait = el('div', 'sheet-btns'); var c0 = el('button', 'pill-btn', 'Cancel'); c0.type = 'button'; c0.addEventListener('click', function(){ cancelled = true; closeSheetUI(); });
    wait.appendChild(c0); sheet.appendChild(wait); openSheetUI();
    var cancelled = false;
    AV.backup.build().then(function(r){
      if (cancelled) return;
      var name = AV.backup.fileName(), sv = saveFile(r.blob, name);
      startSheet('Backup ready', plural(r.albums, 'album') + ' · ' + plural(r.tracks, 'song') + ' · ' + mb(r.bytes) + '. Save it to Files or send it to yourself, then keep it safe.');
      var share = el('button', 'pill-btn primary', 'Save or share…'); share.type = 'button';
      share.addEventListener('click', function(){ sv.share().catch(function(){ sv.download(); }); });
      var dl = el('button', 'pill-btn', 'Download file'); dl.type = 'button'; dl.addEventListener('click', function(){ sv.download(); });
      sheet.appendChild(share); sheet.appendChild(dl); cancelBtn();
    }).catch(function(e){
      startSheet('Backup failed', (e && e.message) || 'Something went wrong while preparing the backup.'); cancelBtn();
    });
  }
  function onBackupFile(e){
    var file = e.target.files[0]; e.target.value = ''; if (!file) return;
    ui.toast('Checking backup…', 60000);
    AV.backup.inspect(file).then(function(info){
      var h = info.head, when = h.created ? new Date(h.created).toLocaleDateString() : '';
      toastEl.classList.remove('show');
      startSheet('Restore this backup?', plural(h.counts.albums, 'album') + ' · ' + plural(h.counts.tracks, 'song') + ' · ' + mb(file.size) + (when ? ' · made ' + when : '') + '.');
      var add = el('button', 'pill-btn primary', 'Add to my library'); add.type = 'button';
      add.addEventListener('click', function(){ closeSheetUI(function(){ runRestore(file, 'merge'); }); });
      var rep = el('button', 'pill-btn bad', 'Replace my library'); rep.type = 'button';
      rep.addEventListener('click', function(){ closeSheetUI(function(){ runRestore(file, 'replace'); }); });
      sheet.appendChild(add); sheet.appendChild(rep); cancelBtn(); openSheetUI();
    }).catch(function(err){ ui.toast((err && err.message) || 'That file could not be read', 4200); });
  }
  function runRestore(file, mode){
    if (mode === 'replace'){ AV.player.pause(); S.tracks.slice().forEach(function(t){ AV.player.dropTrack(t); }); }
    ui.toast('Restoring…', 120000);
    AV.backup.restore(file, mode, function(i, n){ ui.toast('Restoring ' + i + ' of ' + n + '…', 120000); }).then(function(rep){
      return S.reload().then(function(){ AV.keepData(); return rep; });
    }).then(function(rep){
      if (rep.ok) ui.toast('Restored ' + plural(rep.albums, 'album') + ' and ' + plural(rep.tracks, 'song') + ' · checked', 4200);
      else { startSheet('Restored with problems', rep.problems.slice(0, 6).join('\n') + (rep.problems.length > 6 ? '\n…and ' + (rep.problems.length - 6) + ' more' : '')); cancelBtn(); openSheetUI(); }
    }).catch(function(err){ S.reload().catch(function(){}); ui.toast((err && err.message) || 'Restore failed', 4600); });
  }

  /* ---------- wiring ---------- */
  ui.init = function(){
    app = $('app'); albumEl = $('album'); npEl = $('np'); sheet = $('sheet'); veil = $('veil'); toastEl = $('toast');
    var P = AV.player;
    srEl = $('search'); srIn = $('sr-input'); srList = $('sr-list'); srClear = $('sr-clear');
    $('btn-search').addEventListener('click', openSearch);
    $('sr-cancel').addEventListener('click', function(){ closeSearch(); });
    srClear.addEventListener('click', function(){ srIn.value = ''; paintSearch(); srIn.focus(); });
    srIn.addEventListener('input', function(){ clearTimeout(srTimer); srTimer = setTimeout(paintSearch, 90); });
    srIn.addEventListener('keydown', function(e){ if (e.key === 'Enter') srIn.blur(); if (e.key === 'Escape') closeSearch(); });
    srList.addEventListener('touchmove', function(){ if (document.activeElement === srIn) srIn.blur(); }, { passive: true });
    if (window.visualViewport){ visualViewport.addEventListener('resize', kbPad); visualViewport.addEventListener('scroll', kbPad); }
    var mixBtn = $('btn-mix');
    function paintMix(){ mixBtn.setAttribute('aria-checked', P.mix ? 'true' : 'false'); }
    /* press and hold: the hidden Mix Studio */
    var holdT = 0, held = false;
    mixBtn.addEventListener('pointerdown', function(){ held = false; clearTimeout(holdT); holdT = setTimeout(function(){ held = true; if (navigator.vibrate) try { navigator.vibrate(20); } catch (e) {} AV.studio.open(); }, 600); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function(ev){ mixBtn.addEventListener(ev, function(){ clearTimeout(holdT); }); });
    mixBtn.addEventListener('contextmenu', function(e){ e.preventDefault(); });
    mixBtn.addEventListener('click', function(){
      if (held){ held = false; return; }
      if (!P.mix && AV.store.albums.reduce(function(n, a){ return n + S.tracksOf(a.id).length; }, 0) < 2){ ui.toast('Add some songs first'); return; }
      P.setMix(!P.mix); paintMix();
      ui.toast(P.mix ? 'Mix on · every album, best match next' : 'Mix off', 2400);
      if (navigator.vibrate) try { navigator.vibrate(12); } catch (e) {}
    });
    paintMix(); P.on(function(w){ if (w === 'mix') paintMix(); });
    /* mix strip: shows the two songs, tempo and where the blend is */
    var chip = $('np-mixchip'), mcA = $('mc-a'), mcB = $('mc-b'), mcH = $('mc-head'), mcL1 = $('mc-l1'), mcL2 = $('mc-l2'), lastTxt = '';
    setInterval(function(){
      if (!npEl || npEl.hidden){ return; }
      var v = P.mixView(); if (!v.on || !v.cur){ chip.hidden = true; return; }
      chip.hidden = false;
      var pl = v.pl, txt;
      if (v.prog >= 0){
        mcA.style.transform = 'scaleX(1)'; mcB.style.transform = 'scaleX(1)';
        mcA.style.opacity = (1 - v.prog * .8).toFixed(2); mcB.style.opacity = (.2 + v.prog * .8).toFixed(2);
        mcH.style.left = (v.prog * 94).toFixed(1) + 'px';
        txt = 'MIXING' + (pl && pl.type === 'dj' ? ' · ' + pl.beats + ' beats' : ''); 
        mcL2.textContent = Math.round(pl.bpmA) + ' → ' + Math.round(pl.bpmUsed) + ' BPM · ' + (v.next ? v.next.title : '');
      } else {
        var k = v.D ? v.t / v.D : 0; mcA.style.transform = 'scaleX(1)'; mcA.style.opacity = '1'; mcB.style.opacity = '.35';
        mcH.style.left = (k * 94).toFixed(1) + 'px';
        txt = 'MIX · NEXT';
        mcL2.textContent = v.next ? (pl && pl.type === 'dj' ? Math.round(pl.bpmA) + ' → ' + Math.round(pl.bpmUsed) + ' BPM · ' : '') + v.next.title : 'Picking the best match…';
      }
      if (txt !== lastTxt){ lastTxt = txt; mcL1.textContent = txt; }
    }, 120);
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
    $('file-any').addEventListener('change', onSongs); $('file-dir').addEventListener('change', onFolder); $('file-zip').addEventListener('change', onZip); $('file-bak').addEventListener('change', onBackupFile);
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
