const express = require("express");
const cors = require("cors");
require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // 호환성을 위해 모든 출처 허용
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

// --- Socket.io 실시간 이벤트 로직 --- //
io.on("connection", (socket) => {
  // 새 사용자가 연결될 때마다 전체 접속자 수 브로드캐스트
  io.emit("update_user_count", io.engine.clientsCount);

  // 클라이언트에서 로그인 확인 후 이름(펫 이름 등)을 넘겨주면, 다른 모든 탭에 알림 전파
  socket.on("user_login", (petName) => {
    socket.broadcast.emit("new_user_login", petName);
  });

  // 사용자가 창을 닫거나 연결이 끊어질 때 접속자 수 다시 브로드캐스트
  socket.on("disconnect", () => {
    io.emit("update_user_count", io.engine.clientsCount);
  });
});
// ------------------------------------ //

app.get("/", (req, res) => {
  res.send("Server is Running!");
});

const userRoutes = require("./routes/userRoutes");
app.use(userRoutes);

const petRoutes = require("./routes/petRoutes");
app.use(petRoutes);

const PORT = process.env.PORT || 8000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 서버(Socket 포함)가 포트 ${PORT}에서 작동 중입니다.`);
});
