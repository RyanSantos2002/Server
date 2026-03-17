import cors from "cors";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import os from "os";
import fs from "fs";

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ===== MEMÓRIA E PERSISTÊNCIA =====
let maquinas = {};       // id -> { id, nome }
let online = {};         // machineId -> socket.id
let filaAlertas = {};    // machineId -> [mensagens]
let agendamentos = [];   // Array of { id, mensagem, dataHora }
let blockedUsers = [];   // Array of names/IDs
let lastMessageTime = {};// socket.id -> timestamp
let grupos = {};         // idGrupo -> { id, nome, criador, membros }
let historico = {};      // idConversa -> [mensagens]

const ADMINS = ["ryan.nunes"]; 
const FLOOD_COOLDOWN = 1000;
const MAX_MSG_LENGTH = 500;

const FILE_AGENDAMENTOS = 'scheduled-alerts.json';
const FILE_BLOCKED = 'blocked-users.json';
const FILE_GRUPOS = 'grupos.json';
const FILE_HISTORICO = 'historico.json';

// LOAD DATA
if (fs.existsSync(FILE_AGENDAMENTOS)) { try { agendamentos = JSON.parse(fs.readFileSync(FILE_AGENDAMENTOS)); } catch (e) {} }
if (fs.existsSync(FILE_BLOCKED)) { try { blockedUsers = JSON.parse(fs.readFileSync(FILE_BLOCKED)); } catch (e) {} }
if (fs.existsSync(FILE_GRUPOS)) { try { grupos = JSON.parse(fs.readFileSync(FILE_GRUPOS)); } catch (e) {} }
if (fs.existsSync(FILE_HISTORICO)) { try { historico = JSON.parse(fs.readFileSync(FILE_HISTORICO)); } catch (e) {} }

function saveBlocked() { fs.writeFileSync(FILE_BLOCKED, JSON.stringify(blockedUsers, null, 2)); }
function saveGrupos() { fs.writeFileSync(FILE_GRUPOS, JSON.stringify(grupos, null, 2)); }
function saveHistorico() { fs.writeFileSync(FILE_HISTORICO, JSON.stringify(historico, null, 2)); }
function salvarAgendamentos() { fs.writeFileSync(FILE_AGENDAMENTOS, JSON.stringify(agendamentos, null, 2)); }

// TAREFAS AGENDADAS
setInterval(() => {
  const now = new Date();
  const pendentes = [];
  const restantes = [];

  agendamentos.forEach(a => {
    if (new Date(a.dataHora) <= now) pendentes.push(a);
    else restantes.push(a);
  });

  if (pendentes.length > 0) {
    agendamentos = restantes;
    salvarAgendamentos();

    pendentes.forEach(alerta => {
      Object.keys(maquinas).forEach((id) => {
        const payload = {
          de: "Agendado",
          mensagem: alerta.mensagem,
          tipo: "geral",
          timestamp: new Date().toISOString()
        };
        if (online[id]) io.to(online[id]).emit("alert", payload);
        else {
           filaAlertas[id] = filaAlertas[id] || [];
           filaAlertas[id].push(payload);
        }
      });
    });
  }
}, 30000);

