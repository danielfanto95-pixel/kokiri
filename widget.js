// Kokiri site-wide assistant widget — floating chat bubble present on every authenticated page.
// Knows what page it's on, remembers conversation, can create/assign tasks, create/edit agents,
// look up live Kokiri data, and navigate you around the site. Voice input/output via Deepgram
// (real STT/TTS, customizable voice, works in any browser) when a key is configured in Settings,
// falling back automatically to the browser's built-in Web Speech API otherwise.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://qahriykfwknuoqctsaek.supabase.co';
const SUPABASE_KEY = 'sb_publishable_nPF5goHAWj0iAiUOnhnXPA_8qd3b2mU';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PAGE_NAMES = { 'home.html': 'Home', 'app.html': 'Kokiri (sheets)', 'agents.html': 'Agent Dashboard', 'dashboards.html': 'Dashboards', 'context.html': 'Global Context' };
const currentPage = location.pathname.split('/').pop() || 'home.html';

function escapeHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const styleEl = document.createElement('style');
styleEl.textContent = `
#kokiri-widget-bubble {
  position: fixed; bottom: 1.5rem; right: 1.5rem; width: 56px; height: 56px; border-radius: 50%;
  background: #7cc576; color: #0c120d; border: none; font-size: 1.4rem; cursor: pointer; z-index: 999;
  box-shadow: 0 4px 20px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center;
  transition: transform 0.15s;
}
#kokiri-widget-bubble:hover { transform: scale(1.06); }
#kokiri-widget-panel {
  position: fixed; bottom: 5.5rem; right: 1.5rem; width: 340px; max-height: 480px; background: #121a13;
  border: 1px solid rgba(163,214,140,0.32); border-radius: 14px; display: none; flex-direction: column;
  overflow: hidden; z-index: 999; box-shadow: 0 8px 40px rgba(0,0,0,0.5); font-family: 'Inter', sans-serif;
}
#kokiri-widget-panel.open { display: flex; }
#kokiri-widget-head { padding: 0.7rem 0.9rem; border-bottom: 1px solid rgba(163,214,140,0.14); display: flex; align-items: center; gap: 0.5rem; background: #17201a; }
#kokiri-widget-head .title { font-family: 'Cinzel', serif; font-weight: 700; font-size: 0.85rem; color: #a8e79f; flex: 1; }
#kokiri-widget-head .page-tag { font-family: 'IBM Plex Mono', monospace; font-size: 0.6rem; color: #6b8065; }
#kokiri-widget-close { background: none; border: none; color: #9db396; cursor: pointer; font-size: 1rem; padding: 0 0.2rem; }
#kokiri-widget-log { flex: 1; overflow-y: auto; padding: 0.8rem; display: flex; flex-direction: column; gap: 0.6rem; font-size: 0.82rem; color: #e4ede0; }
#kokiri-widget-log .msg .role { font-family: 'IBM Plex Mono', monospace; font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.15rem; }
#kokiri-widget-log .msg.user .role { color: #e6c068; }
#kokiri-widget-log .msg.assistant .role { color: #7cc576; }
#kokiri-widget-log .msg .content { background: #17201a; border: 1px solid rgba(163,214,140,0.14); border-radius: 8px; padding: 0.5rem 0.7rem; white-space: pre-wrap; }
#kokiri-widget-input-row { padding: 0.6rem; border-top: 1px solid rgba(163,214,140,0.14); display: flex; gap: 0.4rem; background: #121a13; }
#kokiri-widget-input { flex: 1; background: #0c120d; border: 1px solid rgba(163,214,140,0.14); border-radius: 7px; color: #e4ede0; font-size: 0.82rem; padding: 0.45rem 0.6rem; resize: none; min-height: 34px; font-family: inherit; }
#kokiri-widget-input:focus { outline: none; border-color: #7cc576; }
#kokiri-widget-mic, #kokiri-widget-send {
  background: #17201a; border: 1px solid rgba(163,214,140,0.14); color: #a8e79f; border-radius: 7px; cursor: pointer;
  font-size: 0.9rem; padding: 0 0.6rem; flex-shrink: 0;
}
#kokiri-widget-mic.listening { background: #e6c068; color: #0c120d; animation: kw-pulse 1.1s ease-in-out infinite; }
#kokiri-widget-mic.processing { background: #6b8065; color: #0c120d; }
@keyframes kw-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
#kokiri-widget-send:disabled { opacity: 0.5; cursor: not-allowed; }
`;
document.head.appendChild(styleEl);

