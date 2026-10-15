const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const ADMIN_NAME = "vontryx";
const ADMIN_PASS = "151983";
const USER_PASS = "2007";
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

const clients = new Map(); // ws -> { id, name, voice, admin, muted, camOff }
let nextId = 1;

const send = (ws, obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));
function broadcast(obj) {
  const s = JSON.stringify(obj);
  for (const ws of clients.keys()) if (ws.readyState === 1) ws.send(s);
}
const pushUsers = () =>
  broadcast({
    t: "users",
    users: [...clients.values()].map((u) => ({
      id: u.id, name: u.name, voice: u.voice, admin: u.admin, muted: u.muted, camOff: u.camOff,
    })),
  });
const sys = (text) => broadcast({ t: "sys", text });
function findById(id) {
  for (const [ws, u] of clients) if (u.id === String(id)) return { ws, u };
  return null;
}

wss.on("connection", (ws) => {
  let me = null;

  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    // il primo messaggio deve essere "join"
    if (!me) {
      if (m.t !== "join") return;
      const base = String(m.name || "").trim().slice(0, 24);
      const pass = String(m.pass || "");
      let admin = false;
      if (base === ADMIN_NAME) {
        if (pass !== ADMIN_PASS) return send(ws, { t: "denied" });
        admin = true;
      } else if (pass !== USER_PASS) {
        return send(ws, { t: "denied" });
      }
      const nameBase = base || "Ospite";
      const taken = new Set([...clients.values()].map((u) => u.name));
      let name = nameBase, i = 2;
      while (taken.has(name)) name = nameBase + " " + i++;
      me = { id: String(nextId++), name, voice: false, admin, muted: false, camOff: false };
      clients.set(ws, me);
      send(ws, { t: "welcome", id: me.id, name, admin, channels: CHANNELS, history });
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

    } else if (m.t === "del") {
      // admin: qualsiasi messaggio; altri: solo il proprio
      if (!CHANNELS.includes(m.ch)) return;
      const list = history[m.ch];
      const idx = list.findIndex((x) => x.ts === m.ts && x.uid === String(m.uid));
      if (idx === -1) return;
      if (!me.admin && list[idx].uid !== me.id) return;
      const [old] = list.splice(idx, 1);
      save();
      broadcast({ t: "del", ch: m.ch, ts: old.ts, uid: old.uid });

    } else if (m.t === "kick") {
      if (!me.admin) return;
      const target = findById(m.id);
      if (!target || target.u === me) return;
      sys(`🚪 ${me.name} ha kickato ${target.u.name}`);
      send(target.ws, { t: "kicked", by: me.name });
      clients.delete(target.ws);
      target.ws.close();
      pushUsers();

    } else if (m.t === "mute") {
      if (!me.admin) return;
      const target = findById(m.id);
      if (!target) return;
      target.u.muted = !!m.on;
      send(target.ws, { t: "mute", on: target.u.muted });
      sys(`${target.u.muted ? "🔇" : "🔊"} ${me.name} ha ${target.u.muted ? "mutato" : "smutato"} ${target.u.name}`);
      pushUsers();

    } else if (m.t === "cam") {
      if (!me.admin) return;
      const target = findById(m.id);
      if (!target) return;
      target.u.camOff = !m.on;
      send(target.ws, { t: "cam", on: !target.u.camOff });
      sys(`${target.u.camOff ? "📵" : "📹"} ${me.name} ha ${target.u.camOff ? "tolto la camera a" : "ridato la camera a"} ${target.u.name}`);
      pushUsers();

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
