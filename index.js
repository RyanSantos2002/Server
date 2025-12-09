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
  },
});

// Quando um cliente conecta
io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);

  // Recebe alerta e envia para todos
  socket.on("alert", (msg) => {
    console.log("Alerta recebido:", msg);
    io.emit("alert", msg); 
  });

  socket.on("disconnect", () => {
    console.log("Cliente desconectado:", socket.id);
  });
});

app.get("/", (req, res) => {
  res.send("Servidor de alertas rodando 👍");
});

// Porta do Railway
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
