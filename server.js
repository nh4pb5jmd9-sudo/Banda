const express = require("express");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");
const http = require("http");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 10000;
const CHANNELS = ["generale", "giochi", "musica"];
const FILE = path.join(__dirname, "messages.json");
const KEEP = 200;

// ====== CREDENZIALI ======
const ADMIN_NAME = "vontryx";      // ← TUO NOME
const ADMIN_PASS = "151983";       // ← TUA PASSWORD
const USER_PASS = "2007";          // ← PASSWORD PER TUTTI

let clients = new Map();

app.use(express.static("public"));

function loadMessages() {
  if (!fs.existsSync(FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveMessages(msgs) {
  CHANNELS.forEach(ch => {
    if (!msgs[ch]) msgs[ch] = [];
    msgs[ch] = msgs[ch].slice(-KEEP);
  });
  fs.writeFileSync(FILE, JSON.stringify(msgs, null, 2));
}

let messages = loadMessages();

wss.on("connection", (ws) => {
  let client = { id: null, name: null, admin: false, voice: false, ws };

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);
      handle(msg, client, ws);
    } catch (e) {
      console.error("Errore parse:", e);
    }
  });

  ws.on("close", () => {
    if (client.id) {
      clients.delete(client.id);
      broadcast({ type: "userLeft", id: client.id, name: client.name });
    }
  });
});

function handle(msg, client, ws) {
  switch (msg.type) {
    case "join":
      handleJoin(msg, client, ws);
      break;
    case "msg":
      if (client.id) handleMsg(msg, client);
      break;
    case "deleteMsg":
      if (client.id) handleDeleteMsg(msg, client);
      break;
    case "kick":
      if (client.admin) handleKick(msg, client);
      break;
    case "mute":
      if (client.admin) handleMute(msg, client);
      break;
    case "unmute":
      if (client.admin) handleUnmute(msg, client);
      break;
    case "toggleCam":
      if (client.admin) handleToggleCam(msg, client);
      break;
    case "voice-join":
      client.voice = true;
      broadcastVoicePeers(client);
      break;
    case "voice-leave":
      client.voice = false;
      break;
    case "signal":
      forwardSignal(msg, client);
      break;
  }
}

function handleJoin(msg, client, ws) {
  const { name, password, channel } = msg;

  // VERIFICA CREDENZIALI
  if (name === ADMIN_NAME && password === ADMIN_PASS) {
    client.admin = true;
    console.log(`🔐 ADMIN ${name} connesso`);
  } else if (password === USER_PASS) {
    client.admin = false;
  } else {
    // CREDENZIALI SBAGLIATE → DISCONNETTI
    ws.send(JSON.stringify({ type: "denied", reason: "Credenziale errate" }));
    ws.close();
    return;
  }

  client.id = Math.random().toString(36).substr(2, 9);
  client.name = name;
  client.channel = channel || "generale";
  clients.set(client.id, client);

  // BENVENUTO
  ws.send(JSON.stringify({
    type: "welcome",
    id: client.id,
    admin: client.admin,
    channels: CHANNELS,
    messages: messages[client.channel] || [],
    users: Array.from(clients.values()).map(c => ({
      id: c.id,
      name: c.name,
      admin: c.admin,
      voice: c.voice
    }))
  }));

  // BROADCAST NUOVO UTENTE
  broadcast({
    type: "userJoined",
    id: client.id,
    name: name,
    admin: client.admin
  });

  console.log(`✅ ${name}${client.admin ? " [ADMIN]" : ""} entrato`);
}

function handleMsg(msg, client) {
  const { text, channel } = msg;
  if (!text || !channel) return;

  const msgObj = {
    id: Math.random().toString(36).substr(2, 9),
    from: client.id,
    name: client.name,
    text,
    time: new Date().toISOString(),
    admin: client.admin
  };

  if (!messages[channel]) messages[channel] = [];
  messages[channel].push(msgObj);
  saveMessages(messages);

  broadcastToChannel(channel, {
    type: "msg",
    ...msgObj
  });
}

