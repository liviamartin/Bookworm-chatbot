// Bookworm chatbot logic: starter buttons, chat, Restart, and API Key button

const WELCOME = "Hi! I’m Bookworm and I am here to help start your reading experience. What are you looking for?";
const STARTERS = ["What genres are popular right now?","Should I read a series or single book?","What are some up and coming books?"];
const RULES = "You are Bookworm 📚, a friendly, welcoming, and warm chatbot. Your one job is to help people find a book to read based on their interests. Keep replies short (under 120 words), suggest 1-3 real books with a one-line reason each, and ask a gentle follow-up question. Never pitch or recommend a book based on its price. Stay on the topic of finding books. You may not know the very newest releases, so be honest about that and suggest checking a library or bookstore for the latest titles.";

const chat = document.getElementById("chat"), chips = document.getElementById("chips"),
      f = document.getElementById("f"), input = document.getElementById("in"), go = document.getElementById("go");
let history = [], sample = null, busy = false, apiKey = "";
const MODEL = "claude-sonnet-5-5";
const keybar = document.getElementById("keybar"), keyin = document.getElementById("keyin"), keynote = document.getElementById("keynote");
try { apiKey = localStorage.getItem("bookworm_key") || ""; } catch(e) {}
function showNote(){ keynote.hidden = !apiKey; keynote.textContent = apiKey ? "🔑 Using your API key (saved only in this browser)." : ""; }
showNote();
document.getElementById("keybtn").onclick = () => { keybar.hidden = !keybar.hidden; if(!keybar.hidden) keyin.focus(); };
document.getElementById("keysave").onclick = () => {
  apiKey = keyin.value.trim(); keyin.value = ""; keybar.hidden = true;
  try { localStorage.setItem("bookworm_key", apiKey); } catch(e) {}
  showNote();
};
document.getElementById("keyclear").onclick = () => {
  apiKey = ""; keyin.value = ""; keybar.hidden = true;
  try { localStorage.removeItem("bookworm_key"); } catch(e) {}
  showNote();
};
async function viaKey(){
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST",
    headers:{"content-type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
    body: JSON.stringify({model:MODEL, max_tokens:1000, system:RULES, messages:history})
  });
  const data = await res.json();
  if(!res.ok){ const err = new Error(res.status === 401 ? "Your API key wasn’t accepted. Click 🔑 API Key to update it." : (data.error && data.error.message) || "Request failed."); err.keyError = true; throw err; }
  return data.content.map(c => c.text || "").join("");
}

function add(text, who){
  const d = document.createElement("div");
  d.className = "msg " + who; d.textContent = text;
  chat.appendChild(d); chat.scrollTop = chat.scrollHeight; return d;
}
function start(){
  history = []; chat.innerHTML = ""; add(WELCOME, "bot"); chips.style.display = "flex";
}
STARTERS.forEach(q => {
  const b = document.createElement("button");
  b.className = "chip"; b.type = "button"; b.textContent = q;
  b.onclick = () => send(q); chips.appendChild(b);
});
start();
(async () => { try { sample = await claude.use("sample"); } catch(e) { sample = null; } })();

async function send(text){
  text = text.trim();
  if(!text || busy) return;
  chips.style.display = "none";
  add(text, "me"); input.value = "";
  history.push({role:"user", content:text});
  busy = true; go.disabled = true;
  const bubble = add("Thinking… 📖", "bot");
  try{
    let reply = null;
    if(apiKey){
      try { reply = await viaKey(); bubble.textContent = reply; }
      catch(e){ if(e.keyError) throw e; }   // network blocked (e.g. on the claude.ai link): fall back below
    }
    if(reply === null){
      if(!sample) sample = await claude.use("sample");
      if(!sample) throw {code:"unavailable"};
      const turns = history.map((m,i) => i===0 ? {role:m.role, content: RULES + "\n\nUser says: " + m.content} : m);
      const r = await sample(turns, {cache:false, onText:({text}) => { bubble.textContent = text; chat.scrollTop = chat.scrollHeight; }});
      reply = r.text; bubble.textContent = reply;
    }
    history.push({role:"assistant", content:reply});
  }catch(e){
    history.pop();
    bubble.textContent = (e && e.keyError) ? e.message : (e && e.code === "not_granted")
      ? "I need your permission to chat. Please allow it and try again! 📚"
      : "Oops, I couldn’t reach my bookshelf. Please try again in a moment.";
  }
  busy = false; go.disabled = false; input.focus();
}
document.getElementById("restart").onclick = () => { busy = false; go.disabled = false; input.value = ""; start(); };
f.addEventListener("submit", e => { e.preventDefault(); send(input.value); });
