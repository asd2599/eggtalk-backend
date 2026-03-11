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
io.on("connection", (socket) => {
  io.emit("update_user_count", io.engine.clientsCount);

  socket.on("user_login", (petName) => {
    socketToPetName.set(socket.id, petName);
    if (!activeUsers.has(petName)) activeUsers.set(petName, new Set());
    activeUsers.get(petName).add(socket.id);
    io.emit("online_users_list", Array.from(activeUsers.keys()));
  });

  // [Dating Room] - 기존 로직 유지
  socket.on("join_dating_room", async ({ roomId, petName }, callback) => {
    if (!socket.rooms.has(roomId)) {
      socket.join(roomId);
      socket.roomId = roomId;
      socket.petName = petName;
      socket.to(roomId).emit("receive_dating_message", {
        sender: "System",
        message: `${petName}님이 방에 들어왔습니다!`,
        isSystem: true,
      });
    }
    if (callback) callback({ success: true, roomId });
  });

  socket.on("send_dating_message", (data) => {
    if (data?.roomId) {
      const { roomId, ...msgData } = data;
      socket
        .to(roomId)
        .emit("receive_dating_message", { ...msgData, timestamp: new Date() });
    }
  });

  // [Friend/Breeding Requests]
  socket.on(
    "send_friend_request",
    ({ roomId, requesterPetName, receiverPetName, requestId }) => {
      socket.to(roomId).emit("receive_friend_request", {
        requesterPetName,
        receiverPetName,
        requestId,
      });
    },
  );

  socket.on(
    "send_breeding_request",
    ({ roomId, requesterPetName, receiverPetName }) => {
      socket.to(roomId).emit("receive_breeding_request", {
        requesterPetName,
        receiverPetName,
      });
    },
  );

  socket.on(
    "accept_breeding_request",
    ({ roomId, requesterPetName, receiverPetName }) => {
      io.to(roomId).emit("breeding_accepted", {
        roomId,
        requesterPetName,
        receiverPetName,
      });
    },
  );

  // [Child Room] - 육아 메인
  socket.on("join_child_room", async ({ childId, petId, petName }) => {
    const roomName = `child_room_${childId}`;
    socket.join(roomName);
    socket.childRoomId = childId;
    socket.petId = petId;
    socket.childPetName = petName;

    const sockets = await io.in(roomName).fetchSockets();
    if (!hatchProgressMap.has(roomName)) hatchProgressMap.set(roomName, 0);

    socket.emit("child_room_status", {
      isSpouseInRoom: sockets.length > 1,
      onlineUsers: Array.from(activeUsers.keys()),
      hatchProgress: hatchProgressMap.get(roomName),
    });
    socket.to(roomName).emit("spouse_entered_child_room", petName);
  });

  // 부화(Hatch) & 액션 제안 로직
  socket.on("hatch_tap", ({ childId }) => {
    const roomName = `child_room_${childId}`;
    let progress = Math.min((hatchProgressMap.get(roomName) || 0) + 2, 100);
    hatchProgressMap.set(roomName, progress);
    io.in(roomName).emit("hatch_progress_updated", { progress });
  });

  socket.on(
    "child_action_request",
    ({ childId, actionType, requesterName }) => {
      socket
        .to(`child_room_${childId}`)
        .emit("child_action_proposed", { actionType, requesterName });
    },
  );

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
    const uniquePetIds = [
      ...new Set(
        sockets
          .map((s) => String(s.data?.petId))
          .filter((id) => id && id !== "undefined"),
      ),
    ];

    if (playRoomStartedSet.has(roomName)) {
      const scenario = roomScenarioMap.get(roomName);
      if (scenario) {
        socket.emit("role_play_started", {
          scenario,
          roles: {}, // 재접속 시 역할은 프론트엔드가 이전 상태를 가지거나 서버의 별도 맵을 참조(간단히 유지)
        });
      }
      return;
    }

    playRoomStartedSet.add(roomName);

    const participantIds = uniquePetIds;
    roomParticipantsMap.set(roomName, participantIds);
    roomChatRoundMap.set(roomName, new Map());

    try {
      const aiResult = await generateRolePlay(participantIds);
      roomScenarioMap.set(roomName, aiResult.scenario);
      io.in(roomName).emit("role_play_started", {
        scenario: aiResult.scenario,
        roles: aiResult.rolesAssignment,
      });
      io.in(roomName).emit("role_play_message", {
        senderId: "child_pet",
        senderName: "자식 펫 🐾",
        content: aiResult.openingMent,
        role: aiResult.scenario?.childRole || "아기 펫",
        timestamp: new Date(),
      });
    } catch (err) {
      console.error("[PLAY] AI Error:", err.message);
      playRoomStartedSet.delete(roomName);
    }
  });

  socket.on(
    "role_play_chat",
    async ({ childId, senderId, senderName, content, role }) => {
      const roomName = `play_room_${childId}`;
      const round = roomChatRoundMap.get(roomName);
      if (!round || round.has(String(senderId))) return;

      round.set(String(senderId), { role, name: senderName, content });
      io.in(roomName).emit("role_play_message", {
        senderId,
        senderName,
        content,
        role,
        timestamp: new Date(),
      });

      const participants = roomParticipantsMap.get(roomName) || [];
      if (
        participants.length >= 2 &&
        participants.every((pid) => round.has(pid))
      ) {
        const roundMessages = Array.from(round.values());
        roomChatRoundMap.set(roomName, new Map());

        try {
          const petReply = await generatePetReply(
            roundMessages,
            roomScenarioMap.get(roomName),
          );
          io.in(roomName).emit("role_play_message", {
            senderId: "child_pet",
            senderName: "자식 펫 🐾",
            content: petReply,
            role: roomScenarioMap.get(roomName)?.childRole || "아기 펫",
            timestamp: new Date(),
          });
          io.in(roomName).emit("play_round_start");
        } catch (err) {
          io.in(roomName).emit("play_round_start");
        }
      }
    },
  );

  // 이탈 시 play_partner_left 이벤트 + 방 파기
  socket.on("leave_play_room", async ({ childId, petName }) => {
    const roomName = `play_room_${childId}`;
    socket.leave(roomName);
    delete socket.playRoomId;

    setTimeout(async () => {
      const sockets = await io.in(roomName).fetchSockets();
      const isPetStillInRoom = sockets.some(
        (s) => String(s.data?.petId) === String(socket.petId),
      );
      if (!isPetStillInRoom) {
        io.in(roomName).emit("play_partner_left", {
          name: petName || "배우자",
        });
        playRoomStartedSet.delete(roomName);
        roomParticipantsMap.delete(roomName);
        roomChatRoundMap.delete(roomName);
        roomScenarioMap.delete(roomName);
      }
    }, 500);
  });

  // [Feed Game Room]
  socket.on("join_feed_room", async ({ childId, petId, petName }) => {
    const roomName = `feed_room_${childId}`;
    socket.petId = petId;
    if (!socket.data) socket.data = {};
    socket.data.petId = petId;
    socket.feedRoomId = childId;
    socket.join(roomName);

    const sockets = await io.in(roomName).fetchSockets();
    const uniquePetIds = [
      ...new Set(
        sockets
          .map((s) => String(s.data?.petId))
          .filter((id) => id && id !== "undefined"),
      ),
    ];

    if (feedRoomStartedSet.has(roomName)) {
      const game = feedGameMap.get(roomName);
      if (game) {
        // 새로 들어온 유저가 기존 참가자 목록에 없다면 추가 (두 번째 유저 편입)
        if (
          !game.participants.includes(petId) &&
          petId &&
          petId !== "undefined"
        ) {
          game.participants.push(petId);
        }

        const baseSelectorId = game.participants[0];
        // 참가자가 2명 이상이면 두 번째 사람을 토핑으로 지목, 혼자면 아직 미정(null)
        const toppingSelectorId =
          game.participants.length > 1 ? game.participants[1] : null;

        // 방 전체에 새로운 역할 분배 상태 브로드캐스트 (후속 접속자 합류 알림)
        io.in(roomName).emit("feed_game_started", {
          hint: game.hint,
          baseSelectorId,
          toppingSelectorId,
        });

        // 후속 접속자에게만 지금까지 선택된 재료 세팅 전송
        for (const [role, ingredientId] of Object.entries(game.ingredients)) {
          socket.emit("ingredient_selected", {
            role,
            ingredientId,
            petId: "재접속",
          });
        }
      }
      return;
    }

    feedRoomStartedSet.add(roomName);

    try {
      const hint = await feedGameService.generateCookingHint();
      // 첫 방 생성 시 참가자는 본인 1명(혹은 동시에 들어왔다면 2명)
      const pIds = uniquePetIds;
      const baseSelectorId = pIds[0];
      // 방 생성 시점에 2명 미만이면 토핑 선택자는 일단 null (독식 방지)
      const toppingSelectorId = pIds.length > 1 ? pIds[1] : null;

      feedGameMap.set(roomName, { hint, ingredients: {}, participants: pIds });
      io.in(roomName).emit("feed_game_started", {
        hint,
        baseSelectorId,
        toppingSelectorId,
      });
    } catch (err) {
      feedRoomStartedSet.delete(roomName);
    }
  });

  socket.on(
    "select_ingredient",
    async ({ childId, role, ingredientId, petName, petId }) => {
      const roomName = `feed_room_${childId}`;
      const game = feedGameMap.get(roomName);
      if (!game) return;

      game.ingredients[role] = ingredientId;
      io.in(roomName).emit("ingredient_selected", {
        role,
        ingredientId,
        petName,
        petId,
      });

      if (game.ingredients.base && game.ingredients.topping) {
        io.in(roomName).emit("feed_game_evaluating");
        try {
          const result = await feedGameService.evaluateCooking(
            game.hint,
            game.ingredients,
          );

          // 능력치 변화 계산
          const changes = {
            hunger: 100,
            affection: result.score > 80 ? 20 : result.score > 50 ? 10 : 5,
            healthHp: result.score > 60 ? 10 : 0,
            exp: Math.round(result.score * 1.5),
          };

          // DB 반영
          const { pool } = require("./database/database");
          await pool.query(
            `UPDATE pets SET
            hunger = 100,
            affection = LEAST(affection + $2, 100),
            health_hp = LEAST(health_hp + $3, 100),
            exp = exp + $4
          WHERE id = $1`,
            [childId, changes.affection, changes.healthHp, changes.exp],
          );

          io.in(roomName).emit("feed_game_result", { ...result, changes });
        } catch (err) {
          console.error("[FEED] evaluate error:", err);
          io.in(roomName).emit("feed_game_error", {
            message: "결과 처리 중 문제가 발생했습니다.",
          });
        }
        feedGameMap.delete(roomName);
        feedRoomStartedSet.delete(roomName);
      }
    },
  );

  // 이탈 시 feed_partner_left 이벤트 + 방 파기
  socket.on("leave_feed_room", async ({ childId, petName }) => {
    const roomName = `feed_room_${childId}`;
    socket.leave(roomName);
    delete socket.feedRoomId;

    setTimeout(async () => {
      const sockets = await io.in(roomName).fetchSockets();
      const isPetStillInRoom = sockets.some(
        (s) => String(s.data?.petId) === String(socket.petId),
      );
      if (!isPetStillInRoom) {
        io.in(roomName).emit("feed_partner_left", petName || "배우자");
        feedRoomStartedSet.delete(roomName);
        feedGameMap.delete(roomName);
      }
    }, 500);
  });

  // [Bath Game Room]
  socket.on("join_bath_room", async ({ childId, petId, petName }) => {
    const roomName = `bath_room_${childId}`;
    socket.petId = petId;
    if (!socket.data) socket.data = {};
    socket.data.petId = petId;
    socket.bathRoomId = childId;
    socket.join(roomName);

    const sockets = await io.in(roomName).fetchSockets();
    const uniquePetIds = [
      ...new Set(
        sockets
          .map((s) => String(s.data?.petId))
          .filter((id) => id && id !== "undefined"),
      ),
    ];

    if (bathRoomStartedSet.has(roomName)) {
      const game = bathGameMap.get(roomName);
      if (game) {
        socket.emit("bath_game_started", {
          hint: game.hint,
          currentTurnPetId: game.participants[0], // 턴 관리는 별도 이벤트로 전송하므로 방어용
        });
      }
      return;
    }

    bathRoomStartedSet.add(roomName);

    try {
      const { word, hint } = await bathGameService.initializeGame();
      const pIds = uniquePetIds;
      bathGameMap.set(roomName, {
        word,
        hint,
        questions: [],
        turnCount: 0,
        participants: pIds,
      });
      io.in(roomName).emit("bath_game_started", {
        hint,
        currentTurnPetId: pIds[0],
      });
    } catch (err) {
      bathRoomStartedSet.delete(roomName);
    }
  });

  socket.on(
    "ask_bath_question",
    async ({ childId, question, petName, petId }) => {
      const roomName = `bath_room_${childId}`;
      const game = bathGameMap.get(roomName);
      if (!game) return;

      const answer = await bathGameService.answerQuestion(game.word, question);
      const log = { petName, question, answer };
      game.questions.push(log);
      game.turnCount++;
      io.in(roomName).emit("bath_question_answered", log);

      // 20턴 도달 시 정답 입력만 가능하도록 알림 (즉시 종료 X)
      if (game.turnCount >= 20) {
        io.in(roomName).emit("bath_last_chance", { turnCount: game.turnCount });
        return; // 턴 전환 없이 대기 (정답 맞추기 대기)
      }

      const nextIdx =
        (game.participants.indexOf(String(petId)) + 1) %
        game.participants.length;
      io.in(roomName).emit("bath_turn_changed", {
        currentTurnPetId: game.participants[nextIdx],
      });
    },
  );

  // 이탈 시 bath_partner_left 이벤트 + 방 파기
  socket.on("leave_bath_room", async ({ childId, petName }) => {
    const roomName = `bath_room_${childId}`;
    socket.leave(roomName);
    delete socket.bathRoomId;

    setTimeout(async () => {
      const sockets = await io.in(roomName).fetchSockets();
      const isPetStillInRoom = sockets.some(
        (s) => String(s.data?.petId) === String(socket.petId),
      );
      if (!isPetStillInRoom) {
        io.in(roomName).emit("bath_partner_left", petName || "배우자");
        bathRoomStartedSet.delete(roomName);
        bathGameMap.delete(roomName);
      }
    }, 500);
  });

  socket.on("guess_bath_word", async ({ childId, guess, petName }) => {
    const roomName = `bath_room_${childId}`;
    const game = bathGameMap.get(roomName);
    console.log(
      `[BATH-GUESS] childId=${childId} guess="${guess}" word="${game?.word}" turnCount=${game?.turnCount}`,
    );
    if (!game) return;

    // 정답 시도도 턴 소모
    game.turnCount++;

    const isCorrect =
      guess.replace(/\s/g, "").toLowerCase() ===
      game.word.replace(/\s/g, "").toLowerCase();

    // 채팅창에 정답 시도 표시
    io.in(roomName).emit("bath_guess_attempted", {
      petName,
      guess,
      isCorrect,
    });

    if (isCorrect) {
      const evaluation = await bathGameService.evaluateResult(
        true,
        game.turnCount,
        game.word,
        game.questions,
      );
      const changes = {
        cleanliness: evaluation.changes?.cleanliness ?? 100,
        affection: evaluation.changes?.affection ?? 15,
        knowledge: evaluation.changes?.knowledge ?? 10,
        exp: evaluation.changes?.exp ?? 50,
      };

      try {
        const { pool } = require("./database/database");
        await pool.query(
          `UPDATE pets SET
            cleanliness = LEAST(cleanliness + $2, 100),
            affection = LEAST(affection + $3, 100),
            knowledge = LEAST(knowledge + $4, 100),
            exp = exp + $5
          WHERE id = $1`,
          [
            childId,
            changes.cleanliness,
            changes.affection,
            changes.knowledge,
            changes.exp,
          ],
        );
      } catch (err) {
        console.error("[BATH] DB update error:", err);
      }
      console.log(
        `[BATH-GUESS] isCorrect=true evaluation=${JSON.stringify(evaluation)}`,
      );
      io.in(roomName).emit("bath_game_result", {
        ...evaluation,
        word: game.word,
        changes,
      });
      bathGameMap.delete(roomName);
      bathRoomStartedSet.delete(roomName);
    } else {
      // 틀렸을 때 20턴 초과 체크
      if (game.turnCount >= 20) {
        const evaluation = await bathGameService.evaluateResult(
          false,
          20,
          game.word,
          game.questions,
        );
        const changes = {
          cleanliness: evaluation.changes?.cleanliness ?? 30,
          affection: evaluation.changes?.affection ?? -5,
          knowledge: evaluation.changes?.knowledge ?? 0,
          exp: evaluation.changes?.exp ?? 10,
        };
        try {
          const { pool } = require("./database/database");
          await pool.query(
            `UPDATE pets SET
              cleanliness = LEAST(cleanliness + $2, 100),
              affection  = GREATEST(affection + $3, 0),
              knowledge = LEAST(knowledge + $4, 100),
              exp = exp + $5
            WHERE id = $1`,
            [
              childId,
              changes.cleanliness,
              changes.affection,
              changes.knowledge,
              changes.exp,
            ],
          );
        } catch (err) {
          console.error("[BATH] turn-over DB error:", err);
        }
        io.in(roomName).emit("bath_game_result", {
          ...evaluation,
          word: game.word,
          changes,
        });
        bathGameMap.delete(roomName);
        bathRoomStartedSet.delete(roomName);
      }
    }
  });

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
