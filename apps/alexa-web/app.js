/**
 * Popcorn AI — Simulated Alexa+ Voice Page Application
 * Plain ES module: Web Speech API, fetch ReadableStream SSE parser,
 * Polly /speak audio playback, live MCP tool steps, and TV state preview.
 */

import {
  AGENT_URL,
  TV_STATE_URL,
  MOCK_MODE,
  INITIAL_ORB_STATE,
  TV_POLL_INTERVAL_MS,
  STORAGE_KEY_SPEAKER,
  TOOL_LABELS,
  formatToolInput,
  stripWakeWord,
  avatarColorForName,
  initialsForName,
} from "./config.js";

/* ==========================================================================
   DOM References
   ========================================================================== */

const modeBadge = document.getElementById("mode-badge");
const speakerInput = document.getElementById("speaker-input");
const speakerAvatar = document.getElementById("speaker-avatar");
const newNightBtn = document.getElementById("new-night-btn");

const orbStage = document.getElementById("orb-stage");
const voiceOrb = document.getElementById("voice-orb");
const orbStatePill = document.getElementById("orb-state-pill");
const conversationIdPill = document.getElementById("conversation-id-pill");
const orbHint = document.getElementById("orb-hint");

const liveTranscriptBar = document.getElementById("live-transcript-bar");
const transcriptLabel = document.getElementById("transcript-label");
const liveTranscriptText = document.getElementById("live-transcript-text");

const errorBanner = document.getElementById("error-banner");
const errorBannerText = document.getElementById("error-banner-text");
const errorDismissBtn = document.getElementById("error-dismiss-btn");

const quickPrompts = document.getElementById("quick-prompts");
const chatLog = document.getElementById("chat-log");
const chatEmpty = document.getElementById("chat-empty");
const speechNote = document.getElementById("speech-note");
const composerForm = document.getElementById("composer-form");
const composerInput = document.getElementById("composer-input");

const agentPanelDot = document.getElementById("agent-panel-dot");
const agentStepSummary = document.getElementById("agent-step-summary");
const toolStepsList = document.getElementById("tool-steps-list");

const tvKidBadge = document.getElementById("tv-kid-badge");
const tvScreenPill = document.getElementById("tv-screen-pill");
const tvCouchBar = document.getElementById("tv-couch-bar");
const tvScreenViewport = document.getElementById("tv-screen-viewport");

/* ==========================================================================
   Runtime State
   ========================================================================== */

let conversationId = null;
let orbState = "idle"; // "idle" | "listening" | "thinking" | "speaking" | "error"
let activeStreamAbort = null;
let activeAudio = null;
let activeAudioUrl = null;
let speechSynthTimer = null;

let recognition = null;
let isListening = false;
let pushToTalkActive = false;
let interimTranscript = "";
let finalTranscriptBuffer = "";

let audioContext = null;
let micStream = null;
let micRafId = null;

let lastTvStateKey = "";
let mockTurnCounter = 0;

/* ==========================================================================
   Speaker Persistence & Avatar Badge
   ========================================================================== */

function initSpeaker() {
  const saved = localStorage.getItem(STORAGE_KEY_SPEAKER);
  if (saved !== null) {
    speakerInput.value = saved;
  }
  updateSpeakerBadge();
  speakerInput.addEventListener("input", () => {
    const val = speakerInput.value.trim();
    localStorage.setItem(STORAGE_KEY_SPEAKER, val);
    updateSpeakerBadge();
  });
}

function updateSpeakerBadge() {
  const name = speakerInput.value.trim() || "Guest";
  speakerAvatar.textContent = initialsForName(name);
  speakerAvatar.style.backgroundColor = avatarColorForName(name);
}

function getCurrentSpeaker() {
  return speakerInput.value.trim() || null;
}

/* ==========================================================================
   Voice Orb State Management
   ========================================================================== */

const ORB_STATE_META = {
  idle: {
    pill: "Ready to listen",
    hint: 'Tap the orb or hold <kbd>Space</kbd> to speak · Say <em>"Hey Popcorn, it\'s me and Ayse tonight"</em>',
  },
  listening: {
    pill: "Listening",
    hint: "Listening... speak naturally, then tap the orb or release <kbd>Space</kbd> to send",
  },
  thinking: {
    pill: "Agent working",
    hint: "Checking taste profiles and updating the living room TV...",
  },
  speaking: {
    pill: "Speaking",
    hint: "Speaking reply — tap the orb or press <kbd>Space</kbd> to stop audio",
  },
  error: {
    pill: "Attention needed",
    hint: "Something went wrong. Tap the orb or type below to try again.",
  },
};

export function setOrbState(nextState, customHint = null) {
  orbState = nextState;
  voiceOrb.dataset.state = nextState;
  orbStage.dataset.state = nextState;
  orbStatePill.dataset.state = nextState;

  const meta = ORB_STATE_META[nextState] || ORB_STATE_META.idle;
  orbStatePill.textContent = meta.pill;
  orbHint.innerHTML = customHint || meta.hint;
  voiceOrb.setAttribute("aria-pressed", nextState === "listening" ? "true" : "false");

  if (nextState !== "listening") {
    orbStage.style.setProperty("--mic-scale-outer", "1");
    orbStage.style.setProperty("--mic-scale-mid", "1");
  }
}

