const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const ROOM_PASSWORD = process.env.ROOM_PASSWORD || ""; // opzionale
const CHANNELS = ["generale", "giochi", "musica"];
const FILE = path.join(__dirname, "messages.json");
const KEEP = 200; // messaggi conservati per canale

// ---- cronologia messaggi (salvata su file) ----
const history = {};
CHANNELS.forEach((c) => (history[c] = []));
try {
  const saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
  CHANNELS.forEach((c) => {
    if (Array.isArray(saved[c])) history[c] = saved[c].slice(-KEEP);
  });
} catch {}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(FILE, JSON.stringify(history), () => {}), 1000);
}

// ---- server http + websocket ----
const app = express();
app.use(express.static(path.join(__dirname, "public")));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

const clients = new Map(); // ws -> { id, name, voice }
let nextId = 1;

const send = (ws, obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));
function broadcast(obj) {
  const s = JSON.stringify(obj);
  for (const ws of clients.keys()) if (ws.readyState === 1) ws.send(s);
}
const pushUsers = () =>
  broadcast({ t: "users", users: [...clients.values()].map((u) => ({ id: u.id, name: u.name, voice: u.voice })) });

wss.on("connection", (ws) => {
  let me = null;

  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    // il primo messaggio deve essere "join"
    if (!me) {
      if (m.t !== "join") return;
      if (ROOM_PASSWORD && m.pass !== ROOM_PASSWORD) return send(ws, { t: "denied" });
      const base = String(m.name || "").trim().slice(0, 24) || "Ospite";
      const taken = new Set([...clients.values()].map((u) => u.name));
      let name = base, i = 2;
      while (taken.has(name)) name = base + " " + i++;
      me = { id: String(nextId++), name, voice: false };
      clients.set(ws, me);
      send(ws, { t: "welcome", id: me.id, name, channels: CHANNELS, history });
      return pushUsers();
    }

    if (m.t === "msg") {
      const text = String(m.text || "").trim().slice(0, 1000);
      if (!text || !CHANNELS.includes(m.ch)) return;
      const entry = { uid: me.id, user: me.name, text, ts: Date.now() };
      history[m.ch].push(entry);
      if (history[m.ch].length > KEEP) history[m.ch].shift();
      save();
      broadcast({ t: "msg", ch: m.ch, m: entry });
    } else if (m.t === "voice-join") {
      me.voice = true;
      const peers = [...clients.values()].filter((u) => u.voice && u !== me).map((u) => u.id);
      send(ws, { t: "voice-peers", peers });
      pushUsers();
    } else if (m.t === "voice-leave") {
      me.voice = false;
      pushUsers();
    } else if (m.t === "signal") {
      for (const [otherWs, u] of clients) {
        if (u.id === String(m.to) && u.voice) send(otherWs, { t: "signal", from: me.id, data: m.data });
      }
    }
  });

  ws.on("close", () => {
    if (me) {
      clients.delete(ws);
      pushUsers();
    }
  });
});

server.listen(PORT, () => console.log("Server avviato sulla porta " + PORT));
