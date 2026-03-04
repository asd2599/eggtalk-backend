const express = require("express");
const cors = require("cors");
require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");

process.on("uncaughtException", (err) => {
  console.error("!!! UNCAUGHT CRASH !!!", err);
});
process.on("unhandledRejection", (err) => {
  console.error("!!! UNHANDLED REJECTION !!!", err);
});
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

// Swagger 설정 연결
const { swaggerUi, swaggerSpec } = require("./swagger");
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// --- Socket.io 실시간 이벤트 로직 (DB 기반 전환 후 최소화) --- //
io.on("connection", (socket) => {
  // 새 사용자가 연결될 때마다 로비 접속자 수 브로드캐스트
  io.emit("update_user_count", io.engine.clientsCount);

  // 로비 사용자들에게 방 목록이 변경되었음을 알리는 트리거 (API 호출 수신 시 컨트롤러에서 이 이벤트를 발송해도 됨)
  // 편의를 위해 일단 클라이언트에서 요청이 올 때 혹은 방금 입장했을 때 브로드캐스트
  socket.on("trigger_rooms_update", () => {
    io.emit("rooms_updated"); // 프론트의 LoungePage가 이걸 받으면 axios로 방 목록 다시 가져감
  });

  socket.on("user_login", (petName) => {
    socket.broadcast.emit("new_user_login", petName);
  });

  // DB 기반 상태 환경에서 통신을 위해서 소켓 Room 에만 입장 (방 관리는 DB에서 이미 끝남)
  socket.on("join_dating_room", ({ roomId, petName }, callback) => {
    // 💡 React StrictMode 등 이중 조인 요청에 의한 다중 시스템 메시지 도배 방지
    if (!socket.rooms.has(roomId)) {
      socket.join(roomId);

      // 이 방에 있는 사람들에게만(나 제외) 새로 입장했음을 알림
      socket.to(roomId).emit("receive_dating_message", {
        sender: "System",
        message: `${petName}님이 방에 들어왔습니다!`,
        isSystem: true,
      });
    }

    // 입장 성공 응답
    if (callback) callback({ success: true, roomId });
  });

  // 방에서 실시간 메시지 교환
  socket.on("send_dating_message", ({ roomId, message, sender }) => {
    // 같은 방 안에 있는 사용자들에게 메시지 브로드캐스트 (본인 제외)
    socket.to(roomId).emit("receive_dating_message", {
      sender,
      message,
      timestamp: new Date(),
    });
  });

  // 방 퇴장 알림
  socket.on("leave_dating_room", ({ roomId, petName }) => {
    socket.to(roomId).emit("receive_dating_message", {
      sender: "System",
      message: `${petName}님이 방에서 퇴장했습니다.`,
      isSystem: true,
    });
    socket.leave(roomId);
  });

  // 순수 소켓 접속 종료 (창 닫힘 등)
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

const roomRoutes = require("./routes/roomRoutes");
app.use("/api", roomRoutes);

const PORT = process.env.PORT || 8000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 서버(Socket 포함)가 포트 ${PORT}에서 작동 중입니다.`);
});
