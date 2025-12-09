import cors from "cors";
import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let usuarios = {}; // nome → socket.id

io.on("connection", (socket) => {
  console.log("Novo cliente conectado:", socket.id);

  // Registrar nome do usuário
  socket.on("registrar_usuario", (nome) => {
    usuarios[nome] = socket.id;
    console.log(`Usuário registrado: ${nome} -> ${socket.id}`);

    io.emit("lista_usuarios", Object.keys(usuarios));
  });

  // Mensagem geral
  socket.on("alert", (data) => {
    io.emit("alert", data);
  });

  // Mensagem privada
  socket.on("mensagem_privada", ({ de, para, mensagem }) => {
    const destino = usuarios[para];
    if (destino) {
      io.to(destino).emit("alert", {
        de,
        mensagem,
        tipo: "privado"
      });
    }
  });

  // Usuário desconectou
  socket.on("disconnect", () => {
    for (const nome in usuarios) {
      if (usuarios[nome] === socket.id) {
        delete usuarios[nome];
      }
    }
    io.emit("lista_usuarios", Object.keys(usuarios));
    console.log("Cliente desconectado:", socket.id);
  });
});

server.listen(process.env.PORT || 3000, () =>
  console.log("Servidor rodando")
);
