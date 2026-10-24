// Bookworm chatbot logic. Settings come from config.js; notes come from knowledge.md.

const DEFAULTS = {
  name: "Bookworm", emoji: "📚", tagline: "Your friendly book-finding buddy",
  welcomeMessage: "Hi! I’m Bookworm and I am here to help start your reading experience. What are you looking for?",
  starterQuestions: [], model: "claude-sonnet-5-5", systemInstructions: "You are a helpful assistant.",
  useKnowledge: false, knowledgeFile: "knowledge.md", searchMethod: "meaning", topK: 3,
  embeddingModel: "gemini-embedding-2", knowledgeRules: ""
};
const CFG = Object.assign({}, DEFAULTS, typeof BOT_CONFIG !== "undefined" ? BOT_CONFIG : {});
const GOOGLE_MODELS = ["gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-flash-latest"]; // tried in order
const RULES = CFG.systemInstructions;
const MAX_CHARS = 1500;

const $ = id => document.getElementById(id);
const chat = $("chat"), chips = $("chips"), f = $("f"), input = $("in"), go = $("go");
const keybar = $("keybar"), keyin = $("keyin"), keynote = $("keynote"), kstatus = $("kstatus");
let history = [], sample = null, busy = false, apiKey = "", provider = "anthropic";

$("botname").textContent = CFG.name + " " + CFG.emoji;
$("tagline").textContent = CFG.tagline;
document.title = CFG.name + " " + CFG.emoji;