const bubble = document.createElement('button');
bubble.id = 'kokiri-widget-bubble';
bubble.textContent = '🧚';
bubble.title = 'Talk to Navi';
document.body.appendChild(bubble);

const panel = document.createElement('div');
panel.id = 'kokiri-widget-panel';
panel.innerHTML = `
  <div id="kokiri-widget-head">
    <div class="title">🧚 Navi</div>
    <div class="page-tag">${PAGE_NAMES[currentPage] || currentPage}</div>
    <button id="kokiri-widget-close">✕</button>
  </div>
  <div id="kokiri-widget-log"></div>
  <div id="kokiri-widget-input-row">
    <textarea id="kokiri-widget-input" placeholder="Ask or tell me to do something..."></textarea>
    <button id="kokiri-widget-mic" title="Voice input">🎤</button>
    <button id="kokiri-widget-send">➤</button>
  </div>
`;
document.body.appendChild(panel);

bubble.addEventListener('click', () => {
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) init();
});
document.getElementById('kokiri-widget-close').addEventListener('click', () => panel.classList.remove('open'));

let initialized = false;
let threadId = null;
let agentsCache = [];
let sheetsCache = [];
let deepgramVoice = 'aura-asteria-en';
let deepgramConfigured = false;
let localSettings = {};
let mcpServers = [];

async function init() {
  if (initialized) return;
  initialized = true;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { document.getElementById('kokiri-widget-log').innerHTML = '<p style="color:#9db396;">Log in to chat with Navi.</p>'; return; }

  const [{ data: agents }, { data: sheets }, { data: settingsRows }, { data: mcpData }] = await Promise.all([
    supabase.from('agents').select('id, name, purpose, status').order('sort_order'),
    supabase.from('kokiri_sheets').select('id, slug, name').order('sort_order'),
    supabase.from('kokiri_settings').select('key, value').in('key', ['deepgram_voice', 'deepgram_key_configured', 'omnirouter_url', 'omnirouter_key', 'ollama_url', 'ollama_model', 'notion_key_configured', 'descript_key_configured', 'tavily_key_configured']),
    supabase.from('kokiri_mcp_servers').select('id, name, tools_cache'),
  ]);
  agentsCache = agents || [];
  sheetsCache = sheets || [];
  mcpServers = mcpData || [];
  (settingsRows || []).forEach(r => {
    if (r.key === 'deepgram_voice' && r.value) deepgramVoice = r.value;
    if (r.key === 'deepgram_key_configured') deepgramConfigured = r.value === 'true';
    localSettings[r.key] = r.value;
  });

  let { data: thread } = await supabase.from('chat_threads').select('*').is('agent_id', null).eq('title', 'Site Assistant').maybeSingle();
  if (!thread) {
    const { data: created } = await supabase.from('chat_threads').insert({ agent_id: null, title: 'Site Assistant' }).select().single();
    thread = created;
  }
  threadId = thread.id;

  const { data: history } = await supabase.from('chat_messages').select('*').eq('thread_id', threadId).order('created_at', { ascending: true }).limit(20);
  const log = document.getElementById('kokiri-widget-log');
  log.innerHTML = (history || []).map(m => renderMsg(m.role, m.content)).join('') ||
    `<p style="color:#9db396;font-size:0.78rem;">Hi — I'm Navi. I can answer questions, look things up, create/assign tasks, spin up or edit agents, and take you anywhere on the site. Try "take me to Dashboards" or "what tasks are pending?"</p>`;
  log.scrollTop = log.scrollHeight;
}

function renderMsg(role, content) {
  return `<div class="msg ${role}"><div class="role">${role}</div><div class="content">${escapeHtml(content)}</div></div>`;
}

function buildSystemPrompt() {
  const roster = agentsCache.map(a => `${a.name} (${a.status})`).join(', ') || '(none)';
  const sheetNames = sheetsCache.map(s => s.name).join(', ') || '(none)';
  return `You are Navi, the site-wide assistant embedded on every page of Kokiri, Daniel's personal system. You are currently on the "${PAGE_NAMES[currentPage] || currentPage}" page. Respond helpfully and concisely (2-4 sentences unless more detail is genuinely needed).

Known agents: ${roster}.
Known Kokiri sheets: ${sheetNames}.
Site pages you can navigate to: home, app (Kokiri sheets), agents (Agent Dashboard), dashboards, context (Global Instructions).

You can take real actions by including EXACTLY ONE JSON block at the very end of your reply: [ACTION]{...}[/ACTION]. Only include it when clearly warranted — never invent actions unprompted.

Valid action shapes:
- {"type":"create_task","agent":"<exact agent name>","title":"...","description":"..."}
- {"type":"create_agent","name":"...","purpose":"...","icon":"<emoji>","model_pref":"auto"}
- {"type":"edit_agent","agent":"<exact agent name>","updates":{"purpose":"...","status":"active|paused"}}
- {"type":"query_data","source":"kokiri_rows","sheet":"<exact sheet name>"}
- {"type":"query_data","source":"agent_tasks","agent":"<exact agent name>"}
- {"type":"navigate","page":"home|app|agents|dashboards|context"}
${mcpToolsPrompt()}
Use navigate when the user asks to go somewhere. Use query_data/mcp_tool_call when answering requires real data you don't have — you'll get a follow-up turn with the data. Write your reply text first, then the action block if needed. Never mention the raw JSON to the user.`;
}