function showError(message) {
  errorBannerText.textContent = message;
  errorBanner.hidden = false;
  setOrbState("error");
}

function clearError() {
  errorBanner.hidden = true;
  errorBannerText.textContent = "";
  if (orbState === "error") {
    setOrbState("idle");
  }
}

errorDismissBtn.addEventListener("click", clearError);

/* ==========================================================================
   Audio Output (/speak in Live Mode, speechSynthesis in Mock Mode)
   ========================================================================== */

export function stopSpeaking() {
  if (activeAudio) {
    try {
      activeAudio.pause();
      activeAudio.currentTime = 0;
    } catch {
      /* ignore audio cleanup errors */
    }
    activeAudio = null;
  }
  if (activeAudioUrl) {
    URL.revokeObjectURL(activeAudioUrl);
    activeAudioUrl = null;
  }
  if (speechSynthTimer) {
    clearTimeout(speechSynthTimer);
    speechSynthTimer = null;
  }
  if ("speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  }
  if (orbState === "speaking") {
    setOrbState("idle");
  }
}

async function speakReply(text) {
  const clean = (text || "").trim().slice(0, 1500);
  if (!clean) {
    setOrbState("idle");
    return;
  }

  stopSpeaking();
  setOrbState("speaking");

  if (MOCK_MODE) {
    speakWithBrowserSynthesis(clean);
    return;
  }

  try {
    const response = await fetch(`${AGENT_URL}/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean }),
    });

    if (!response.ok) {
      let errMsg = `Speech synthesis failed (${response.status})`;
      try {
        const errJson = await response.json();
        if (errJson && errJson.error) errMsg = errJson.error;
      } catch {
        /* ignore */
      }
      showError(errMsg);
      return;
    }

    const blob = await response.blob();
    if (orbState !== "speaking") return; // Stopped while fetching

    activeAudioUrl = URL.createObjectURL(blob);
    const audio = new Audio(activeAudioUrl);
    activeAudio = audio;

    audio.addEventListener("ended", () => {
      stopSpeaking();
    });
    audio.addEventListener("error", () => {
      stopSpeaking();
    });

    await audio.play();
  } catch {
    // If autoplay is blocked or network fails, fall back cleanly to idle
    stopSpeaking();
  }
}

function speakWithBrowserSynthesis(text) {
  const words = text.split(/\s+/).length;
  const fallbackDurationMs = Math.min(8000, Math.max(2400, words * 280));
  const startedAt = performance.now();

  if ("speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.rate = 1.02;
      utterance.onend = () => {
        if (performance.now() - startedAt < 500) return;
        if (speechSynthTimer) clearTimeout(speechSynthTimer);
        if (orbState === "speaking") setOrbState("idle");
      };
      utterance.onerror = () => {
        if (performance.now() - startedAt < 500) return;
        if (speechSynthTimer) clearTimeout(speechSynthTimer);
        if (orbState === "speaking") setOrbState("idle");
      };
      window.speechSynthesis.speak(utterance);
    } catch {
      /* fallback timer handles completion */
    }
  }

  speechSynthTimer = setTimeout(() => {
    if (orbState === "speaking") {
      stopSpeaking();
    }
  }, fallbackDurationMs);
}

/* ==========================================================================
   Web Speech API + Optional Live Mic Volume Meter
   ========================================================================== */

function setupSpeechRecognition() {
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionCtor) {
    speechNote.hidden = false;
    speechNote.textContent =
      "Web Speech API is not supported in this browser. Type your voice commands below.";
    return;
  }

  recognition = new SpeechRecognitionCtor();
  recognition.lang = "en-US";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isListening = true;
    interimTranscript = "";
    finalTranscriptBuffer = "";
    clearError();
    setOrbState("listening");
    liveTranscriptBar.dataset.active = "true";
    transcriptLabel.textContent = "Listening";
    liveTranscriptText.textContent = "Speak now...";
    startMicVolumeMeter();
  };

  recognition.onresult = (event) => {
    let interim = "";
    let finalChunk = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalChunk += transcript;
      } else {
        interim += transcript;
      }
    }
    if (finalChunk) {
      finalTranscriptBuffer += ` ${finalChunk}`;
    }
    interimTranscript = interim;
    const combined = `${finalTranscriptBuffer} ${interimTranscript}`.trim();
    if (combined) {
      const stripped = stripWakeWord(combined);
      const hadWakeWord = stripped.length < combined.length;
      transcriptLabel.textContent = hadWakeWord ? "Wake word stripped" : "Live mic";
      liveTranscriptText.textContent = stripped || combined;
    }
  };

  recognition.onerror = (event) => {
    stopMicVolumeMeter();
    isListening = false;
    liveTranscriptBar.dataset.active = "false";

    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      speechNote.hidden = false;
      speechNote.textContent =
        "Microphone access was blocked or unavailable. You can type commands below or enable mic permissions.";
      setOrbState("idle");
      return;
    }
    if (event.error === "no-speech" || event.error === "aborted") {
      setOrbState("idle");
      return;
    }
    showError(`Microphone error: ${event.error}`);
  };

  recognition.onend = () => {
    stopMicVolumeMeter();
    isListening = false;
    liveTranscriptBar.dataset.active = "false";

    const rawCaptured = `${finalTranscriptBuffer} ${interimTranscript}`.trim();
    interimTranscript = "";
    finalTranscriptBuffer = "";

    if (rawCaptured) {
      handleUserUtterance(rawCaptured);
    } else if (orbState === "listening") {
      setOrbState("idle");
      transcriptLabel.textContent = "Live mic";
      liveTranscriptText.textContent = "No speech detected — tap orb or type below.";
    }
  };
}

async function startMicVolumeMeter() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!isListening) {
      stopMicVolumeMeter();
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioCtx();
    const source = audioContext.createMediaStreamSource(micStream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!isListening) return;
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        sum += data[i];
      }
      const avg = sum / data.length / 255;
      const scaleOuter = (1 + avg * 0.38).toFixed(3);
      const scaleMid = (1 + avg * 0.24).toFixed(3);
      orbStage.style.setProperty("--mic-scale-outer", scaleOuter);
      orbStage.style.setProperty("--mic-scale-mid", scaleMid);
      micRafId = requestAnimationFrame(tick);
    };
    micRafId = requestAnimationFrame(tick);
  } catch {
    /* CSS pulse animation handles visual feedback when getUserMedia isn't granted */
  }
}

function stopMicVolumeMeter() {
  if (micRafId) {
    cancelAnimationFrame(micRafId);
    micRafId = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
}

function startListening() {
  stopSpeaking();
  clearError();

  if (!recognition) {
    setOrbState("listening");
    liveTranscriptBar.dataset.active = "true";
    transcriptLabel.textContent = "Listening";
    liveTranscriptText.textContent = "Listening... type below or click a sample prompt.";
    return;
  }

  if (isListening) return;
  try {
    recognition.start();
  } catch {
    setOrbState("listening");
  }
}

function stopListening() {
  if (recognition && isListening) {
    try {
      recognition.stop();
    } catch {
      /* ignore */
    }
  } else if (orbState === "listening") {
    setOrbState("idle");
    liveTranscriptBar.dataset.active = "false";
  }
}

/* ==========================================================================
   Conversation Log & Tool Steps UI
   ========================================================================== */

function ensureChatNotEmpty() {
  if (chatEmpty && !chatEmpty.hidden) {
    chatEmpty.hidden = true;
  }
}

function appendUserBubble(text, speaker, rawWithWakeWord) {
  ensureChatNotEmpty();
  const row = document.createElement("div");
  row.className = "chat-bubble-row user";

  const avatar = document.createElement("span");
  avatar.className = "avatar-circle avatar-sm";
  const displayName = speaker || "You";
  avatar.textContent = initialsForName(displayName);
  avatar.style.backgroundColor = avatarColorForName(displayName);

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";

  const meta = document.createElement("div");
  meta.className = "chat-bubble-meta";
  const wakeStripped =
    rawWithWakeWord && rawWithWakeWord.trim().toLowerCase() !== text.trim().toLowerCase();
  meta.textContent = wakeStripped ? `${displayName} · wake word removed` : displayName;

  const content = document.createElement("div");
  content.textContent = text;

  bubble.appendChild(meta);
  bubble.appendChild(content);
  row.appendChild(avatar);
  row.appendChild(bubble);
  chatLog.appendChild(row);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function createAssistantBubble() {
  ensureChatNotEmpty();
  const row = document.createElement("div");
  row.className = "chat-bubble-row assistant";

  const avatar = document.createElement("span");
  avatar.className = "avatar-circle avatar-sm";
  avatar.textContent = "PA";
  avatar.style.backgroundColor = "#B87D28";

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";

  const meta = document.createElement("div");
  meta.className = "chat-bubble-meta";
  meta.textContent = "Popcorn AI";

  const content = document.createElement("div");
  content.className = "assistant-reply-text";
  content.textContent = "...";

  bubble.appendChild(meta);
  bubble.appendChild(content);
  row.appendChild(avatar);
  row.appendChild(bubble);
  chatLog.appendChild(row);
  chatLog.scrollTop = chatLog.scrollHeight;
  return content;
}

function resetToolStepsForTurn() {
  toolStepsList.innerHTML = "";
  agentPanelDot.dataset.active = "true";
  agentStepSummary.textContent = "Running tools...";
}

function addToolStepStart(tool, input) {
  const emptyEl = document.getElementById("tool-steps-empty");
  if (emptyEl) emptyEl.remove();

  const li = document.createElement("li");
  li.className = "tool-step-item";
  li.dataset.tool = tool;
  li.dataset.status = "running";

  const friendly = TOOL_LABELS[tool] || tool;
  const sub = formatToolInput(tool, input);

  li.innerHTML = `
    <div class="tool-step-left">
      <span class="step-icon" data-role="icon">
        <span class="step-spinner" aria-hidden="true"></span>
      </span>
      <div class="tool-step-text">
        <span class="tool-step-label"></span>
        <span class="tool-step-sub"></span>
      </div>
    </div>
    <span class="tool-step-ms" data-role="ms">running...</span>
  `;

  li.querySelector(".tool-step-label").textContent = friendly;
  const subEl = li.querySelector(".tool-step-sub");
  if (sub) {
    subEl.textContent = sub;
  } else {
    subEl.remove();
  }

  toolStepsList.appendChild(li);
  toolStepsList.scrollTop = toolStepsList.scrollHeight;
  updateAgentStepSummary();
}

function completeToolStep(tool, ok, ms) {
  const runningItems = Array.from(
    toolStepsList.querySelectorAll(`.tool-step-item[data-tool="${CSS.escape(tool)}"][data-status="running"]`)
  );
  const target =
    runningItems[0] ||
    toolStepsList.querySelector('.tool-step-item[data-status="running"]');

  if (!target) {
    addToolStepStart(tool, {});
    return completeToolStep(tool, ok, ms);
  }

  const isSuccess = ok !== false;
  target.dataset.status = isSuccess ? "done" : "error";

  const iconWrap = target.querySelector('[data-role="icon"]');
  if (isSuccess) {
    iconWrap.className = "step-icon step-icon-ok";
    iconWrap.innerHTML = `
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-label="Success">
        <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    `;
  } else {
    iconWrap.className = "step-icon step-icon-err";
    iconWrap.innerHTML = `
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-label="Failed">
        <path d="M4.5 4.5L11.5 11.5M11.5 4.5L4.5 11.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
    `;
  }

  const msEl = target.querySelector('[data-role="ms"]');
  msEl.textContent = typeof ms === "number" ? `${ms} ms` : isSuccess ? "done" : "failed";

  updateAgentStepSummary();
}

function updateAgentStepSummary() {
  const all = toolStepsList.querySelectorAll(".tool-step-item");
  const running = toolStepsList.querySelectorAll('.tool-step-item[data-status="running"]');
  if (all.length === 0) {
    agentPanelDot.dataset.active = "false";
    agentStepSummary.textContent = "Idle";
  } else if (running.length > 0) {
    agentPanelDot.dataset.active = "true";
    agentStepSummary.textContent = `${running.length} active · ${all.length} total`;
  } else {
    agentPanelDot.dataset.active = "false";
    agentStepSummary.textContent = `${all.length} step${all.length === 1 ? "" : "s"} complete`;
  }
}

/* ==========================================================================
   Utterance Dispatch & SSE Stream Consumer
   ========================================================================== */

export async function handleUserUtterance(rawText) {
  if (!rawText || !rawText.trim()) return;

  stopSpeaking();
  clearError();

  const cleanedText = stripWakeWord(rawText);
  if (!cleanedText) {
    liveTranscriptText.textContent = 'Heard wake word — say what you would like to watch!';
    setOrbState("idle");
    return;
  }

  const hadWake = cleanedText.length < rawText.trim().length;
  liveTranscriptBar.dataset.active = "true";
  transcriptLabel.textContent = hadWake ? "Sent (wake word stripped)" : "Sent";
  liveTranscriptText.textContent = cleanedText;

  const speaker = getCurrentSpeaker();
  appendUserBubble(cleanedText, speaker, rawText);
  resetToolStepsForTurn();
  setOrbState("thinking");

  const replyNode = createAssistantBubble();
  let accumulatedDelta = "";

  const handleStreamEvent = (evt) => {
    if (!evt || typeof evt !== "object") return;
    switch (evt.type) {
      case "start":
        if (evt.conversation_id) {
          conversationId = evt.conversation_id;
          conversationIdPill.textContent = `Session: ${conversationId}`;
        }
        break;
      case "tool_start":
        addToolStepStart(evt.tool, evt.input);
        break;
      case "tool_end":
        completeToolStep(evt.tool, evt.ok, evt.ms);
        if (!MOCK_MODE) {
          pollTvStateOnce();
        }
        break;
      case "text":
        if (typeof evt.delta === "string") {
          accumulatedDelta += evt.delta;
          replyNode.textContent = accumulatedDelta;
          chatLog.scrollTop = chatLog.scrollHeight;
        }
        break;
      case "done": {
        if (evt.conversation_id) {
          conversationId = evt.conversation_id;
          conversationIdPill.textContent = `Session: ${conversationId}`;
        }
        const finalReply = evt.reply || accumulatedDelta || "Done.";
        replyNode.textContent = finalReply;
        chatLog.scrollTop = chatLog.scrollHeight;
        updateAgentStepSummary();
        if (!MOCK_MODE) {
          pollTvStateOnce();
        }
        speakReply(finalReply);
        break;
      }
      case "error": {
        const errMsg = evt.error || "The agent encountered an unexpected error.";
        replyNode.textContent = errMsg;
        // Mark any running tool as failed
        toolStepsList
          .querySelectorAll('.tool-step-item[data-status="running"]')
          .forEach((el) => completeToolStep(el.dataset.tool, false, null));
        showError(errMsg);
        break;
      }
      default:
        break;
    }
  };

  if (MOCK_MODE) {
    await runMockStream(cleanedText, speaker, handleStreamEvent);
    return;
  }

  if (activeStreamAbort) {
    activeStreamAbort.abort();
  }
  const abortController = new AbortController();
  activeStreamAbort = abortController;

  try {
    const response = await fetch(`${AGENT_URL}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: cleanedText,
        speaker: speaker,
        conversation_id: conversationId,
      }),
      signal: abortController.signal,
    });

    if (!response.ok || !response.body) {
      let errMsg = `Agent error (${response.status})`;
      try {
        const errData = await response.json();
        if (errData && errData.error) errMsg = errData.error;
      } catch {
        /* ignore */
      }
      handleStreamEvent({ type: "error", error: errMsg });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr) continue;
        try {
          const parsed = JSON.parse(jsonStr);
          handleStreamEvent(parsed);
        } catch {
          /* ignore malformed SSE line */
        }
      }
    }

    if (buffer.trim().startsWith("data:")) {
      const jsonStr = buffer.trim().slice(5).trim();
      try {
        handleStreamEvent(JSON.parse(jsonStr));
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    if (err && err.name === "AbortError") return;
    handleStreamEvent({
      type: "error",
      error: "Cannot reach the Popcorn AI agent service on port 8100. Check that it is running or use ?mock=1.",
    });
  } finally {
    if (activeStreamAbort === abortController) {
      activeStreamAbort = null;
    }
  }
}