function handleDeleteMsg(msg, client) {
  const { msgId, channel } = msg;

  if (!messages[channel]) return;

  const idx = messages[channel].findIndex(m => m.id === msgId);
  if (idx === -1) return;

  const m = messages[channel][idx];

  // ADMIN CANCELLA TUTTO, ALTRI SOLO PROPRIO
  if (!client.admin && m.from !== client.id) return;

  messages[channel].splice(idx, 1);
  saveMessages(messages);

  broadcastToChannel(channel, {
    type: "msgDeleted",
    msgId,
    channel
  });
}

function handleKick(msg, client) {
  const { targetId } = msg;
  const target = clients.get(targetId);
  if (!target) return;

  // MESSAGGIO IN CHAT
  broadcastToChannel(target.channel, {
    type: "sysMsg",
    text: `🚪 ${client.name} ha kickato ${target.name}`,
    time: new Date().toISOString()
  });

  // DISCONNETTI L'UTENTE
  target.ws.send(JSON.stringify({ type: "kicked" }));
  target.ws.close();
  clients.delete(targetId);

  broadcast({
    type: "userLeft",
    id: targetId,
    name: target.name
  });

  console.log(`⛔ ${client.name} ha kickato ${target.name}`);
}

function handleMute(msg, client) {
  const { targetId } = msg;
  const target = clients.get(targetId);
  if (target) {
    target.ws.send(JSON.stringify({ type: "muted" }));
    broadcastToChannel(target.channel, {
      type: "sysMsg",
      text: `🔇 ${client.name} ha mutato ${target.name}`,
      time: new Date().toISOString()
    });
  }
}

function handleUnmute(msg, client) {
  const { targetId } = msg;
  const target = clients.get(targetId);
  if (target) {
    target.ws.send(JSON.stringify({ type: "unmuted" }));
    broadcastToChannel(target.channel, {
      type: "sysMsg",
      text: `🔊 ${client.name} ha smutato ${target.name}`,
      time: new Date().toISOString()
    });
  }
}

function handleToggleCam(msg, client) {
  const { targetId } = msg;
  const target = clients.get(targetId);
  if (target) {
    target.ws.send(JSON.stringify({ type: "camDisabled" }));
    broadcastToChannel(target.channel, {
      type: "sysMsg",
      text: `📵 ${client.name} ha tolto la camera a ${target.name}`,
      time: new Date().toISOString()
    });
  }
}

function broadcastToChannel(channel, data) {
  const msg = JSON.stringify(data);
  clients.forEach(c => {
    if (c.channel === channel && c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(msg);
    }
  });
}

function broadcast(data) {
  const msg = JSON.stringify(data);
  clients.forEach(c => {
    if (c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(msg);
    }
  });
}

function broadcastVoicePeers(joiner) {
  const voiceUsers = Array.from(clients.values()).filter(c => c.voice && c.id !== joiner.id);
  
  joiner.ws.send(JSON.stringify({
    type: "voice-peers",
    peers: voiceUsers.map(u => ({ id: u.id, name: u.name }))
  }));

  voiceUsers.forEach(existing => {
    if (existing.ws.readyState === WebSocket.OPEN) {
      existing.ws.send(JSON.stringify({
        type: "newVoicePeer",
        id: joiner.id,
        name: joiner.name
      }));
    }
  });
}

function forwardSignal(msg, client) {
  const target = clients.get(msg.to);
  if (target && target.voice && target.ws.readyState === WebSocket.OPEN) {
    target.ws.send(JSON.stringify({
      type: "signal",
      from: client.id,
      data: msg.data
    }));
  }
}

server.listen(PORT, () => {
  console.log(`🚀 NEXUS Server running on port ${PORT}`);
  console.log(`👑 Admin: ${ADMIN_NAME} / ${ADMIN_PASS}`);
  console.log(`👤 User: anyone / ${USER_PASS}`);
});