function mcpToolsPrompt() {
  const lines = [];
  for (const server of mcpServers) {
    for (const tool of (server.tools_cache || [])) {
      lines.push(`- {"type":"mcp_tool_call","server":"${server.name}","tool":"${tool.name}","arguments":{...}}  — ${tool.description || tool.name} (via MCP server "${server.name}")`);
    }
  }
  if (!lines.length) return '';
  return '\nConnected external tools (via MCP servers registered in Settings):\n' + lines.join('\n') + '\n';
}

async function callMcpClient(body) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(SUPABASE_URL + '/functions/v1/mcp-client', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error || 'mcp-client request failed');
  return json;
}

async function callIntelligence(messages) {
  // 1. Premium/OpenRouter cascade via the server-side proxy.
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    const res = await fetch(SUPABASE_URL + '/functions/v1/chat-proxy', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
      body: JSON.stringify({ messages }),
    });
    clearTimeout(t);
    if (res.ok) { const json = await res.json(); if (json.text) return json; }
  } catch { /* fall through */ }

  // 2. OmniRoute (local, free) — only reachable if you're on the machine running it.
  const omniUrl = (localSettings.omnirouter_url || 'http://localhost:20128').replace(/\/$/, '');
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(omniUrl + '/v1/chat/completions', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(localSettings.omnirouter_key ? { Authorization: 'Bearer ' + localSettings.omnirouter_key } : {}) },
      body: JSON.stringify({ model: 'auto/free', messages }),
    });
    clearTimeout(t);
    if (!res.ok) throw new Error('omni not ok');
    const json = await res.json();
    return { text: json.choices?.[0]?.message?.content || '(empty response)', source: 'omnirouter' };
  } catch { /* fall through to Ollama */ }

  // 3. Ollama (local, free, unlimited) — same reachability constraint as OmniRoute.
  if (localSettings.ollama_model) {
    const ollamaUrl = (localSettings.ollama_url || 'http://localhost:11434').replace(/\/$/, '');
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(ollamaUrl + '/api/chat', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: localSettings.ollama_model, messages, stream: false }),
      });
      clearTimeout(t);
      if (!res.ok) throw new Error('ollama not ok');
      const json = await res.json();
      const text = json.message?.content;
      if (text) return { text, source: 'ollama' };
    } catch { /* fall through */ }
  }

  throw new Error('No intelligence available right now — check Settings on the Agent Dashboard for a configured key, or make sure OmniRoute/Ollama is running locally.');
}

function extractAction(text) {
  const m = text.match(/\[ACTION\]([\s\S]*?)\[\/ACTION\]/);
  if (!m) return { cleanText: text, action: null };
  const cleanText = text.replace(m[0], '').trim();
  try { return { cleanText, action: JSON.parse(m[1].trim()) }; } catch { return { cleanText, action: null }; }
}

async function fetchQueryData(action) {
  if (action.source === 'kokiri_rows' && action.sheet) {
    const sheet = sheetsCache.find(s => s.name.toLowerCase() === action.sheet.toLowerCase());
    if (!sheet) return { error: `Unknown sheet "${action.sheet}"` };
    const { data: rows } = await supabase.from('kokiri_rows').select('data').eq('sheet_id', sheet.id).order('sort_order').limit(30);
    return { sheet: sheet.name, rows: (rows || []).map(r => r.data) };
  }
  if (action.source === 'agent_tasks' && action.agent) {
    const agent = agentsCache.find(a => a.name.toLowerCase() === action.agent.toLowerCase());
    if (!agent) return { error: `Unknown agent "${action.agent}"` };
    const { data } = await supabase.from('agent_tasks').select('title, status, description').eq('agent_id', agent.id).order('created_at', { ascending: false }).limit(20);
    return { agent: agent.name, tasks: data || [] };
  }
  return { error: 'Unrecognized query.' };
}