/* ==========================================================================
   Mock Mode Stream Simulator (?mock=1)
   ========================================================================== */

const MOCK_RECOMMENDATIONS = [
  {
    id: 508943,
    title: "Luca",
    year: "2021",
    match: 96,
    why: "Warm Italian summer adventure that fits Bedirhan, Ayse, and Can (PG)",
    poster: "https://image.tmdb.org/t/p/w342/jTswp6KyDYKtvC52GbHagrZbGvD.jpg",
  },
  {
    id: 346648,
    title: "Paddington 2",
    year: "2017",
    match: 94,
    why: "Loved by comedy fans and 100% kid-safe for the whole couch",
    poster: "https://image.tmdb.org/t/p/w342/1OJ9vkD5xPt3skC6KguyXAgagRZ.jpg",
  },
  {
    id: 354912,
    title: "Coco",
    year: "2017",
    match: 92,
    why: "Vibrant musical adventure blending everyone's top family & comedy tastes",
    poster: "https://image.tmdb.org/t/p/w342/gGEsBPAijhVUFoiNpgZXqRVWJt2.jpg",
  },
];

const MOCK_DUEL_PAIR = [
  {
    id: 27205,
    title: "Inception",
    year: "2010",
    genres: ["Action", "Science Fiction"],
    poster: "https://image.tmdb.org/t/p/w342/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg",
  },
  {
    id: 120467,
    title: "The Grand Budapest Hotel",
    year: "2014",
    genres: ["Comedy", "Drama"],
    poster: "https://image.tmdb.org/t/p/w342/eWdyYQreja6JGCzqHWXpWHDrrPo.jpg",
  },
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runMockStream(cleanedText, speaker, emit) {
  mockTurnCounter += 1;
  const mockConvId = conversationId || "c_mock_94e2a1";
  const lower = cleanedText.toLowerCase();
  const activeSpeaker = speaker || "Bedirhan";

  emit({ type: "start", conversation_id: mockConvId });
  await delay(180);

  // Error scenario
  if (lower.includes("error") || lower.includes("fail")) {
    emit({
      type: "tool_start",
      tool: "recommend_for_couch",
      input: { boost_genres: ["thriller"], limit: 6 },
    });
    await delay(360);
    emit({
      type: "tool_end",
      tool: "recommend_for_couch",
      ok: false,
      ms: 342,
    });
    await delay(120);
    emit({
      type: "error",
      error: "The movie database is not answering right now. Try again in a moment.",
    });
    return;
  }

  // Duel scenario
  if (lower.includes("duel")) {
    const people = [{ name: activeSpeaker }, { name: "Ayse" }];
    emit({ type: "tool_start", tool: "set_couch", input: { people } });
    await delay(380);
    emit({ type: "tool_end", tool: "set_couch", ok: true, ms: 384 });

    emit({ type: "tool_start", tool: "start_duel", input: { name: "Ayse", rounds: 5 } });
    await delay(460);
    emit({ type: "tool_end", tool: "start_duel", ok: true, ms: 462 });

    renderTvState({
      version: mockTurnCounter,
      screen: "duel",
      members: [
        { name: activeSpeaker, kid: false },
        { name: "Ayse", kid: false },
      ],
      duel: {
        name: "Ayse",
        round: 1,
        total: 5,
        pair: MOCK_DUEL_PAIR,
      },
      recommendations: [],
    });

    const reply =
      "Got it, Bedirhan and Ayse are on the couch. Ayse is new, so I started a 5-round poster duel on the TV — pick left or right!";
    await streamTextDeltas(reply, emit);
    emit({ type: "done", reply, conversation_id: mockConvId });
    return;
  }

  // Long reply scenario
  if (lower.includes("detailed") || lower.includes("long") || lower.includes("breakdown")) {
    emit({
      type: "tool_start",
      tool: "get_profiles",
      input: { names: [activeSpeaker, "Ayse", "Can"] },
    });
    await delay(310);
    emit({ type: "tool_end", tool: "get_profiles", ok: true, ms: 310 });

    emit({
      type: "tool_start",
      tool: "recommend_for_couch",
      input: { boost_genres: ["comedy", "animation"], limit: 6 },
    });
    await delay(520);
    emit({ type: "tool_end", tool: "recommend_for_couch", ok: true, ms: 518 });

    renderTvState({
      version: mockTurnCounter,
      screen: "recommendations",
      members: [
        { name: activeSpeaker, kid: false },
        { name: "Ayse", kid: false },
        { name: "Can", age: 9, kid: true },
      ],
      recommendations: MOCK_RECOMMENDATIONS,
    });

    const longReply =
      "Here is how tonight's lineup comes together for the three of you: Because 9-year-old Can is on the couch, every title is filtered to PG or below. Luca leads at 96% match because it blends Bedirhan's love of adventure with Ayse's favorite heartfelt comedies. Paddington 2 follows closely at 94% match with universal acclaim, and The Mitchells vs. the Machines brings fast-paced sci-fi laughs at 91% match.";
    await streamTextDeltas(longReply, emit);
    emit({ type: "done", reply: longReply, conversation_id: mockConvId });
    return;
  }

  // Default: Family couch + recommendations
  const people = [
    { name: activeSpeaker },
    { name: "Ayse" },
    { name: "Can", age: 9, kid: true },
  ];
  emit({ type: "tool_start", tool: "set_couch", input: { people } });
  await delay(420);
  emit({ type: "tool_end", tool: "set_couch", ok: true, ms: 412 });

  renderTvState({
    version: mockTurnCounter * 10 + 1,
    screen: "couch",
    members: [
      { name: activeSpeaker, kid: false },
      { name: "Ayse", kid: false },
      { name: "Can", age: 9, kid: true },
    ],
    recommendations: [],
  });

  emit({
    type: "tool_start",
    tool: "recommend_for_couch",
    input: { boost_genres: ["comedy"], limit: 6 },
  });
  await delay(580);
  emit({ type: "tool_end", tool: "recommend_for_couch", ok: true, ms: 576 });

  renderTvState({
    version: mockTurnCounter * 10 + 2,
    screen: "recommendations",
    members: [
      { name: activeSpeaker, kid: false },
      { name: "Ayse", kid: false },
      { name: "Can", age: 9, kid: true },
    ],
    recommendations: MOCK_RECOMMENDATIONS,
  });

  const reply = `All set — ${activeSpeaker}, Ayse, and Can are on the couch with kid-safe mode on. Top picks on the TV are Luca at 96% match and Paddington 2 at 94% match.`;
  await streamTextDeltas(reply, emit);
  emit({ type: "done", reply, conversation_id: mockConvId });
}

async function streamTextDeltas(fullText, emit) {
  const words = fullText.split(" ");
  const chunkSize = 4;
  for (let i = 0; i < words.length; i += chunkSize) {
    const piece = words.slice(i, i + chunkSize).join(" ") + (i + chunkSize < words.length ? " " : "");
    emit({ type: "text", delta: piece });
    await delay(55);
  }
}

/* ==========================================================================
   TV Preview Polling & Rendering
   ========================================================================== */

export function renderTvState(state) {
  if (!state || typeof state !== "object") return;
  const serialized = JSON.stringify({
    v: state.version,
    s: state.screen,
    m: state.members,
    r: (state.recommendations || []).map((x) => x.id),
    d: state.duel,
    dt: state.details && state.details.id,
  });
  if (serialized === lastTvStateKey) return;
  lastTvStateKey = serialized;

  const members = Array.isArray(state.members) ? state.members : [];
  const hasKid = members.some((m) => m && (m.kid || (typeof m.age === "number" && m.age < 13)));
  tvKidBadge.hidden = !hasKid;

  const screen = (state.screen || "couch").toUpperCase();
  tvScreenPill.textContent = screen === "RECOMMENDATIONS" ? "PICKS" : screen;

  // Render Couch Members Bar
  if (members.length === 0) {
    tvCouchBar.innerHTML = `<span class="tv-couch-empty">Couch is empty — say who is watching tonight</span>`;
  } else {
    tvCouchBar.innerHTML = "";
    members.forEach((member) => {
      const name = typeof member === "string" ? member : member.name || "Guest";
      const isKid = Boolean(member && (member.kid || (typeof member.age === "number" && member.age < 13)));

      const chip = document.createElement("div");
      chip.className = "couch-member-chip";

      const av = document.createElement("span");
      av.className = "avatar-circle avatar-sm";
      av.textContent = initialsForName(name);
      av.style.backgroundColor = avatarColorForName(name);

      const label = document.createElement("span");
      label.textContent = name;

      chip.appendChild(av);
      chip.appendChild(label);

      if (isKid) {
        const badge = document.createElement("span");
        badge.className = "kid-badge";
        badge.textContent = "KID";
        chip.appendChild(badge);
      }

      tvCouchBar.appendChild(chip);
    });
  }

  // Render TV Screen Viewport
  tvScreenViewport.innerHTML = "";

  if (state.screen === "duel" && state.duel && Array.isArray(state.duel.pair) && state.duel.pair.length >= 2) {
    const header = document.createElement("div");
    header.className = "tv-duel-header";
    header.innerHTML = `
      <span>Poster Duel for <strong>${escapeHtml(state.duel.name || "Guest")}</strong></span>
      <span>Round ${(state.duel.round || 0) + (state.duel.round === 0 ? 1 : 0)} of ${state.duel.total || 5}</span>
    `;
    const grid = document.createElement("div");
    grid.className = "tv-duel-grid";

    state.duel.pair.slice(0, 2).forEach((card, idx) => {
      const item = document.createElement("div");
      item.className = "tv-duel-card";
      item.appendChild(createPosterElement(card.poster, card.title));

      const title = document.createElement("div");
      title.className = "tv-movie-title";
      title.textContent = card.title || (idx === 0 ? "Left option" : "Right option");

      const side = document.createElement("div");
      side.className = "tv-movie-why";
      side.textContent = idx === 0 ? 'Say "Left"' : 'Say "Right"';

      item.appendChild(title);
      item.appendChild(side);
      grid.appendChild(item);
    });

    tvScreenViewport.appendChild(header);
    tvScreenViewport.appendChild(grid);
    return;
  }

  if (state.screen === "details" && state.details) {
    const d = state.details;
    const card = document.createElement("div");
    card.className = "tv-movie-card";
    card.appendChild(createPosterElement(d.poster, d.title));

    const info = document.createElement("div");
    info.className = "tv-movie-info";
    info.innerHTML = `
      <div class="tv-movie-top">
        <span class="tv-movie-title">${escapeHtml(d.title || "Movie")}<span class="tv-movie-year">${escapeHtml(d.year || "")}</span></span>
        ${d.certification_us ? `<span class="tv-match-pill">${escapeHtml(d.certification_us)}</span>` : ""}
      </div>
      <div class="tv-movie-why">${escapeHtml(d.overview || d.tagline || "")}</div>
    `;
    card.appendChild(info);
    tvScreenViewport.appendChild(card);
    return;
  }

  const recs = Array.isArray(state.recommendations) ? state.recommendations : [];
  if (recs.length > 0) {
    const list = document.createElement("div");
    list.className = "tv-recs-list";

    recs.slice(0, 4).forEach((movie) => {
      const card = document.createElement("div");
      card.className = "tv-movie-card";
      card.appendChild(createPosterElement(movie.poster, movie.title));

      const info = document.createElement("div");
      info.className = "tv-movie-info";

      const top = document.createElement("div");
      top.className = "tv-movie-top";

      const titleEl = document.createElement("span");
      titleEl.className = "tv-movie-title";
      titleEl.textContent = movie.title || "Untitled";
      if (movie.year) {
        const yearSpan = document.createElement("span");
        yearSpan.className = "tv-movie-year";
        yearSpan.textContent = `(${movie.year})`;
        titleEl.appendChild(yearSpan);
      }

      top.appendChild(titleEl);
      if (typeof movie.match === "number") {
        const matchPill = document.createElement("span");
        matchPill.className = "tv-match-pill";
        matchPill.textContent = `${movie.match}% match`;
        top.appendChild(matchPill);
      }

      const whyEl = document.createElement("div");
      whyEl.className = "tv-movie-why";
      whyEl.textContent = movie.why || (Array.isArray(movie.genres) ? movie.genres.join(", ") : "");

      info.appendChild(top);
      info.appendChild(whyEl);
      card.appendChild(info);
      list.appendChild(card);
    });

    tvScreenViewport.appendChild(list);
    return;
  }

  // Default couch / idle placeholder
  const placeholder = document.createElement("div");
  placeholder.className = "tv-placeholder";
  const msg = state.message || (members.length > 0 ? "Couch is ready — ask for movie recommendations" : "Ready for Movie Night");
  placeholder.innerHTML = `
    <p class="tv-placeholder-title">${escapeHtml(msg)}</p>
    <p class="tv-placeholder-sub">Picks and poster duels appear here automatically.</p>
  `;
  tvScreenViewport.appendChild(placeholder);
}

function createPosterElement(posterUrl, title) {
  const wrap = document.createElement("div");
  wrap.className = "tv-poster-wrap";

  const fb = document.createElement("span");
  fb.className = "tv-poster-fallback";
  fb.textContent = (title || "FILM").slice(0, 12);
  wrap.appendChild(fb);

  if (posterUrl && typeof posterUrl === "string" && posterUrl.startsWith("http")) {
    const img = document.createElement("img");
    img.className = "tv-poster-img";
    img.src = posterUrl;
    img.alt = title ? `${title} poster` : "Movie poster";
    img.addEventListener("error", () => {
      img.remove();
    });
    wrap.appendChild(img);
  }
  return wrap;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function pollTvStateOnce() {
  try {
    const res = await fetch(TV_STATE_URL, { method: "GET" });
    if (!res.ok) return;
    const data = await res.json();
    renderTvState(data);
  } catch {
    /* silent when MCP TV endpoint is unreachable */
  }
}

function startTvPolling() {
  if (MOCK_MODE) {
    renderTvState({
      version: 0,
      screen: "couch",
      members: [],
      recommendations: [],
      message: "Waiting for tonight's couch lineup",
    });
    return;
  }
  pollTvStateOnce();
  setInterval(pollTvStateOnce, TV_POLL_INTERVAL_MS);
}

/* ==========================================================================
   Health Check & Mode Indicator
   ========================================================================== */

async function checkAgentHealth() {
  if (MOCK_MODE) {
    modeBadge.dataset.mode = "mock";
    modeBadge.textContent = "Mock Mode (?mock=1)";
    return;
  }

  try {
    const res = await fetch(`${AGENT_URL}/health`, { method: "GET" });
    if (res.ok) {
      const data = await res.json();
      modeBadge.dataset.mode = "live";
      modeBadge.textContent = data.voice ? `Live · ${data.voice}` : "Live Agent";
    } else {
      modeBadge.dataset.mode = "offline";
      modeBadge.textContent = "Agent unavailable";
    }
  } catch {
    modeBadge.dataset.mode = "offline";
    modeBadge.textContent = "Agent offline (use ?mock=1)";
  }
}

/* ==========================================================================
   Event Listeners (Orb, Push-to-Talk Space Bar, Composer, New Night)
   ========================================================================== */

voiceOrb.addEventListener("click", () => {
  if (orbState === "speaking") {
    stopSpeaking();
    return;
  }
  if (orbState === "listening") {
    stopListening();
    return;
  }
  startListening();
});

// Space bar push-to-talk (when not typing in an input)
window.addEventListener("keydown", (e) => {
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;

  if (e.code === "Space" && !e.repeat) {
    e.preventDefault();
    if (orbState === "speaking") {
      stopSpeaking();
      return;
    }
    if (orbState === "idle" || orbState === "error") {
      pushToTalkActive = true;
      startListening();
    } else if (orbState === "listening" && !pushToTalkActive) {
      stopListening();
    }
  }
});

window.addEventListener("keyup", (e) => {
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;

  if (e.code === "Space" && pushToTalkActive) {
    e.preventDefault();
    pushToTalkActive = false;
    stopListening();
  }
});

composerForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const val = composerInput.value.trim();
  if (!val) return;
  composerInput.value = "";
  handleUserUtterance(val);
});

