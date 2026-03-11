const express = require("express");
const cors = require("cors");
require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");

// 서비스 임포트
const {
  generateRolePlay,
  scoreChat,
  generatePetReply,
} = require("./services/rolePlayService");
const feedGameService = require("./services/feedGameService");
const bathGameService = require("./services/bathGameService");

// 에러 핸들링
process.on("uncaughtException", (err) => console.error("!!! UNCAUGHT CRASH !!!", err));
process.on("unhandledRejection", (err) => console.error("!!! UNHANDLED REJECTION !!!", err));

const app = express();
const server = http.createServer(app);

const corsOptions = {
  origin: [
    'https://gamestack.store', 'https://www.gamestack.store',
    'https://keepinsight.site', 'https://www.keepinsight.site',
    'http://localhost:3000', 'http://localhost:5173',
    'http://localhost:5174', 'http://localhost:5175',
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
const { swaggerUi, swaggerSpec } = require('./swagger');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

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

const cleanupMiniGame = async (roomId, namespace, startedSet, gameMap, droppedPetName) => {
  if (!roomId) return;
  const roomName = `${namespace}_${roomId}`;
  const remaining = await io.in(roomName).fetchSockets();
  if (remaining.length === 0) {
    startedSet.delete(roomName);
    if (gameMap) gameMap.delete(roomName);
  } else {
    io.in(roomName).emit("spouse_left_child_room", droppedPetName);
    startedSet.delete(roomName);
    if (gameMap) gameMap.delete(roomName);
  }
};

// --- 소켓 로직 ---
io.on("connection", (socket) => {
  io.emit('update_user_count', io.engine.clientsCount);

  socket.on('user_login', (petName) => {
    socketToPetName.set(socket.id, petName);
    if (!activeUsers.has(petName)) activeUsers.set(petName, new Set());
    activeUsers.get(petName).add(socket.id);
    io.emit('online_users_list', Array.from(activeUsers.keys()));
  });

  // [Dating Room] - 기존 로직 유지
  socket.on('join_dating_room', async ({ roomId, petName }, callback) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.petName = petName;
    socket.to(roomId).emit('receive_dating_message', {
      sender: 'System', message: `${petName}님이 방에 들어왔습니다!`, isSystem: true,
    });
    if (callback) callback({ success: true, roomId });
  });

  socket.on('send_dating_message', (data) => {
    if (data?.roomId) {
      const { roomId, ...msgData } = data;
      socket.to(roomId).emit('receive_dating_message', { ...msgData, timestamp: new Date() });
    }
  });

  // [Friend/Breeding Requests]
  socket.on("send_friend_request", ({ roomId, requesterPetName, receiverPetName, requestId }) => {
    socket.to(roomId).emit("receive_friend_request", { requesterPetName, receiverPetName, requestId });
  });

  socket.on("send_breeding_request", ({ roomId, requesterPetName, receiverPetName }) => {
    socket.to(roomId).emit("receive_breeding_request", { requesterPetName, receiverPetName });
  });

  socket.on("accept_breeding_request", ({ roomId, requesterPetName, receiverPetName }) => {
    io.to(roomId).emit("breeding_accepted", { roomId, requesterPetName, receiverPetName });
  });

  // [Child Room] - 육아 메인
  socket.on('join_child_room', async ({ childId, petId, petName }) => {
    const roomName = `child_room_${childId}`;
    socket.join(roomName);
    socket.childRoomId = childId;
    socket.petId = petId;
    socket.childPetName = petName;

    const sockets = await io.in(roomName).fetchSockets();
    if (!hatchProgressMap.has(roomName)) hatchProgressMap.set(roomName, 0);

    socket.emit('child_room_status', {
      isSpouseInRoom: sockets.length > 1,
      onlineUsers: Array.from(activeUsers.keys()),
      hatchProgress: hatchProgressMap.get(roomName),
    });
    socket.to(roomName).emit('spouse_entered_child_room', petName);
  });

  // 부화(Hatch) & 액션 제안 로직
  socket.on("hatch_tap", ({ childId }) => {
    const roomName = `child_room_${childId}`;
    let progress = Math.min((hatchProgressMap.get(roomName) || 0) + 2, 100);
    hatchProgressMap.set(roomName, progress);
    io.in(roomName).emit("hatch_progress_updated", { progress });
  });

  socket.on("child_action_request", ({ childId, actionType, requesterName }) => {
    socket.to(`child_room_${childId}`).emit("child_action_proposed", { actionType, requesterName });
  });

  socket.on("child_action_response", ({ childId, approved, actionType }) => {
    const roomName = `child_room_${childId}`;
    if (approved) io.in(roomName).emit("child_action_sync", { actionType });
    else socket.to(roomName).emit("child_action_rejected", { actionType });
  });

  // [Role-Play Room]
  socket.on("join_play_room", async ({ childId, petId, petName }) => {
    const roomName = `play_room_${childId}`;
    socket.petId = petId;
    socket.playRoomId = childId;
    socket.join(roomName);

    const sockets = await io.in(roomName).fetchSockets();
    if (sockets.length < 2) {
      socket.emit("play_room_waiting");
      return;
    }

    if (playRoomStartedSet.has(roomName)) return;
    playRoomStartedSet.add(roomName);

    const participantIds = sockets.map((s) => String(s.petId)).filter(id => id && id !== "undefined");
    roomParticipantsMap.set(roomName, participantIds);
    roomChatRoundMap.set(roomName, new Map());

    try {
      const aiResult = await generateRolePlay(participantIds);
      roomScenarioMap.set(roomName, aiResult.scenario);
      io.in(roomName).emit("role_play_started", { scenario: aiResult.scenario, roles: aiResult.rolesAssignment });
      io.in(roomName).emit("role_play_message", {
        senderId: "child_pet", senderName: "자식 펫 🐾", content: aiResult.openingMent,
        role: aiResult.scenario?.childRole || "아기 펫", timestamp: new Date(),
      });
    } catch (err) {
      console.error("[PLAY] AI Error:", err.message);
      playRoomStartedSet.delete(roomName);
    }
  });

  socket.on("role_play_chat", async ({ childId, senderId, senderName, content, role }) => {
    const roomName = `play_room_${childId}`;
    const round = roomChatRoundMap.get(roomName);
    if (!round || round.has(String(senderId))) return;

    round.set(String(senderId), { role, name: senderName, content });
    io.in(roomName).emit("role_play_message", { senderId, senderName, content, role, timestamp: new Date() });

    const participants = roomParticipantsMap.get(roomName) || [];
    if (participants.length >= 2 && participants.every(pid => round.has(pid))) {
      const roundMessages = Array.from(round.values());
      roomChatRoundMap.set(roomName, new Map());

      try {
        const petReply = await generatePetReply(roundMessages, roomScenarioMap.get(roomName));
        io.in(roomName).emit("role_play_message", {
          senderId: "child_pet", senderName: "자식 펫 🐾", content: petReply,
          role: roomScenarioMap.get(roomName)?.childRole || "아기 펫", timestamp: new Date(),
        });
        io.in(roomName).emit("play_round_start");
      } catch (err) {
        io.in(roomName).emit("play_round_start");
      }
    }
  });

  // [Feed Game Room]
  socket.on("join_feed_room", async ({ childId, petId, petName }) => {
    const roomName = `feed_room_${childId}`;
    socket.petId = petId;
    socket.feedRoomId = childId;
    socket.join(roomName);

    const sockets = await io.in(roomName).fetchSockets();
    if (sockets.length < 2) {
      socket.emit("feed_room_waiting");
      return;
    }

    if (feedRoomStartedSet.has(roomName)) return;
    feedRoomStartedSet.add(roomName);

    try {
      const hint = await feedGameService.generateCookingHint();
      const pIds = sockets.map(s => String(s.petId));
      feedGameMap.set(roomName, { hint, ingredients: {}, participants: pIds });
      io.in(roomName).emit("feed_game_started", { hint, baseSelectorId: pIds[0], toppingSelectorId: pIds[1] });
    } catch (err) {
      feedRoomStartedSet.delete(roomName);
    }
  });

  socket.on("select_ingredient", async ({ childId, role, ingredientId, petName }) => {
    const roomName = `feed_room_${childId}`;
    const game = feedGameMap.get(roomName);
    if (!game) return;

    game.ingredients[role] = ingredientId;
    io.in(roomName).emit("ingredient_selected", { role, ingredientId, petName });

    if (game.ingredients.base && game.ingredients.topping) {
      io.in(roomName).emit("feed_game_evaluating");
      const result = await feedGameService.evaluateCooking(game.hint, game.ingredients);
      // DB 처리 생략 (기존 HB 로직 동일하게 적용)
      io.in(roomName).emit("feed_game_result", { ...result });
      feedGameMap.delete(roomName);
      feedRoomStartedSet.delete(roomName);
    }
  });

  // [Bath Game Room]
  socket.on("join_bath_room", async ({ childId, petId, petName }) => {
    const roomName = `bath_room_${childId}`;
    socket.petId = petId;
    socket.bathRoomId = childId;
    socket.join(roomName);

    const sockets = await io.in(roomName).fetchSockets();
    if (bathRoomStartedSet.has(roomName)) return;
    bathRoomStartedSet.add(roomName);

    try {
      const { word, hint } = await bathGameService.initializeGame();
      const pIds = sockets.map(s => String(s.petId)).filter(Boolean);
      bathGameMap.set(roomName, { word, hint, questions: [], turnCount: 0, participants: pIds });
      io.in(roomName).emit("bath_game_started", { hint, currentTurnPetId: pIds[0] });
    } catch (err) {
      bathRoomStartedSet.delete(roomName);
    }
  });

  socket.on("ask_bath_question", async ({ childId, question, petName, petId }) => {
    const roomName = `bath_room_${childId}`;
    const game = bathGameMap.get(roomName);
    if (!game) return;

    const answer = await bathGameService.answerQuestion(game.word, question);
    const log = { petName, question, answer };
    game.questions.push(log);
    game.turnCount++;
    io.in(roomName).emit("bath_question_answered", log);
    
    const nextIdx = (game.participants.indexOf(String(petId)) + 1) % game.participants.length;
    io.in(roomName).emit("bath_turn_changed", { currentTurnPetId: game.participants[nextIdx] });
  });

  socket.on("guess_bath_word", async ({ childId, guess, petName }) => {
    const roomName = `bath_room_${childId}`;
    const game = bathGameMap.get(roomName);
    if (!game) return;

    if (guess.replace(/\s/g, "").toLowerCase() === game.word.replace(/\s/g, "").toLowerCase()) {
      const result = bathGameService.evaluateResult(true, game.turnCount + 1);
      io.in(roomName).emit("bath_game_result", { ...result, word: game.word });
      bathGameMap.delete(roomName);
      bathRoomStartedSet.delete(roomName);
    } else {
      io.in(roomName).emit("bath_wrong_guess", { petName, guess });
    }
  });

  // [Disconnect & Cleanup]
  socket.on("disconnect", async () => {
    const { childRoomId, childPetName, playRoomId, feedRoomId, bathRoomId, id } = socket;
    const droppedName = socketToPetName.get(id) || childPetName || "배우자";

    if (childRoomId) {
      cleanupRolePlayReady(socket, childRoomId);
      socket.to(`child_room_${childRoomId}`).emit("spouse_left_child_room", childPetName);
    }

    cleanupMiniGame(playRoomId, "play_room", playRoomStartedSet, roomParticipantsMap, droppedName);
    cleanupMiniGame(feedRoomId, "feed_room", feedRoomStartedSet, feedGameMap, droppedName);
    cleanupMiniGame(bathRoomId, "bath_room", bathRoomStartedSet, bathGameMap, droppedName);

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
  });
});

// 라우터 등록
app.use(require('./routes/userRoutes'));
app.use(require('./routes/petRoutes'));
app.use('/api', require('./routes/roomRoutes'));
app.use('/api/friends', require('./routes/friendRoutes'));
app.use('/api', require('./routes/subwayRoutes'));
app.use('/api', require('./routes/busRoutes'));

// 스케줄러
setInterval(async () => {
  try {
    const { pool } = require('./database/database');
    await pool.query('UPDATE pets SET hunger = GREATEST(0, hunger - 1) WHERE hunger > 0');
  } catch (err) { console.error('🕒 Scheduler Error:', err); }
}, 300000);

const PORT = process.env.PORT || 8000;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 서버가 포트 ${PORT}에서 작동 중!`));