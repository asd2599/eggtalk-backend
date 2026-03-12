const express = require("express");
const cors = require("cors");
require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");

// 서비스 임포트
// 소켓 핸들러 임포트
const datingHandler = require("./sockets/datingHandler");
const socialHandler = require("./sockets/socialHandler");
const childHandler = require("./sockets/childHandler");
const gameHandler = require("./sockets/gameHandler");

// 에러 핸들링
process.on("uncaughtException", (err) =>
  console.error("!!! UNCAUGHT CRASH !!!", err),
);
process.on("unhandledRejection", (err) =>
  console.error("!!! UNHANDLED REJECTION !!!", err),
);

const app = express();
const server = http.createServer(app);

const corsOptions = {
  origin: [
    "https://gamestack.store",
    "https://www.gamestack.store",
    "https://keepinsight.site",
    "https://www.keepinsight.site",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
  ],
  credentials: true,
};

const io = new Server(server, {
  cors: corsOptions,
  allowEIO3: true,
});

app.use(cors(corsOptions));
app.use(express.json());

// Swagger
const { swaggerUi, swaggerSpec } = require("./swagger");
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// --- 상태 관리 변수 ---
const activeUsers = new Map();
const socketToPetName = new Map();
const hatchProgressMap = new Map();

// 게임/상황극 관리
const rolePlayReadyMap = new Map();
const playRoomStartedSet = new Set();
const feedRoomStartedSet = new Set();
const bathRoomStartedSet = new Set();

const roomParticipantsMap = new Map();
const roomChatRoundMap = new Map();
const roomScenarioMap = new Map();

const feedGameMap = new Map();
const bathGameMap = new Map();

// --- 유틸리티 함수 ---
const cleanupRolePlayReady = (socket, childId) => {
  const roomName = `child_room_${childId}`;
  const readySet = rolePlayReadyMap.get(roomName);
  if (readySet) {
    readySet.delete(socket.petId);
    if (readySet.size === 0) rolePlayReadyMap.delete(roomName);
  }
};

const cleanupMiniGame = async (
  roomId,
  namespace,
  startedSet,
  gameMap,
  droppedPetName,
  leftEvent = "spouse_left_child_room",
) => {
  if (!roomId) return;
  const roomName = `${namespace}_${roomId}`;
  const remaining = await io.in(roomName).fetchSockets();
  startedSet.delete(roomName);
  if (gameMap) gameMap.delete(roomName);
  if (remaining.length > 0) {
    io.in(roomName).emit(leftEvent, droppedPetName);
  }
};

// --- 소켓 로직 ---
const state = {
  activeUsers,
  socketToPetName,
  hatchProgressMap,
  rolePlayReadyMap,
  playRoomStartedSet,
  feedRoomStartedSet,
  bathRoomStartedSet,
  roomParticipantsMap,
  roomChatRoundMap,
  roomScenarioMap,
  feedGameMap,
  bathGameMap,
};

io.on("connection", (socket) => {
  io.emit("update_user_count", io.engine.clientsCount);

  // 개별 핸들러 연결
  socialHandler(io, socket, state);
  datingHandler(io, socket);
  childHandler(io, socket, state);
  gameHandler(io, socket, state);

  // [Disconnect & Cleanup]
  socket.on("disconnect", async () => {
    const {
      childRoomId,
      childPetName,
      playRoomId,
      feedRoomId,
      bathRoomId,
      id,
    } = socket;
    const droppedName = socketToPetName.get(id) || childPetName || "배우자";

    if (childRoomId) {
      cleanupRolePlayReady(socket, childRoomId);
      socket
        .to(`child_room_${childRoomId}`)
        .emit("spouse_left_child_room", childPetName);
    }

    cleanupMiniGame(
      playRoomId,
      "play_room",
      playRoomStartedSet,
      roomParticipantsMap,
      droppedName,
    );
    cleanupMiniGame(
      feedRoomId,
      "feed_room",
      feedRoomStartedSet,
      feedGameMap,
      droppedName,
      "feed_partner_left",
    );
    cleanupMiniGame(
      bathRoomId,
      "bath_room",
      bathRoomStartedSet,
      bathGameMap,
      droppedName,
      "bath_partner_left",
    );

    const petName = socketToPetName.get(id);
    if (petName) {
      const userSockets = activeUsers.get(petName);
      if (userSockets) {
        userSockets.delete(id);
        if (userSockets.size === 0) activeUsers.delete(petName);
      }
      socketToPetName.delete(id);
      io.emit("online_users_list", Array.from(activeUsers.keys()));
    }

    if (socket.roomId && socket.petName) {
      socket.to(socket.roomId).emit("receive_dating_message", {
        sender: "System",
        message: `${socket.petName}님이 방을 나갔습니다.`,
        isSystem: true,
      });
    }
  });
});

// 라우터 등록 및 io 전역변수 세팅
app.set("io", io);

app.use(require("./routes/userRoutes"));
app.use(require("./routes/petRoutes"));
app.use("/api", require("./routes/roomRoutes"));
app.use("/api/friends", require("./routes/friendRoutes"));
app.use("/api", require("./routes/subwayRoutes"));
app.use("/api", require("./routes/busRoutes"));
app.use("/api", require("./routes/tmapRoutes"));

// 스케줄러
setInterval(async () => {
  try {
    const { pool } = require("./database/database");
    await pool.query(
      "UPDATE pets SET hunger = GREATEST(0, hunger - 1) WHERE hunger > 0",
    );
  } catch (err) {
    console.error("🕒 Scheduler Error:", err);
  }
}, 300000);

const PORT = process.env.PORT || 8000;
server.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 서버가 포트 ${PORT}에서 작동 중!`),
);