quickPrompts.addEventListener("click", (e) => {
  const btn = e.target.closest(".prompt-chip");
  if (!btn) return;
  const prompt = btn.dataset.prompt;
  if (prompt) {
    handleUserUtterance(prompt);
  }
});

newNightBtn.addEventListener("click", () => {
  stopSpeaking();
  stopListening();
  clearError();
  conversationId = null;
  conversationIdPill.textContent = "Session: new night";
  chatLog.innerHTML = `
    <div class="chat-empty" id="chat-empty">
      <p class="chat-empty-title">New night started</p>
      <p class="chat-empty-sub">
        Conversation context cleared. Tell Popcorn AI who is on the couch tonight!
      </p>
    </div>
  `;
  toolStepsList.innerHTML = `
    <li class="tool-steps-empty" id="tool-steps-empty">
      MCP tool calls (<code class="inline-code">set_couch</code>,
      <code class="inline-code">recommend_for_couch</code>,
      <code class="inline-code">start_duel</code>) appear here live as the agent works.
    </li>
  `;
  agentPanelDot.dataset.active = "false";
  agentStepSummary.textContent = "Idle";
  liveTranscriptBar.dataset.active = "false";
  transcriptLabel.textContent = "Live mic";
  liveTranscriptText.textContent = "Waiting for voice or typed input...";
  setOrbState("idle");
});

/* ==========================================================================
   Bootstrap
   ========================================================================== */

initSpeaker();
setupSpeechRecognition();
checkAgentHealth();
startTvPolling();

if (INITIAL_ORB_STATE && ORB_STATE_META[INITIAL_ORB_STATE]) {
  setOrbState(INITIAL_ORB_STATE);
}

// Expose test/debug handle for verification
window.__popcornApp = {
  setOrbState,
  handleUserUtterance,
  renderTvState,
  stopSpeaking,
};