// ===== SOCKET =====
io.on("connection", (socket) => {
  console.log("🔌 Conectado:", socket.id);

  // REGISTRAR MÁQUINA
  socket.on("registrar_maquina", ({ id, nome }) => {
    if (!id || !nome) return;

    const cleanId = String(id).trim();
    const cleanNome = String(nome).trim().substring(0, 30);

    maquinas[cleanId] = { id: cleanId, nome: cleanNome };
    online[cleanId] = socket.id;
    socket.machineId = cleanId;
    socket.username = cleanNome;

    const isAdmin = ADMINS.some(admin => admin.toLowerCase() === cleanNome.toLowerCase());
    const isBlocked = blockedUsers.includes(cleanNome);

    socket.emit("registro_sucesso", { isAdmin, isBlocked });
    console.log(`✅ Registrado: ${cleanNome} (Admin: ${isAdmin}, Blocked: ${isBlocked})`);

    Object.keys(grupos).forEach(groupId => {
      if (grupos[groupId].membros.includes(cleanId)) socket.join(groupId);
    });

    if (filaAlertas[cleanId]) {
      filaAlertas[cleanId].forEach((msg) => socket.emit("alert", msg));
      delete filaAlertas[cleanId];
    }

    emitirLista();
  });

  // ENVIAR ALERTA E CHAT
  socket.on("enviar_alerta", ({ destino, mensagem, tipo }) => {
    if (blockedUsers.includes(socket.username)) {
      socket.emit("erro", "Você está bloqueado.");
      return;
    }
    
    const isAdmin = ADMINS.includes(socket.username ? socket.username.toLowerCase() : "");
    if (destino === "todos" && !isAdmin) {
      socket.emit("erro", "Apenas administradores podem enviar alertas gerais.");
      return;
    }

    if (!isAdmin) {
      const now = Date.now();
      if (lastMessageTime[socket.id] && now - lastMessageTime[socket.id] < FLOOD_COOLDOWN) {
        socket.emit("erro", "Aguarde para enviar.");
        return;
      }
      lastMessageTime[socket.id] = now;
    }

    if (!mensagem || typeof mensagem !== "string") return;
    const msgClean = mensagem.trim().substring(0, MAX_MSG_LENGTH);
    if (!msgClean) return;

    if (destino === "todos") {
      Object.keys(maquinas).forEach((id) => {
        const payload = {
            de: socket.machineId ? maquinas[socket.machineId].nome : "Anônimo",
            mensagem: msgClean,
            tipo: "geral",
            timestamp: new Date().toISOString(),
        };
        if (online[id]) io.to(online[id]).emit("alert", payload);
        else {
          filaAlertas[id] = filaAlertas[id] || [];
          filaAlertas[id].push(payload);
        }
      });
      return;
    }
    
    function getChatId(id1, id2) {
      if (!id1 || !id2) return null;
      return [String(id1), String(id2)].sort().join("_");
    }

    if (tipo === "grupo") {
      if (!grupos[destino]) return;
      if (!grupos[destino].membros.includes(socket.machineId)) return; 

      const payload = {
        de: socket.machineId ? maquinas[socket.machineId].nome : "Anônimo",
        deId: socket.machineId,
        destino: destino,
        mensagem: msgClean,
        tipo: "grupo",
        timestamp: new Date().toISOString(),
      };

      historico[destino] = historico[destino] || [];
      historico[destino].push(payload);
      if(historico[destino].length > 200) historico[destino].shift();
      saveHistorico();

      io.to(destino).emit("alert", payload);

      grupos[destino].membros.forEach(membroId => {
        if (!online[membroId]) {
          filaAlertas[membroId] = filaAlertas[membroId] || [];
          filaAlertas[membroId].push(payload);
        }
      });
      return;
    }

    if (maquinas[destino]) {
      const payload = {
        de: socket.machineId ? maquinas[socket.machineId].nome : "Anônimo",
        deId: socket.machineId,
        destino: destino, 
        mensagem: msgClean,
        tipo: "privado",
        timestamp: new Date().toISOString(),
      };

      const chatId = getChatId(socket.machineId, destino);
      historico[chatId] = historico[chatId] || [];
      historico[chatId].push(payload);
      if(historico[chatId].length > 200) historico[chatId].shift();
      saveHistorico();

      if (online[destino]) io.to(online[destino]).emit("alert", payload);
      else {
        filaAlertas[destino] = filaAlertas[destino] || [];
        filaAlertas[destino].push(payload);
      }
    }
  });

  socket.on("get_historico", (destinoId) => {
    if (!socket.machineId || !destinoId) return;
    let chatId = destinoId;
    if (maquinas[destinoId]) chatId = [String(socket.machineId), String(destinoId)].sort().join("_");
    const messages = historico[chatId] || [];
    socket.emit("historico_carregado", { destinoId, messages });
  });

  socket.on("limpar_historico", (destinoId) => {
    if (!socket.machineId || !destinoId) return;
    let chatId = destinoId;
    if (maquinas[destinoId]) chatId = [String(socket.machineId), String(destinoId)].sort().join("_");
    if (historico[chatId]) {
      delete historico[chatId];
      saveHistorico();
      socket.emit("historico_carregado", { destinoId, messages: [] });
    }
  });

  socket.on("criar_grupo", ({ nomeGrupo, membrosIds }) => {
    if (!nomeGrupo || !membrosIds || !Array.isArray(membrosIds) || membrosIds.length === 0) return;
    if (!membrosIds.includes(socket.machineId)) membrosIds.push(socket.machineId);

    const groupId = "group_" + Date.now();
    const cleanNome = String(nomeGrupo).trim().substring(0, 30);

    grupos[groupId] = {
      id: groupId,
      nome: cleanNome,
      criador: socket.machineId,
      membros: membrosIds
    };
    saveGrupos();
    
    membrosIds.forEach(id => {
      if (online[id]) {
        const memberSocket = io.sockets.sockets.get(online[id]);
        if (memberSocket) memberSocket.join(groupId);
      }
    });

    emitirLista();
    socket.emit("aviso", `Grupo "${cleanNome}" criado com sucesso!`);
  });

  socket.on("agendar_alerta", ({ mensagem, dataHora }) => {
    if (!ADMINS.includes(socket.username ? socket.username.toLowerCase() : "")) return;
    if (!mensagem || !dataHora) return;
    
    agendamentos.push({ id: Date.now().toString(), mensagem, dataHora });
    salvarAgendamentos();
    socket.emit("aviso", "Agendamento realizado com sucesso!");
  });

  socket.on("admin_block_user", (targetName) => {
    if (!ADMINS.includes(socket.username ? socket.username.toLowerCase() : "")) return;
    if (!targetName) return;

    if (!blockedUsers.includes(targetName)) {
      blockedUsers.push(targetName);
      saveBlocked();
      socket.emit("aviso", `${targetName} foi bloqueado.`);
    }
    emitirLista();
  });

  socket.on("admin_unblock_user", (targetName) => {
    if (!ADMINS.includes(socket.username ? socket.username.toLowerCase() : "")) return;
    blockedUsers = blockedUsers.filter(u => u !== targetName);
    saveBlocked();
    socket.emit("aviso", `${targetName} foi desbloqueado.`);
    emitirLista();
  });

  socket.on("disconnect", () => {
    let disconnectedId = null;
    for (const id in online) {
      if (online[id] === socket.id) {
        delete online[id];
        disconnectedId = id;
        break;
      }
    }
    delete lastMessageTime[socket.id];
    if (disconnectedId) emitirLista();
  });

  // ===== VIDEO CALL SIGNALING =====
  socket.on("video_call_request", ({ to, fromName }) => {
    if (online[to]) {
      io.to(online[to]).emit("video_call_request", { from: socket.machineId, fromName });
    }
  });

  socket.on("video_call_response", ({ to, accepted }) => {
    if (online[to]) {
      io.to(online[to]).emit("video_call_response", { from: socket.machineId, accepted });
    }
  });

  socket.on("video_call_signal", ({ to, signal }) => {
    if (online[to]) {
      io.to(online[to]).emit("video_call_signal", { from: socket.machineId, signal });
    }
  });

  socket.on("video_call_hangup", ({ to }) => {
    if (online[to]) {
      io.to(online[to]).emit("video_call_hangup", { from: socket.machineId });
    }
  });
});

function emitirLista() {
  io.emit("lista_maquinas", {
    todas: Object.values(maquinas),
    online: Object.keys(online),
    blocked: blockedUsers,
    grupos: Object.values(grupos)
  });
}

const URL_DO_SEU_SERVIDOR = "https://server-alert.onrender.com";

setInterval(() => {
  if (URL_DO_SEU_SERVIDOR && !URL_DO_SEU_SERVIDOR.includes("localhost")) {
    fetch(URL_DO_SEU_SERVIDOR)
      .then((res) => console.log(`Ping: ${res.status}`))
      .catch(() => {});
  }
}, 600000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
