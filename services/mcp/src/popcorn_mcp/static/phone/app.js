(function () {
  'use strict';

  var API = location.origin;
  var AGENT = (new URLSearchParams(location.search).get('agent') || '').replace(/\/+$/, '');
  var SILENCE_MS = 1500;
    var SPEAKER_KEY = 'popcorn.phone.speaker';

  var $ = function (id) { return document.getElementById(id); };
  var talk = $('talk'), statusEl = $('status'), heardEl = $('heard');
  var who = $('who'), chips = $('chips'), fallback = $('fallback');

  var speaker = null;
  var listening = false, busy = false;
  var statusTimer = null;

  function store(op, key, val) {
    try { return op === 'get' ? localStorage.getItem(key) : op === 'set' ? localStorage.setItem(key, val) : localStorage.removeItem(key); }
    catch (e) { return null; }
  }

  function setStatus(text, isError) {
    clearTimeout(statusTimer);
    statusEl.textContent = text;
    statusEl.classList.toggle('error', !!isError);
  }
  function idleLater(ms) {
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { if (!listening && !busy) setStatus('Tap and talk'); }, ms);
  }
  function setButton() {
    talk.dataset.state = listening ? 'listening' : busy ? 'busy' : 'idle';
    talk.setAttribute('aria-label', listening ? 'Stop listening' : 'Talk to Popcorn');
  }
  function setHeard(text) { heardEl.textContent = text ? '“' + text + '”' : ''; }

  function postJSON(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r; });
  }

  // ---------- voice state on the TV ----------
  function sendVoice(body) {
    return postJSON(API + '/api/voice', body).catch(function () {});
  }

  // ---------- sending ----------
  function submit(text) {
    text = (text || '').trim();
    if (!text) { sendVoice({ state: 'idle' }); setStatus("I didn't catch that. Tap and try again"); return Promise.resolve(); }
    busy = true; setButton(); setHeard(text); setStatus('Sent');
    var think = { state: 'thinking', text: text };
    if (speaker) think.speaker = speaker;
    return sendVoice(think).then(function () {
      if (!AGENT) throw new Error('no-agent');
      var body = { text: text };
      if (speaker) body.speaker = speaker;
      return postJSON(AGENT + '/chat', body);
    }).then(function () {
      setStatus('Popcorn is answering on the TV');
      idleLater(5000);
    }).catch(function (e) {
      sendVoice({ state: 'idle' });
      setStatus(e && e.message === 'no-agent' ? 'This page is missing its Popcorn link. Scan the code on the TV again' : "Popcorn can't be reached right now. Try again", true);
    }).then(function () { busy = false; setButton(); });
  }

  // ---------- recording (MediaRecorder -> /api/transcribe) ----------
  var MAX_MS = 30000, LEVEL = 0.015; // RMS above this counts as speech
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
        // stop 1.5 s after the last speech; if nothing is said at all, give up after 5 s
        if ((heardSpeech && now - lastVoiceAt > SILENCE_MS) || (!heardSpeech && now - startedAt > 5000)) stop();
      }, 100);
    } catch (e) { audioCtx = null; }
  }

  function start() {
    if (listening || busy) return;
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
      var body = { state: 'listening', text: '' };
      if (speaker) body.speaker = speaker;
      sendVoice(body);
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
    if (!blob.size) { sendVoice({ state: 'idle' }); setStatus("I didn't catch that. Tap and try again"); return; }
    busy = true; setButton(); setStatus('Thinking...');
    var think = { state: 'thinking', text: '' };
    if (speaker) think.speaker = speaker;
    sendVoice(think);
    var url = API + '/api/transcribe' + (speaker ? '?speaker=' + encodeURIComponent(speaker) : '');
    fetch(url, { method: 'POST', headers: { 'Content-Type': type }, body: blob }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status);
        return j.text || '';
      });
    }).then(function (text) {
      busy = false; setButton();
      return submit(text);
    }).catch(function (e) {
      busy = false; setButton();
      sendVoice({ state: 'idle' });
      setStatus((e && e.message && e.message.indexOf('HTTP') !== 0) ? e.message : "I couldn't hear you just now. Try again", true);
    });
  }

  talk.addEventListener('click', function () { listening ? stop() : start(); });

  // ---------- fallback ----------
  if (!canRecord) {
    talk.hidden = true;
    fallback.hidden = false;
    setStatus('Voice is not supported here');
    $('form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;
      var input = $('text'), v = input.value.trim();
      if (!v) return;
      input.value = '';
      submit(v);
    });
  }

  // ---------- who's talking ----------
  function renderChips(names) {
    chips.textContent = '';
    if (!names.length) { who.hidden = true; return; }
    if (speaker && names.indexOf(speaker) < 0) speaker = null;
    who.hidden = false;
    names.forEach(function (n) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.textContent = n;
      b.setAttribute('aria-pressed', n === speaker ? 'true' : 'false');
      b.addEventListener('click', function () {
        speaker = speaker === n ? null : n;
        if (speaker) store('set', SPEAKER_KEY, speaker); else store('remove', SPEAKER_KEY);
        Array.prototype.forEach.call(chips.children, function (c) { c.setAttribute('aria-pressed', c.textContent === speaker ? 'true' : 'false'); });
      });
      chips.appendChild(b);
    });
  }

  speaker = store('get', SPEAKER_KEY) || null;
  fetch(API + '/api/state').then(function (r) { return r.json(); }).then(function (s) {
    renderChips((s.household || []).map(function (m) { return m.name; }).filter(Boolean));
  }).catch(function () { who.hidden = true; });
})();
