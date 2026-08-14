// Kokiri site ambience — purely decorative. A procedurally-generated 8-bit chiptune loop
// (Web Audio API, no external audio files) plus a handful of bouncing pixel-style sprites
// scattered around the page. Off by default — click the note button to start it, since
// browsers block autoplaying audio without a user gesture (and it'd be annoying otherwise).

const styleEl = document.createElement('style');
styleEl.textContent = `
@keyframes kokiri-bounce {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-16px) scale(1.05); }
}
.kokiri-sprite {
  position: fixed; font-size: 1.7rem; z-index: 5; pointer-events: none; user-select: none;
  animation: kokiri-bounce 1s steps(4) infinite;
  filter: drop-shadow(0 4px 6px rgba(0,0,0,0.45)) saturate(1.1);
  image-rendering: pixelated;
}
@media (max-width: 900px) { .kokiri-sprite { display: none; } }

#kokiri-music-toggle {
  position: fixed; bottom: 1.5rem; left: 1.5rem; width: 48px; height: 48px; border-radius: 50%;
  background: #17201a; border: 1px solid rgba(163,214,140,0.32); color: #a8e79f; font-size: 1.15rem;
  cursor: pointer; z-index: 999; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4); transition: transform 0.15s, color 0.15s, border-color 0.15s;
}
#kokiri-music-toggle:hover { transform: scale(1.08); }
#kokiri-music-toggle.playing { color: #e6c068; border-color: rgba(230,192,106,0.45); animation: kokiri-bounce 0.9s steps(4) infinite; }
`;
document.head.appendChild(styleEl);

// --- Bouncing sprites, scattered around the viewport edges so they don't cover content ---
const SPRITES = [
  { emoji: '🌱', top: '20%', left: '3%', delay: '0s' },
  { emoji: '⭐', top: '32%', right: '4%', delay: '0.25s' },
  { emoji: '🍄', bottom: '26%', left: '5%', delay: '0.5s' },
  { emoji: '💎', bottom: '18%', right: '3%', delay: '0.15s' },
  { emoji: '🌿', top: '55%', left: '2%', delay: '0.4s' },
];
SPRITES.forEach(s => {
  const el = document.createElement('div');
  el.className = 'kokiri-sprite';
  el.textContent = s.emoji;
  el.style.animationDelay = s.delay;
  ['top', 'left', 'right', 'bottom'].forEach(k => { if (s[k]) el.style[k] = s[k]; });
  document.body.appendChild(el);
});

// --- 8-bit chiptune loop (Web Audio API — square wave lead + triangle bass, no audio files) ---
const btn = document.createElement('button');
btn.id = 'kokiri-music-toggle';
btn.title = '8-bit music';
btn.textContent = '🎵';
document.body.appendChild(btn);

let audioCtx = null;
let playing = false;
let loopTimer = null;

// An original, simple pentatonic-ish loop — not a cover of anything.
const MELODY = [
  { n: 659.25, d: 0.18 }, { n: 783.99, d: 0.18 }, { n: 987.77, d: 0.18 }, { n: 783.99, d: 0.18 },
  { n: 659.25, d: 0.18 }, { n: 587.33, d: 0.18 }, { n: 659.25, d: 0.36 },
  { n: 523.25, d: 0.18 }, { n: 659.25, d: 0.18 }, { n: 783.99, d: 0.36 },
];
const BASS = [
  { n: 130.81, d: 0.72 }, { n: 98.00, d: 0.72 }, { n: 130.81, d: 0.72 }, { n: 164.81, d: 0.72 },
];

function playNote(freq, startTime, duration, type, volume) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

function scheduleLoop() {
  const startTime = audioCtx.currentTime + 0.05;
  let t = startTime;
  MELODY.forEach(note => { playNote(note.n, t, note.d, 'square', 0.06); t += note.d; });
  let tb = startTime;
  BASS.forEach(note => { playNote(note.n, tb, note.d, 'triangle', 0.045); tb += note.d; });
  const loopDuration = MELODY.reduce((sum, n) => sum + n.d, 0);
  loopTimer = setTimeout(() => { if (playing) scheduleLoop(); }, loopDuration * 1000);
}

btn.addEventListener('click', () => {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (playing) {
    playing = false;
    clearTimeout(loopTimer);
    btn.classList.remove('playing');
    btn.textContent = '🎵';
  } else {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    playing = true;
    scheduleLoop();
    btn.classList.add('playing');
    btn.textContent = '🔊';
  }
});
