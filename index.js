/* ARQUIVO: server.js (BACKEND ATUALIZADO PARA ES MODULES) */
import cors from "cors";
import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// Configuração do Socket.IO permitindo conexão de qualquer lugar
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// MEMÓRIA DO SERVIDOR: Mapeia socket.id -> Nome do Usuário
let usuarios = {}; 

io.on("connection", (socket) => {
  console.log(`🔌 Conectado: ${socket.id}`);

  // 1. REGISTRAR USUÁRIO
  socket.on("registrar_usuario", (nome) => {
    // Salva o novo usuário
    usuarios[socket.id] = nome;
    console.log(`✅ Registrado: ${nome} (ID: ${socket.id})`);

    // MANDA A LISTA ATUALIZADA PARA TODOS
    const listaNomes = [...new Set(Object.values(usuarios))]; 
    io.emit("lista_usuarios", listaNomes);
  });

  // 2. MENSAGEM GERAL
  socket.on("alert", (data) => {
    io.emit("alert", data);
  });

  // 3. MENSAGEM PRIVADA
  socket.on("mensagem_privada", ({ de, para, mensagem }) => {
    // Procura o socket ID do destinatário pelo nome
    const socketDestino = Object.keys(usuarios).find(key => usuarios[key] === para);

    if (socketDestino) {
      io.to(socketDestino).emit("alert", {
        de,
        mensagem,
        tipo: "privado"
      });
    }
  });

  // 4. DESCONEXÃO
  socket.on("disconnect", () => {
    const nomeSaiu = usuarios[socket.id];
    if (nomeSaiu) {
      console.log(`❌ Saiu: ${nomeSaiu}`);
      delete usuarios[socket.id]; // Remove da memória
      
      // Avisa todo mundo que a lista mudou
      const listaNomes = [...new Set(Object.values(usuarios))];
      io.emit("lista_usuarios", listaNomes);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});