const PAGE_URLS = { home: 'home.html', app: 'app.html', agents: 'agents.html', dashboards: 'dashboards.html', context: 'context.html' };

async function executeAction(action) {
  if (action.type === 'mcp_tool_call') {
    const server = mcpServers.find(s => s.name.toLowerCase() === (action.server || '').toLowerCase());
    if (!server) return { confirmation: `⚠ Unknown MCP server "${action.server}".` };
    try {
      const { result } = await callMcpClient({ type: 'call_tool', server_id: server.id, tool_name: action.tool, arguments: action.arguments || {} });
      return { queryResult: { mcp_server: server.name, mcp_tool: action.tool, result } };
    } catch (e) {
      return { confirmation: `⚠ ${server.name}/${action.tool} failed: ${e.message}` };
    }
  }
  if (action.type === 'navigate' && PAGE_URLS[action.page]) {
    setTimeout(() => { location.href = PAGE_URLS[action.page]; }, 700);
    return { confirmation: `→ Taking you to ${PAGE_NAMES[PAGE_URLS[action.page]] || action.page}...` };
  }
  if (action.type === 'create_task') {
    const agent = agentsCache.find(a => a.name.toLowerCase() === (action.agent || '').toLowerCase());
    if (!agent) return { confirmation: `⚠ Couldn't find agent "${action.agent}".` };
    await supabase.from('agent_tasks').insert({ agent_id: agent.id, title: action.title || 'Untitled', description: action.description || '', status: 'todo' });
    return { confirmation: `✓ Created task "${action.title}" for ${agent.name}.` };
  }
  if (action.type === 'create_agent') {
    await supabase.from('agents').insert({ name: action.name, purpose: action.purpose || '', icon: action.icon || '⚔️', model_pref: action.model_pref || 'auto', sort_order: agentsCache.length + 1 });
    return { confirmation: `✓ Created agent "${action.name}".` };
  }
  if (action.type === 'edit_agent') {
    const agent = agentsCache.find(a => a.name.toLowerCase() === (action.agent || '').toLowerCase());
    if (!agent) return { confirmation: `⚠ Couldn't find agent "${action.agent}".` };
    await supabase.from('agents').update(action.updates || {}).eq('id', agent.id);
    return { confirmation: `✓ Updated agent "${agent.name}".` };
  }
  if (action.type === 'query_data') {
    return { queryResult: await fetchQueryData(action) };
  }
  return null;
}

let voiceOutputEnabled = false;

function speakBrowser(cleanText) {
  if (!window.speechSynthesis) return;
  const utter = new SpeechSynthesisUtterance(cleanText);
  utter.rate = 1.05;
  window.speechSynthesis.speak(utter);
}

async function speak(text) {
  if (!voiceOutputEnabled) return;
  const cleanText = text.replace(/\[ACTION\][\s\S]*?\[\/ACTION\]/, '').trim();
  if (!cleanText) return;

  if (!deepgramConfigured) { speakBrowser(cleanText); return; }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(SUPABASE_URL + '/functions/v1/deepgram-tts', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
      body: JSON.stringify({ text: cleanText, voice: deepgramVoice }),
    });
    clearTimeout(t);
    if (!res.ok) throw new Error('deepgram tts unavailable');
    const blob = await res.blob();
    const audio = new Audio(URL.createObjectURL(blob));
    audio.play();
  } catch {
    speakBrowser(cleanText); // graceful fallback, same as the LLM cascade elsewhere in Kokiri
  }
}

