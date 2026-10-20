(function () {
  'use strict';

  var API = location.origin;
  var SILENCE_MS = 1500;
  var POLL_MS = 1000;
  var IDLE_TURN = 'Press Popcorn or open the rating on the TV to talk';
  var ASK_TURN = 'What do you feel like watching tonight?';

  var $ = function (id) { return document.getElementById(id); };

  // Views
  var favMode = $('fav-mode'), voiceMode = $('voice-mode');

  // Favorites elements
  var favNameEl = $('fav-name'), favCountEl = $('fav-count'), favDoneBtn = $('fav-done');
  var favSearchInput = $('fav-search');
  var favPicksSection = $('fav-picks-section'), favPicksGrid = $('fav-picks-grid');
  var favResultsSection = $('fav-results-section'), favResultsTitle = $('fav-results-title'), favResultsGrid = $('fav-results-grid');
  var favCatalogSections = $('fav-catalog-sections'), favPopularGrid = $('fav-popular-grid'), favBestGrid = $('fav-best-grid');
  var favGenreSections = $('fav-genre-sections');

  // Voice elements
  var talk = $('talk'), statusEl = $('status'), heardEl = $('heard'), turnEl = $('turn');
  var fallback = $('fallback');

  // Favorites state
  var favCatalog = null;
  var lastFavName = null;
  var isTyping = false;
  var searchTimer = null;
  var fetchingCatalog = false;

  // Voice state
  var rating = null;
  var askOpen = false;
  var lastTurn = null;
  var listening = false, busy = false;
  var statusTimer = null;

  function postJSON(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
          return j;
        });
      });
  }

  // ---------- Favorites mode ----------

  function createCard(c, isPicked) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fav-card' + (isPicked ? ' is-picked' : '');
    btn.setAttribute('aria-label', (isPicked ? 'Unpick ' : 'Pick ') + c.title);

    var posterWrap = document.createElement('div');
    posterWrap.className = 'poster-wrap';
    if (c.poster) {
      var img = document.createElement('img');
      img.src = c.poster;
      img.alt = c.title;
      img.loading = 'lazy';
      posterWrap.appendChild(img);
    } else {
      var noP = document.createElement('div');
      noP.className = 'no-poster';
      noP.textContent = c.title;
      posterWrap.appendChild(noP);
    }
    if (isPicked) {
      var badge = document.createElement('div');
      badge.className = 'check-badge';
      badge.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
      posterWrap.appendChild(badge);
    }
    btn.appendChild(posterWrap);

    var meta = document.createElement('div');
    meta.className = 'card-meta';
    var title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = c.title;
    meta.appendChild(title);
    if (c.year) {
      var sub = document.createElement('div');
      sub.className = 'card-sub';
      sub.textContent = c.year;
      meta.appendChild(sub);
    }
    btn.appendChild(meta);

    btn.addEventListener('click', function () {
      postJSON(API + '/api/favorites', { toggle: c.id }).then(poll);
    });
    return btn;
  }

  function renderGrid(container, cards, isPicked) {
    container.innerHTML = '';
    for (var i = 0; i < cards.length; i++) {
      container.appendChild(createCard(cards[i], !!isPicked));
    }
  }

  function renderFavorites(fav) {
    if (!fav) return;
    favNameEl.textContent = fav.name || '';
    var picked = fav.picked || [];
    var n = picked.length;
    var countText;
    if (n < 5) countText = n + ' picked, pick at least 5';
    else if (n < 25) countText = n + ' picked';
    else countText = "25 picked, that's the most";

    favCountEl.textContent = countText;
    favDoneBtn.disabled = n < 5;

    if (!isTyping) {
      var curVal = favSearchInput.value;
      var q = fav.query || '';
      if (curVal !== q) favSearchInput.value = q;
    }

    // Build lookup of picked IDs
    var pickedIds = {};
    for (var i = 0; i < picked.length; i++) {
      pickedIds[picked[i].id] = true;
    }

    // Your picks
    if (n > 0) {
      favPicksSection.hidden = false;
      renderGrid(favPicksGrid, picked, true);
    } else {
      favPicksSection.hidden = true;
      favPicksGrid.innerHTML = '';
    }

    if (fav.query) {
      // Results mode
      favCatalogSections.hidden = true;
      favResultsSection.hidden = false;
      favResultsTitle.textContent = 'Results for "' + fav.query + '"';
      var res = (fav.results || []).filter(function (c) { return !pickedIds[c.id]; });
      renderGrid(favResultsGrid, res, false);
    } else {
      // Catalog mode
      favResultsSection.hidden = true;
      favCatalogSections.hidden = false;
      if (favCatalog) {
        favGenreSections.innerHTML = '';
        (favCatalog.for_you || []).forEach(function (g) {
          var films = (g.films || []).filter(function (c) { return !pickedIds[c.id]; });
          if (!films.length) return;
          var section = document.createElement('section');
          section.className = 'fav-section';
          var title = document.createElement('h3');
          title.className = 'fav-section-title';
          title.textContent = g.genre;
          var grid = document.createElement('div');
          grid.className = 'fav-grid';
          renderGrid(grid, films, false);
          section.appendChild(title);
          section.appendChild(grid);
          favGenreSections.appendChild(section);
        });
        var pop = (favCatalog.popular || []).filter(function (c) { return !pickedIds[c.id]; });
        var best = (favCatalog.best || []).filter(function (c) { return !pickedIds[c.id]; });
        renderGrid(favPopularGrid, pop, false);
        renderGrid(favBestGrid, best, false);
      }
    }
  }

  function fetchCatalog(name) {
    if (fetchingCatalog) return;
    fetchingCatalog = true;
    fetch(API + '/api/favorites/catalog')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        favCatalog = data;
        lastFavName = name;
        fetchingCatalog = false;
      })
      .catch(function () {
        fetchingCatalog = false;
      });
  }

  favSearchInput.addEventListener('input', function () {
    isTyping = true;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      isTyping = false;
      postJSON(API + '/api/favorites', { query: favSearchInput.value }).then(poll);
    }, 400);
  });

  favDoneBtn.addEventListener('click', function () {
    favDoneBtn.disabled = true;
    postJSON(API + '/api/favorites', { done: true }).then(poll);
  });

  // ---------- Voice mode ----------

  function setStatus(text, isError) {
    clearTimeout(statusTimer);
    statusEl.textContent = text;
    statusEl.classList.toggle('error', !!isError);
  }

  function setButton() {
    talk.disabled = !(askOpen || ratingOpen()) || busy;
    talk.dataset.state = listening ? 'listening' : busy ? 'busy' : 'idle';
    talk.setAttribute('aria-label', listening ? 'Stop talking' : askOpen ? 'Say what you feel like' : 'Say what you thought');
  }

  function setHeard(text) { heardEl.textContent = text ? '“' + text + '”' : ''; }

  function ratingOpen() { return !!(rating && !rating.done); }
  function asking() { return ratingOpen() && rating.asking ? rating.asking : null; }
  function canTalk() { return askOpen || !!asking(); }

  function sendVoice(body) {
    return postJSON(API + '/api/voice', body).catch(function () {});
  }
  function voiceBody(state, text) {
    var body = { state: state, text: text || '' };
    if (asking()) body.speaker = asking();
    return body;
  }

  function renderTurn() {
    var who = asking();
    if (askOpen) turnEl.textContent = ASK_TURN;
    else if (!rating) turnEl.textContent = IDLE_TURN;
    else if (who) turnEl.textContent = who + ', what did you think of ' + ((rating.movie && rating.movie.title) || 'the film') + '?';
    else if (rating.done) turnEl.textContent = 'Saved. Thanks!';
    else turnEl.textContent = 'Everyone answered. Finish on the TV.';
    var key = [askOpen, ratingOpen(), who, !!(rating && rating.done)].join('|');
    if (key !== lastTurn) {
      lastTurn = key;
      setStatus(canTalk() ? 'Tap and talk' : '');
      setHeard('');
    }
    setButton();
  }

  function submit(text) {
    text = (text || '').trim();
    if (!text) { sendVoice(voiceBody('idle')); setStatus("I didn't catch that. Tap and try again", true); return Promise.resolve(); }
    busy = true; setButton(); setHeard(text); setStatus(askOpen ? 'Finding films...' : 'Sending...');
    var send = askOpen ? postJSON(API + '/api/ask', { text: text }) : postJSON(API + '/api/rating/voice', { text: text });
    return send.then(function (j) {
      if (j && j.ok === false) setStatus(j.reply, true);
      else if (j && j.ok) setStatus('Your picks are on the TV');
      else setStatus(j && j.done ? 'Saved. Thanks!' : 'Saved');
      return poll();
    }).catch(function (e) {
      setStatus((e && e.message) || 'Popcorn is not reachable right now', true);
    }).then(function () { busy = false; setButton(); sendVoice(voiceBody('idle')); });
  }

  // Audio recording
  var MAX_MS = 30000, LEVEL = 0.015;
  var canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  var recorder = null, stream = null, chunks = [], audioCtx = null, levelTimer = null, maxTimer = null;
  var heardSpeech = false, lastVoiceAt = 0, startedAt = 0;

  function pickMime() {
    var list = ['audio/webm;codecs=opus', 'audio/mp4'];
    for (var i = 0; i < list.length; i++) {
      try { if (MediaRecorder.isTypeSupported(list[i])) return list[i]; } catch (e) {}
    }
    return '';
  }

  function cleanup() {
    clearInterval(levelTimer); clearTimeout(maxTimer); levelTimer = maxTimer = null;
    if (audioCtx) { try { audioCtx.close(); } catch (e) {} audioCtx = null; }
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
  }

  function watchLevel(s) {
    var Ac = window.AudioContext || window.webkitAudioContext;
    if (!Ac) return;
    try {
      audioCtx = new Ac();
      var analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      audioCtx.createMediaStreamSource(s).connect(analyser);
      var buf = new Float32Array(analyser.fftSize);
      levelTimer = setInterval(function () {
        analyser.getFloatTimeDomainData(buf);
        var sum = 0;
        for (var i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        var now = Date.now();
        if (Math.sqrt(sum / buf.length) > LEVEL) { heardSpeech = true; lastVoiceAt = now; }
        if ((heardSpeech && now - lastVoiceAt > SILENCE_MS) || (!heardSpeech && now - startedAt > 5000)) stop();
      }, 100);
    } catch (e) { audioCtx = null; }
  }

  function start() {
    if (listening || busy) return;
    if (!canTalk()) { setStatus(IDLE_TURN, true); return; }
    setStatus('Starting the microphone...');
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
      stream = s; chunks = []; heardSpeech = false;
      var mime = pickMime();
      try { recorder = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s); }
      catch (e) { cleanup(); setStatus('Voice did not work. Try again', true); return; }
      recorder.ondataavailable = function (ev) { if (ev.data && ev.data.size) chunks.push(ev.data); };
      recorder.onstop = function () {
        var type = recorder.mimeType || mime || 'audio/webm';
        var blob = new Blob(chunks, { type: type });
        recorder = null; cleanup();
        listening = false; setButton();
        transcribe(blob, type);
      };
      startedAt = lastVoiceAt = Date.now();
      recorder.start();
      listening = true; setButton(); setStatus('Listening...'); setHeard('');
      sendVoice(voiceBody('listening'));
      watchLevel(s);
      maxTimer = setTimeout(stop, MAX_MS);
    }).catch(function (e) {
      cleanup();
      var denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      setStatus(denied ? 'Microphone is blocked. Allow it in your browser settings' : 'No microphone found', true);
    });
  }

  function stop() {
    if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch (e) {} }
  }

  function transcribe(blob, type) {
    if (!blob.size) { sendVoice(voiceBody('idle')); setStatus("I didn't catch that. Tap and try again", true); return; }
    busy = true; setButton(); setStatus('Thinking...');
    sendVoice(voiceBody('thinking'));
    fetch(API + '/api/transcribe', { method: 'POST', headers: { 'Content-Type': type }, body: blob })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status);
          return j.text || '';
        });
      })
      .then(function (text) { busy = false; setButton(); return submit(text); })
      .catch(function (e) {
        busy = false; setButton();
        sendVoice(voiceBody('idle'));
        setStatus((e && e.message && e.message.indexOf('HTTP') !== 0) ? e.message : "I couldn't hear you just now. Try again", true);
      });
  }

  talk.addEventListener('click', function () { listening ? stop() : start(); });

  if (!canRecord) {
    talk.hidden = true;
    fallback.hidden = false;
    $('form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!canTalk()) { setStatus(IDLE_TURN, true); return; }
      var input = $('text'), v = input.value.trim();
      if (!v) return;
      input.value = '';
      submit(v);
    });
  }

  // ---------- Polling & State Dispatch ----------

  function poll() {
    return fetch(API + '/api/state').then(function (r) { return r.json(); }).then(function (s) {
      if (!s) return;
      if (s.screen === 'favorites' && s.favorites) {
        favMode.hidden = false;
        voiceMode.hidden = true;
        if (!favCatalog || lastFavName !== s.favorites.name) {
          fetchCatalog(s.favorites.name);
        }
        renderFavorites(s.favorites);
      } else {
        favMode.hidden = true;
        voiceMode.hidden = false;
        favCatalog = null;
        lastFavName = null;
        askOpen = !!(s.screen === 'ask');
        rating = !askOpen && s.rating ? s.rating : null;
        renderTurn();
      }
    }).catch(function () {
      if (favMode.hidden) {
        rating = null; askOpen = false;
        lastTurn = null;
        turnEl.textContent = 'Popcorn is not reachable right now';
        setButton();
      }
    });
  }

  setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });

  setButton();
  poll();
})();
