import cors from "cors";
import express from "express";
import http from "http";
import { Server } from "socket.io";

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

// ===== MEMÓRIA =====
let maquinas = {};       // TODAS as máquinas cadastradas
let online = {};         // machineId -> socket.id
let filaAlertas = {};    // machineId -> [mensagens]

// ===== SOCKET =====
io.on("connection", (socket) => {
  console.log("🔌 Conectado:", socket.id);

  // REGISTRAR MÁQUINA
  socket.on("registrar_maquina", ({ id, nome }) => {
    maquinas[id] = { id, nome };
    online[id] = socket.id;

    console.log(`✅ Máquina registrada: ${id} (${nome})`);

    // Enviar alertas pendentes
    if (filaAlertas[id]) {
      filaAlertas[id].forEach(msg => {
        socket.emit("alert", msg);
      });
      delete filaAlertas[id];
    }

    io.emit("lista_maquinas", {
      todas: Object.values(maquinas),
      online: Object.keys(online)
    });
  });

  // ENVIAR ALERTA
  socket.on("enviar_alerta", ({ destino, mensagem }) => {
    if (destino === "todos") {
      Object.keys(maquinas).forEach(id => {
        if (online[id]) {
          io.to(online[id]).emit("alert", mensagem);
        } else {
          filaAlertas[id] ??= [];
          filaAlertas[id].push(mensagem);
        }
      });
      return;
    }

    // Individual
    if (online[destino]) {
      io.to(online[destino]).emit("alert", mensagem);
    } else {
      filaAlertas[destino] ??= [];
      filaAlertas[destino].push(mensagem);
    }
  });

  // DESCONECTAR
  socket.on("disconnect", () => {
    for (const id in online) {
      if (online[id] === socket.id) {
        delete online[id];
        console.log(`❌ Máquina offline: ${id}`);
      }
    }

    io.emit("lista_maquinas", {
      todas: Object.values(maquinas),
      online: Object.keys(online)
    });
  });
});

// Código para manter o servidor acordado no Render
const URL_DO_SEU_SERVIDOR = "https://server-alert.onrender.com";

setInterval(() => {
  console.log("Mantendo o servidor acordado...");
  fetch(URL_DO_SEU_SERVIDOR)
    .then(() => console.log("Ping realizado com sucesso!"))
    .catch((err) => console.error("Erro no ping:", err));
}, 600000); // 600000ms = 10 minutos

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