// ---------- API key box ----------
try { apiKey = localStorage.getItem("bookworm_key") || ""; provider = localStorage.getItem("bookworm_provider") || "anthropic"; } catch(e) {}
const prov = document.createElement("select");
prov.id = "provider";
prov.innerHTML = '<option value="anthropic">Anthropic</option><option value="google">Google</option>';
prov.style.cssText = "padding:8px;border-radius:999px;border:1px solid #cfcac4;font-size:.9rem";
keyin.before(prov); prov.value = provider;
function showNote(){
  keynote.hidden = !apiKey;
  keynote.textContent = apiKey ? "🔑 Using your " + (provider === "google" ? "Google" : "Anthropic") + " API key (saved only in this browser)." : "";
}
showNote();
$("keybtn").onclick = () => { keybar.hidden = !keybar.hidden; if(!keybar.hidden) keyin.focus(); };
$("keysave").onclick = () => {
  apiKey = keyin.value.replace(/["'\s]/g, "");
  if(apiKey.startsWith("sk-ant")) prov.value = "anthropic"; else if(apiKey.startsWith("AIza")) prov.value = "google";
  provider = prov.value; keyin.value = ""; keybar.hidden = true;
  try { localStorage.setItem("bookworm_key", apiKey); localStorage.setItem("bookworm_provider", provider); } catch(e) {}
  showNote(); startKnowledge(false);
};
$("keyclear").onclick = () => {
  apiKey = ""; keyin.value = ""; keybar.hidden = true;
  try { localStorage.removeItem("bookworm_key"); } catch(e) {}
  showNote(); startKnowledge(false);
};

// ---------- Knowledge (RAG) ----------
let kChunks = [], kVectors = null, kState = "loading", kFinger = "", kNoteCount = 0;
let kEmbedding = false, kFallback = "", kLoaded = false, kRun = 0, kInit = Promise.resolve();
const canEmbed = () => !!apiKey && provider === "google";
const wantMeaning = () => CFG.searchMethod === "meaning" && kVectors && canEmbed() && !kFallback;

function hash(str){ // short fingerprint of knowledge.md
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for(let i = 0; i < str.length; i++){ const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const STOP = new Set("the and for are but not you your with that this from have has had was were what which who how when where why can could should would will about into than then them they their there here does did any some more most other such only own same too very just also tell give want need like".split(" "));
const stem = w => w.endsWith("ies") && w.length > 4 ? w.slice(0, -3) + "y" : (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const tokens = s => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function parseKnowledge(text){ // "## Title" starts a note; text above the first "##" is ignored
  const notes = []; let cur = null;
  for(const line of text.replace(/\r/g, "").split("\n")){
    if(/^\s*```/.test(line)) continue;
    const m = line.match(/^##\s+(.+)$/);
    if(m){ cur = {title: m[1].trim(), lines: []}; notes.push(cur); }
    else if(cur) cur.lines.push(line);
  }
  const chunks = []; let n = 0;
  for(const note of notes){
    const body = note.lines.join("\n").trim();
    if(!body) continue;
    n++;
    const parts = []; let buf = "";
    if(body.length <= MAX_CHARS) parts.push(body);
    else {
      for(const p of body.split(/\n\s*\n/)){
        if(buf && buf.length + 2 + p.length > MAX_CHARS){ parts.push(buf); buf = p; }
        else buf = buf ? buf + "\n\n" + p : p;
      }
      if(buf) parts.push(buf);
    }
    parts.forEach((t, i) => chunks.push({
      title: note.title, label: parts.length > 1 ? note.title + " (part " + (i + 1) + " of " + parts.length + ")" : note.title,
      text: t, titleTok: tokens(note.title).map(stem), textTok: tokens(t).map(stem)
    }));
  }
  kNoteCount = n;
  return chunks;
}

function setStatus(){
  if(!CFG.useKnowledge){ kstatus.hidden = true; return; }
  kstatus.hidden = false;
  if(kState === "loading") kstatus.textContent = "📚 Loading notes…";
  else if(kState === "missing") kstatus.textContent = "📚 I can’t find " + CFG.knowledgeFile + ". Put it in the same folder as index.html and open the page from your website (not by double-clicking the file).";
  else if(kState === "empty") kstatus.textContent = "📚 " + CFG.knowledgeFile + " has no notes. Each note must start with a line like: ## Note title";
  else {
    let how = "keyword search";
    if(CFG.searchMethod === "meaning"){
      if(kEmbedding) how = "preparing meaning search…";
      else if(wantMeaning()) how = "meaning search";
      else if(kFallback) how = "keyword search (meaning search failed: " + kFallback.slice(0, 80) + ")";
      else if(!canEmbed()) how = "keyword search (add a Google API key for meaning search)";
    }
    kstatus.textContent = "📚 " + kNoteCount + " notes loaded · " + how;
  }
}

async function loadKnowledge(){
  kState = "loading"; setStatus();
  try {
    const res = await fetch(CFG.knowledgeFile, {cache: "no-store"});
    if(!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    kFinger = hash(text); kChunks = parseKnowledge(text);
    kState = kChunks.length ? "ready" : "empty"; kLoaded = true;
  } catch(e) { kChunks = []; kState = "missing"; }
  setStatus();
}

async function embed(texts){ // Google embeddings, at most 50 per request
  const out = [];
  for(let i = 0; i < texts.length; i += 50){
    const batch = texts.slice(i, i + 50), ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 30000);
    let res;
    try {
      res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + CFG.embeddingModel + ":batchEmbedContents", {
        method: "POST", signal: ctrl.signal,
        headers: {"content-type": "application/json", "x-goog-api-key": apiKey},
        body: JSON.stringify({requests: batch.map(t => ({model: "models/" + CFG.embeddingModel, content: {parts: [{text: t}]}}))})
      });
    } catch(e) { throw new Error(e.name === "AbortError" ? "Google took too long" : e.message); }
    finally { clearTimeout(timer); }
    let data = {}; try { data = await res.json(); } catch(e) {}
    if(!res.ok) throw new Error((data.error && data.error.message) || "HTTP " + res.status);
    const embs = data.embeddings || [];
    if(embs.length !== batch.length) throw new Error("unexpected answer from Google");
    embs.forEach(e => out.push(e.values));
  }
  return out;
}

async function prepareEmbeddings(){
  const run = ++kRun;
  kVectors = null; kFallback = ""; kEmbedding = false;
  if(CFG.searchMethod !== "meaning" || !canEmbed() || !kChunks.length){ setStatus(); return; }
  const label = CFG.embeddingModel + "|" + kFinger;
  try { // reuse saved vectors if knowledge.md has not changed
    const o = JSON.parse(localStorage.getItem("bookworm_vectors") || "null");
    if(o && o.label === label && o.vecs && o.vecs.length === kChunks.length){ kVectors = o.vecs; setStatus(); return; }
  } catch(e) {}
  kEmbedding = true; setStatus();
  try {
    const vecs = await embed(kChunks.map(c => "title: " + c.title + " | text: " + c.text));
    if(run !== kRun) return;
    kVectors = vecs;
    try { localStorage.setItem("bookworm_vectors", JSON.stringify({label, vecs: vecs.map(v => v.map(x => Math.round(x * 1e6) / 1e6))})); } catch(e) {}
  } catch(e) { if(run !== kRun) return; kFallback = e.message || "unknown error"; }
  kEmbedding = false; setStatus();
}

function startKnowledge(reload){
  if(!CFG.useKnowledge){ setStatus(); return; }
  kInit = (async () => { if(reload || !kLoaded) await loadKnowledge(); await prepareEmbeddings(); })();
}

const cosine = (a, b) => { let d = 0, x = 0, y = 0; for(let i = 0; i < a.length; i++){ d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / (Math.sqrt(x * y) || 1); };

function keywordSearch(q){
  const terms = [...new Set(tokens(q).filter(w => w.length > 2 && !STOP.has(w)).map(stem))];
  if(!terms.length) return [];
  return kChunks.map(c => {
    let s = 0;
    for(const t of terms){ if(c.titleTok.some(w => w.startsWith(t))) s += 2; if(c.textTok.some(w => w.startsWith(t))) s += 1; }
    return {c, score: s / (3 * terms.length)};
  }).filter(h => h.score > 0).sort((a, b) => b.score - a.score);
}

async function retrieve(q){ // returns the best notes, or null if notes are not in use
  if(!CFG.useKnowledge) return null;
  try { await kInit; } catch(e) {}
  if(!kChunks.length) return null;
  const k = Math.max(1, parseInt(CFG.topK) || 3);
  if(wantMeaning()){
    try {
      const [qv] = await embed(["task: search result | query: " + q]);
      return kChunks.map((c, i) => ({c, score: cosine(qv, kVectors[i])})).sort((a, b) => b.score - a.score).slice(0, k);
    } catch(e) { kFallback = e.message || "unknown error"; setStatus(); }
  }
  return keywordSearch(q).slice(0, k);
}

function withNotes(q, hits){
  const body = hits.length ? hits.map((h, i) => "[" + (i + 1) + "] " + h.c.label + "\n" + h.c.text).join("\n\n") : "(no matching notes found)";
  return "NOTES:\n" + body + "\n\nQUESTION: " + q;
}

// ---------- Chat window ----------
function add(text, who){
  const d = document.createElement("div");
  d.className = "msg " + who; d.textContent = text;
  chat.appendChild(d); chat.scrollTop = chat.scrollHeight; return d;
}
function addCopy(bubble, text){
  const b = document.createElement("button");
  b.type = "button"; b.textContent = "📋 Copy";
  b.style.cssText = "align-self:flex-start;margin-top:-6px;background:transparent;border:1px solid #8a8580;color:inherit;border-radius:999px;padding:3px 10px;font-size:.78rem;cursor:pointer;font-family:system-ui,sans-serif";
  b.onclick = async () => {
    try { await navigator.clipboard.writeText(text); }
    catch(e) {
      const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); } catch(e2) {} t.remove();
    }
    b.textContent = "✓ Copied"; setTimeout(() => b.textContent = "📋 Copy", 1500);
  };
  bubble.after(b); chat.scrollTop = chat.scrollHeight; return b;
}
function addSources(after, hits){ // small "Sources" section that opens and closes
  const d = document.createElement("details");
  d.style.cssText = "align-self:flex-start;max-width:82%;margin-top:-4px;font-family:system-ui,sans-serif;font-size:.8rem";
  const s = document.createElement("summary");
  s.textContent = "Sources"; s.style.cursor = "pointer"; d.appendChild(s);
  if(!hits.length){ const p = document.createElement("div"); p.textContent = "No matching notes found."; p.style.padding = "4px 0"; d.appendChild(p); }
  hits.forEach((h, i) => {
    const p = document.createElement("div"); p.style.cssText = "padding:4px 0";
    const t = document.createElement("strong"); t.textContent = "[" + (i + 1) + "] " + h.c.label;
    const sc = document.createElement("span"); sc.textContent = " · score " + h.score.toFixed(2);
    const x = document.createElement("div");
    const flat = h.c.text.replace(/\s+/g, " "); x.textContent = flat.slice(0, 160) + (flat.length > 160 ? "…" : "");
    x.style.opacity = ".8"; p.append(t, sc, x); d.appendChild(p);
  });
  after.after(d); chat.scrollTop = chat.scrollHeight;
}

// ---------- Talking to the AI ----------
async function viaAnthropic(messages, system){
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {"content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true"},
    body: JSON.stringify({model: CFG.model, max_tokens: 1000, system, messages})
  });
  const data = await res.json();
  if(!res.ok){ const err = new Error(res.status === 401 ? "Your API key wasn’t accepted. Click 🔑 API Key to update it." : (data.error && data.error.message) || "Request failed."); err.keyError = true; throw err; }
  return data.content.map(c => c.text || "").join("");
}
async function viaGoogle(messages, system){
  let lastErr = null;
  for(const model of GOOGLE_MODELS){
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
        method: "POST", signal: ctrl.signal,
        headers: {"content-type": "application/json", "x-goog-api-key": apiKey},
        body: JSON.stringify({
          systemInstruction: {parts: [{text: system}]},
          contents: messages.map(m => ({role: m.role === "assistant" ? "model" : "user", parts: [{text: m.content}]})),
          generationConfig: {maxOutputTokens: 2000}
        })
      });
      clearTimeout(timer);
      let data = {}; try { data = await res.json(); } catch(e) {}
      const msg = (data.error && data.error.message) || "";
      if(res.status === 401 || res.status === 403 || (res.status === 400 && /API key/i.test(msg))){
        const err = new Error("Your Google API key wasn’t accepted. Click 🔑 API Key to update it."); err.keyError = true; throw err;
      }
      if(res.status === 429){
        const err = new Error("Google says you’ve reached the free limit for now. Wait a minute and try again."); err.keyError = true; throw err;
      }
      if(!res.ok){ lastErr = new Error(msg || "Google returned an error"); continue; }
      const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
      const text = parts.map(p => p.text || "").join("");
      if(!text){ lastErr = new Error("Google sent back an empty answer"); continue; }
      return text;
    } catch(e) {
      clearTimeout(timer);
      if(e.keyError) throw e;
      lastErr = e.name === "AbortError" ? new Error("Google took too long to answer") : e;
    }
  }
  const err = new Error(((lastErr && lastErr.message) || "Google didn’t answer") + ". Please try again in a moment.");
  err.keyError = true; throw err;
}
const viaKey = (m, s) => provider === "google" ? viaGoogle(m, s) : viaAnthropic(m, s);

function start(){
  history = []; chat.innerHTML = ""; add(CFG.welcomeMessage, "bot"); chips.style.display = "flex";
}
chips.innerHTML = "";
CFG.starterQuestions.forEach(q => {
  const b = document.createElement("button");
  b.className = "chip"; b.type = "button"; b.textContent = q;
  b.onclick = () => send(q); chips.appendChild(b);
});
start();
startKnowledge(true);
(async () => { try { sample = await claude.use("sample"); } catch(e) { sample = null; } })();

async function send(text){
  text = text.trim();
  if(!text || busy) return;
  chips.style.display = "none";
  add(text, "me"); input.value = "";
  history.push({role: "user", content: text});   // history keeps the plain question only
  busy = true; go.disabled = true;
  const bubble = add("Thinking… 📖", "bot");
  try {
    const hits = await retrieve(text);
    const system = RULES + (hits ? "\n\n" + CFG.knowledgeRules : "");
    const messages = history.map((m, i) => i === history.length - 1 && hits ? {role: m.role, content: withNotes(text, hits)} : m);
    let reply = null, netErr = null;
    if(apiKey){
      try { reply = await viaKey(messages, system); bubble.textContent = reply; }
      catch(e) {
        if(e.keyError) throw e;
        netErr = new Error("I couldn’t reach " + (provider === "google" ? "Google" : "Anthropic") + " (" + e.message + "). Check your internet connection or ad blocker, then try again.");
        netErr.keyError = true;
      }
    }
    if(reply === null){
      if(!sample){ try { sample = await claude.use("sample"); } catch(e2) { sample = null; } }
      if(!sample) throw (netErr || {code: "unavailable"});
      const turns = messages.map((m, i) => i === 0 ? {role: m.role, content: system + "\n\nUser says: " + m.content} : m);
      const r = await sample(turns, {cache: false, onText: ({text}) => { bubble.textContent = text; chat.scrollTop = chat.scrollHeight; }});
      reply = r.text; bubble.textContent = reply;
    }
    const copyBtn = addCopy(bubble, reply);
    if(hits) addSources(copyBtn, hits);
    history.push({role: "assistant", content: reply});
  } catch(e) {
    history.pop();
    bubble.textContent = (e && e.keyError) ? e.message : (e && e.code === "not_granted")
      ? "I need your permission to chat. Please allow it and try again! 📚"
      : "Oops, I couldn’t reach my bookshelf. Please try again in a moment.";
  }
  busy = false; go.disabled = false; input.focus();
}
$("restart").onclick = () => { busy = false; go.disabled = false; input.value = ""; start(); };
f.addEventListener("submit", e => { e.preventDefault(); send(input.value); });