async function sendMessage(text) {
  if (!text.trim()) return;
  const log = document.getElementById('kokiri-widget-log');
  const sendBtn = document.getElementById('kokiri-widget-send');
  sendBtn.disabled = true;

  await supabase.from('chat_messages').insert({ thread_id: threadId, role: 'user', content: text });
  log.insertAdjacentHTML('beforeend', renderMsg('user', text));
  log.insertAdjacentHTML('beforeend', `<div class="msg assistant" id="kw-thinking"><div class="role">assistant</div><div class="content">…thinking</div></div>`);
  log.scrollTop = log.scrollHeight;

  try {
    const { data: history } = await supabase.from('chat_messages').select('role, content').eq('thread_id', threadId).order('created_at', { ascending: true }).limit(20);
    let messages = [{ role: 'system', content: buildSystemPrompt() }, ...(history || []).map(m => ({ role: m.role, content: m.content }))];

    let reply = await callIntelligence(messages);
    let { cleanText, action } = extractAction(reply.text);
    let finalText = cleanText;

    if (action) {
      const result = await executeAction(action);
      if (result?.confirmation) {
        finalText += `\n\n${result.confirmation}`;
      } else if (result?.queryResult) {
        messages.push({ role: 'assistant', content: cleanText || '(looking up data...)' });
        messages.push({ role: 'user', content: `Here is the data you requested:\n${JSON.stringify(result.queryResult).slice(0, 6000)}\n\nNow answer my original question using this data.` });
        const followUp = await callIntelligence(messages);
        finalText = extractAction(followUp.text).cleanText;
        reply = followUp;
      }
    }

    await supabase.from('chat_messages').insert({ thread_id: threadId, role: 'assistant', content: finalText, model_used: reply.source });
    document.getElementById('kw-thinking')?.remove();
    log.insertAdjacentHTML('beforeend', renderMsg('assistant', finalText));
    log.scrollTop = log.scrollHeight;
    speak(finalText);
  } catch (err) {
    document.getElementById('kw-thinking')?.remove();
    log.insertAdjacentHTML('beforeend', renderMsg('assistant', '⚠ ' + err.message));
  } finally {
    sendBtn.disabled = false;
  }
}

document.getElementById('kokiri-widget-send').addEventListener('click', () => {
  const input = document.getElementById('kokiri-widget-input');
  const text = input.value.trim();
  input.value = '';
  sendMessage(text);
});
document.getElementById('kokiri-widget-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('kokiri-widget-send').click(); }
});

// Voice input. Two paths:
//  1. Deepgram (when configured in Settings): record with MediaRecorder, send the clip to the
//     deepgram-stt Edge Function for real transcription (Nova-2) — works in any browser.
//  2. Fallback: the browser's built-in SpeechRecognition (Chromium-based browsers only).
const micBtn = document.getElementById('kokiri-widget-mic');
const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
const hasMediaRecorder = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

async function transcribeWithDeepgram(blob) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(SUPABASE_URL + '/functions/v1/deepgram-stt', {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'audio/webm', 'x-audio-mimetype': blob.type || 'audio/webm', Authorization: 'Bearer ' + session.access_token },
    body: blob,
  });
  if (!res.ok) throw new Error('deepgram stt unavailable');
  const json = await res.json();
  if (!json.transcript) throw new Error('empty transcript');
  return json.transcript;
}

let mediaRecorder = null;
let recordedChunks = [];
let recording = false;

async function startDeepgramRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  recordedChunks = [];
  mediaRecorder.addEventListener('dataavailable', (e) => { if (e.data.size > 0) recordedChunks.push(e.data); });
  mediaRecorder.addEventListener('stop', async () => {
    stream.getTracks().forEach(tr => tr.stop());
    recording = false;
    micBtn.classList.remove('listening');
    micBtn.classList.add('processing');
    try {
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      const transcript = await transcribeWithDeepgram(blob);
      sendMessage(transcript);
    } catch {
      micBtn.classList.remove('processing');
      // Fall back to browser recognition for this attempt if available
      if (SpeechRecognitionAPI) startBrowserRecognition();
    } finally {
      micBtn.classList.remove('processing');
    }
  });
  mediaRecorder.start();
  recording = true;
  micBtn.classList.add('listening');
}

function stopDeepgramRecording() {
  if (mediaRecorder && recording) mediaRecorder.stop();
}

let browserRecognition = null;
let browserListening = false;
function startBrowserRecognition() {
  if (!SpeechRecognitionAPI) return;
  browserRecognition = new SpeechRecognitionAPI();
  browserRecognition.continuous = false;
  browserRecognition.interimResults = false;
  browserRecognition.lang = 'en-US';
  browserRecognition.addEventListener('start', () => { browserListening = true; micBtn.classList.add('listening'); });
  browserRecognition.addEventListener('end', () => { browserListening = false; micBtn.classList.remove('listening'); });
  browserRecognition.addEventListener('result', (e) => sendMessage(e.results[0][0].transcript));
  browserRecognition.start();
}

if (hasMediaRecorder || SpeechRecognitionAPI) {
  micBtn.addEventListener('click', async () => {
    voiceOutputEnabled = true; // once you use voice in, we talk back too
    if (recording) { stopDeepgramRecording(); return; }
    if (browserListening) { browserRecognition.stop(); return; }

    if (deepgramConfigured && hasMediaRecorder) {
      try { await startDeepgramRecording(); return; } catch { /* mic permission denied or unsupported — fall through */ }
    }
    startBrowserRecognition();
  });
} else {
  micBtn.style.display = 'none';
}
