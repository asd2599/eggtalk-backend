const express = require("express");
const cors = require("cors");
require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");
const {
  generateRolePlay,
  scoreChat,
  getRandomScenario,
  findScenarioById,
  generatePetReply,
} = require("./services/rolePlayService");

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
    // Vercel 프론트엔드 도메인과 이전 배포 도메인, 로컬 테스트(Vite/React 기본 포트) 모두 허용
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
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true, // 인증 정보(쿠키/토큰 헤더) 허용
  },
  allowEIO3: true, // 하위 호환성 (선택사항)
});

// 일반 Express API용 CORS 설정
app.use(
  cors({
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
  }),
);
app.use(express.json());

// Swagger 설정 연결
const { swaggerUi, swaggerSpec } = require("./swagger");
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// --- Socket.io 실시간 이벤트 로직 (DB 기반 전환 후 최소화) --- //
// 💡 전역 온라인 유저 관리 Map (V2.0 친구 상태 연동용)
// petName -> Set(socket.id) 여러 탭 접속 허용
const activeUsers = new Map();
// socket.id -> petName
const socketToPetName = new Map();

// 공동육아 부화 진행도 관리 (roomId -> progress)
const hatchProgressMap = new Map();

// 상황극 로직용 준비 상태 관리 (Map - 전역)
const rolePlayReadyMap = new Map();

// 상황극 중복 시작 방지용 Set (race condition 해결)
const playRoomStartedSet = new Set();
const feedRoomStartedSet = new Set(); // 🍼 추가: 분유 게임 중복 시작 방지
const bathRoomStartedSet = new Set(); // 🛁 추가: 목욕 게임 중복 시작 방지

// 상황극 방별 참가자 목록 (play_room_N -> [petId1, petId2])
const roomParticipantsMap = new Map();
// 턴제 라운드 관리 (play_room_N -> Map<petId, { role, name, content }>)
const roomChatRoundMap = new Map();
// 방별 현재 시나리오 (play_room_N -> scenario 객체)
const roomScenarioMap = new Map();

// 🍼 분유주기 협동 게임 관리 (child_room_N -> { hint, ingredients: { base, topping }, participants: [petId] })
const feedGameMap = new Map();
const bathGameMap = new Map(); // 🛁 목욕 게임 상태 관리 전역 Map🐾👣

// feedGameService 가져오기
const feedGameService = require("./services/feedGameService");
const bathGameService = require("./services/bathGameService"); // 🛁 목욕 게임 서비스🐾👣

io.on("connection", (socket) => {
  // 새 사용자가 연결될 때마다 로비 접속자 수 브로드캐스트
  io.emit("update_user_count", io.engine.clientsCount);

  // 로비 사용자들에게 방 목록이 변경되었음을 알리는 트리거 (API 호출 수신 시 컨트롤러에서 이 이벤트를 발송해도 됨)
  // 편의를 위해 일단 클라이언트에서 요청이 올 때 혹은 방금 입장했을 때 브로드캐스트
  socket.on("trigger_rooms_update", () => {
    io.emit("rooms_updated"); // 프론트의 LoungePage가 이걸 받으면 axios로 방 목록 다시 가져감
  });

  socket.on("user_login", (petName) => {
    // 💡 Map에 현재 펫 이름 및 소켓 세션 등록
    socketToPetName.set(socket.id, petName);
    if (!activeUsers.has(petName)) {
      activeUsers.set(petName, new Set());
    }
    activeUsers.get(petName).add(socket.id);

    // 전체 접속된 펫 이름(배열)을 즉시 접속자 모두에게 브로드캐스트
    io.emit("online_users_list", Array.from(activeUsers.keys()));
    socket.broadcast.emit("new_user_login", petName);
  });

  // 누군가 현재 접속자 목록을 요청할 때 (FriendPage 최초 진입 등)
  socket.on("get_online_users", (callback) => {
    if (callback) callback(Array.from(activeUsers.keys()));
  });

  // DB 기반 상태 환경에서 통신을 위해서 소켓 Room 에만 입장
  socket.on("join_dating_room", async ({ roomId, petName }, callback) => {
    if (!socket.rooms.has(roomId)) {
      socket.join(roomId);
      socket.roomId = roomId;
      socket.petName = petName;

      // 입장 메시지 브로드캐스트
      socket.to(roomId).emit("receive_dating_message", {
        sender: "System",
        message: `${petName}님이 방에 들어왔습니다!`,
        isSystem: true,
      });

      // 💡 [추가] 방에 있는 모든 사람에게 현재 방 유저 정보(상태) 브로드캐스트
      try {
        const { pool } = require("./database/database"); // pool 참조
        const roomResult = await pool.query(
          "SELECT creator_pet_name, participant_pet_name FROM dating_rooms WHERE id = $1",
          [roomId],
        );

        if (roomResult.rows.length > 0) {
          const row = roomResult.rows[0];
          const petNames = [
            row.creator_pet_name,
            row.participant_pet_name,
          ].filter(Boolean);
          const petResult = await pool.query(
            "SELECT * FROM pets WHERE name = ANY($1)",
            [petNames],
          );

          const users = petResult.rows.map((petRow) => ({
            id: null,
            petName: petRow.name,
            petData: petRow,
          }));

          // 방 전체에 새로운 유저 목록 전송
          io.to(roomId).emit("room_status", users);
          console.log(
            `[Socket] Room ${roomId} status broadcasted for ${petName}`,
          );
        }
      } catch (err) {
        console.error("Room status broadcast error:", err);
      }
    }

    if (callback) callback({ success: true, roomId });
  });

  // 방에서 실시간 메시지 교환
  socket.on("send_dating_message", (data) => {
    // data가 객체일 때만 동작하도록 안전장치 추가
    if (data && typeof data === "object") {
      const { roomId, ...msgData } = data;
      // 같은 방 안에 있는 사용자들에게 메시지 브로드캐스트 (본인 제외)
      socket.to(roomId).emit("receive_dating_message", {
        ...msgData,
        timestamp: msgData.timestamp || new Date(),
      });
    }
  });

  // 실시간 친구 요청 전송 알림
  socket.on(
    "send_friend_request",
    ({ roomId, requesterPetName, receiverPetName, requestId }) => {
      // 본인을 제외한 방 안의 사람들에게 전송 (1:1 방이므로 사실상 상대방에게만 감)
      socket.to(roomId).emit("receive_friend_request", {
        requesterPetName,
        receiverPetName,
        requestId,
      });
    },
  );

  // 실시간 교배 요청 전송 알림
  socket.on(
    "send_breeding_request",
    ({ roomId, requesterPetName, receiverPetName }) => {
      socket.to(roomId).emit("receive_breeding_request", {
        requesterPetName,
        receiverPetName,
      });
    },
  );

  // 교배 요청 수락 (수락 시 방 전체에 리다이렉트 지시)
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

  // 교배 요청 거절
  socket.on(
    "reject_breeding_request",
    ({ roomId, requesterPetName, receiverPetName }) => {
      socket.to(roomId).emit("breeding_rejected", {
        requesterPetName,
        receiverPetName,
      });
    },
  );

  // 교배 최종 성사(한 명이 버튼 클릭 후 API 응답 성공 시)
  socket.on("child_created", ({ roomId, childPet }) => {
    // 버튼을 안 누른 상대방에게 전달
    socket.to(roomId).emit("receive_child_created", { childPet });
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
  // 공동육아방(ChildRoom) 입장/퇴장 관리
  socket.on("get_room_participants", async ({ childId }, callback) => {
    try {
      const roomName = `child_room_${childId}`;
      const sockets = await io.in(roomName).fetchSockets();
      if (typeof callback === "function") {
        callback(sockets.length);
      }
    } catch (err) {
      console.error("get_room_participants error:", err);
      if (typeof callback === "function") callback(0);
    }
  });

  socket.on("join_child_room", async ({ childId, petId, petName }) => {
    const roomName = `child_room_${childId}`;
    socket.join(roomName);

    // 소켓 객체에 정보 저장 (연결 끊김 대비 및 역할 배정용)
    socket.childRoomId = childId;
    socket.petId = petId;
    socket.childPetName = petName;

    // 이 방에 이미 접속한 소켓들 확인 (나 포함 인원수가 1보다 크면 상대가 있는 것)
    const sockets = await io.in(roomName).fetchSockets();
    const spouseInRoom = sockets.length > 1;

    // 온라인 유저 목록 (activeUsers 맵에서 키만 추출)
    const onlineUsers = Array.from(activeUsers.keys());

    // 부화 진행도 초기화 (이미 진행 중이 아니라면 0으로 시작)
    if (!hatchProgressMap.has(roomName)) {
      hatchProgressMap.set(roomName, 0);
    }

    // 막 진입한 본인에게 방 상태와 온라인 상태, 그리고 현재 부화 진행도를 함께 전송
    socket.emit("child_room_status", {
      isSpouseInRoom: spouseInRoom,
      onlineUsers: onlineUsers,
      hatchProgress: hatchProgressMap.get(roomName),
    });

    // 방에 있는 배우자(기존 인원)에게 내가 입장했음을 브로드캐스트
    socket.to(roomName).emit("spouse_entered_child_room", petName);
  });

  socket.on("leave_child_room", ({ childId, petName }) => {
    const roomName = `child_room_${childId}`;
    socket.leave(roomName);
    socket.to(roomName).emit("spouse_left_child_room", petName);

    // 상황극 준비 상태 제거
    cleanupRolePlayReady(childId);

    // 🍼 추가: 분유 게임 데이터 클린업
    feedGameMap.delete(roomName);
    bathGameMap.delete(roomName); // 🛁 목욕 게임 데이터도 함께 클린업🐾👣

    delete socket.childRoomId;
    delete socket.childPetName;
  });

  // 🍼/🛁 공통: 미니게임 완료 후 방 전체 육아방 복귀 알림
  socket.on("child_action_finish", ({ childId }) => {
    const roomName = `child_room_${childId}`;
    io.in(roomName).emit("child_action_finished");
  });

  // 부화 탭(클릭) 이벤트 처리
  socket.on("hatch_tap", ({ childId }) => {
    const roomName = `child_room_${childId}`;
    let progress = hatchProgressMap.get(roomName) || 0;

    // 한 번 클릭당 2%씩 증가 (총 50번 클릭 필요)
    progress = Math.min(progress + 2, 100);
    hatchProgressMap.set(roomName, progress);

    // 해당 방 전체에 진행도 전파
    io.in(roomName).emit("hatch_progress_updated", { progress });
  });

  // 부화 시작 요청 (한 명이 누르면 전체 시작)
  socket.on("hatch_start_request", ({ childId }) => {
    const roomName = `child_room_${childId}`;
    hatchProgressMap.set(roomName, 0); // 시작 시 진행도 리셋
    io.in(roomName).emit("hatch_started", { duration: 30 }); // 30초 제한 시간 부여
  });

  // 부화 초기화 (리셋 버튼용 혹은 재시작용)
  socket.on("hatch_reset", ({ childId }) => {
    const roomName = `child_room_${childId}`;
    hatchProgressMap.set(roomName, 0);
    io.in(roomName).emit("hatch_progress_updated", { progress: 0 });
  });

  // 협동 이름 변경 요청
  socket.on(
    "child_pet_rename_request",
    ({ childId, newName, requesterName }) => {
      const roomName = `child_room_${childId}`;
      // 배우자에게만 제안 알림 전송
      socket
        .to(roomName)
        .emit("child_pet_rename_proposed", { newName, requesterName });
    },
  );

  // 이름 변경 응답 (동의/거절)
  socket.on("child_pet_rename_response", ({ childId, approved, newName }) => {
    const roomName = `child_room_${childId}`;
    if (approved) {
      // 승인 시 방 전체에 이름 변경 확정 알림 (DB 처리는 프론트에서 API 호출 권장하나 실시간 동기화 우선 전송)
      io.in(roomName).emit("child_pet_rename_approved", { newName });
    } else {
      // 거절 시 제안자에게 거절 알림
      socket.to(roomName).emit("child_pet_rename_rejected");
    }
  });

  // 자식 펫 작별(파양) 요청
  socket.on("child_pet_farewell_request", ({ childId, requesterName }) => {
    const roomName = `child_room_${childId}`;
    // 배우자에게만 제안 알림 전송
    socket.to(roomName).emit("child_pet_farewell_proposed", { requesterName });
  });

  // 작별 응답 (동의/거절)
  socket.on("child_pet_farewell_response", async ({ childId, approved }) => {
    const roomName = `child_room_${childId}`;
    if (approved) {
      // 승인 시 방 전체에 작별 확정 알림
      // 실제 DB 삭제(abandonPet)는 클라이언트 중 한쪽에서 API를 호출하도록 구현
      io.in(roomName).emit("child_pet_farewell_approved");
    } else {
      // 거절 시 제안자에게 거절 알림
      socket.to(roomName).emit("child_pet_farewell_rejected");
    }
  });

  // 자식 펫 액션(밥, 씻기, 놀이) 페이지 이동 요청
  socket.on(
    "child_action_request",
    ({ childId, actionType, requesterName }) => {
      const roomName = `child_room_${childId}`;
      // 배우자에게만 제안 알림 전송
      socket
        .to(roomName)
        .emit("child_action_proposed", { actionType, requesterName });
    },
  );

  // 액션 페이지 이동 응답 (동의/거절)
  socket.on("child_action_response", ({ childId, approved, actionType }) => {
    const roomName = `child_room_${childId}`;
    if (approved) {
      // 승인 시 방 전체에 강제 이동 알림 (sync)
      io.in(roomName).emit("child_action_sync", { actionType });
    } else {
      // 거절 시 제안자에게 거절 알림
      socket.to(roomName).emit("child_action_rejected", { actionType });
    }
  });

  // 액션 페이지 활동 완료 (양측 동시 복귀 유도)
  socket.on("child_action_finish", ({ childId }) => {
    const roomName = `child_room_${childId}`;
    io.in(roomName).emit("child_action_finished");
  });

  // 특정 방의 참가자 수 반환
  socket.on("get_room_participants", async ({ childId }, callback) => {
    const roomName = `child_room_${childId}`;
    const sockets = await io.in(roomName).fetchSockets();
    if (callback) callback(sockets.length);
  });

  // --- 상황극(Role-Play) 관련 소켓 로직 ---

  // 상황극 페이지 전용 입장 이벤트
  // childRoom 과 별개의 play_room 으로 관리하여 타이밍 충돌 방지
  socket.on("join_play_room", async ({ childId, petId, petName }) => {
    const roomName = `play_room_${childId}`;

    // 소켓 정보 저장
    socket.petId = petId;
    socket.playRoomId = childId;
    socket.join(roomName);

    const sockets = await io.in(roomName).fetchSockets();
    console.log(
      `[PLAY] ${petName}(${petId}) joined ${roomName}. Total: ${sockets.length}`,
    );

    if (sockets.length < 2) {
      // 아직 혼자 — 대기 상태 알림
      socket.emit("play_room_waiting");
      return;
    }

    // ✅ 중복 시작 차단: 이미 AI 시작된 방이맴 스킵 (race condition 해결)
    if (playRoomStartedSet.has(roomName)) {
      console.log(`[PLAY] ${roomName} already started. Skipping.`);
      return;
    }
    playRoomStartedSet.add(roomName); // 선점 등록

    // 참가자 목록 수집
    const participantIds = sockets
      .map((s) => String(s.petId))
      .filter((id) => id && id !== "undefined");
    console.log(
      `[PLAY] All ready! Participants: ${JSON.stringify(participantIds)}`,
    );

    // 참가자 목록 및 라운드 저장
    roomParticipantsMap.set(roomName, participantIds);
    roomChatRoundMap.set(roomName, new Map());

    try {
      // AI가 시나리오 + 역할 + 오프닝 멘트를 한 번에 생성
      const aiResult = await generateRolePlay(participantIds);
      console.log(`[PLAY] AI scenario:`, aiResult.scenario?.title);

      // 시나리오를 방에 저장해두어 채팅 채점 시 참조
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
      console.error("[PLAY] OpenAI Error:", err.message);
      // 폴백: 에러 시 방 선점 해제 후 대기 상태로 복구
      playRoomStartedSet.delete(roomName);
      io.in(roomName).emit("role_play_message", {
        senderId: "child_pet",
        senderName: "자식 펫 🐾",
        content:
          "앗, 상황극을 준비하다가 실수했어요! 잠시 후 다시 시도해볼게요 😅",
        role: "아기 펫",
        timestamp: new Date(),
      });
    }
  });

  // 상황극 방 퇴장 — 상대방에게 알리고 상태 초기화
  socket.on("leave_play_room", async ({ childId, petName }) => {
    const roomName = `play_room_${childId}`;
    socket.leave(roomName);
    delete socket.playRoomId;

    setTimeout(async () => {
      // 500ms 지연 후 현재 룸 소켓 다시 확인 (Strict Mode 대응)
      const sockets = await io.in(roomName).fetchSockets();
      const isPetStillInRoom = sockets.some(
        (s) => String(s.petId) === String(socket.petId),
      );
      if (!isPetStillInRoom) {
        io.in(roomName).emit("play_partner_left", {
          name: petName || "상대방",
        });
        if (sockets.length === 0) {
          playRoomStartedSet.delete(roomName);
          roomParticipantsMap.delete(roomName);
          roomChatRoundMap.delete(roomName);
          console.log(`[PLAY] ${roomName} fully cleared.`);
        }
      }
    }, 500);
  });

  // 상황극 채팅: 1인 1회 발언 → 아기 펫 반응 → 다음 라운드
  socket.on(
    "role_play_chat",
    async ({ childId, senderId, senderName, content, role, scenarioId }) => {
      const roomName = `play_room_${childId}`;
      // roomScenarioMap에서 시나리오 조회 (고정 목록 없음)
      const scenario = roomScenarioMap.get(roomName);
      const round = roomChatRoundMap.get(roomName);
      if (!round) return;

      // 이미 이번 라운드에 발언한 경우 차단
      if (round.has(String(senderId))) {
        socket.emit("play_already_spoke");
        return;
      }

      // 발언 등록 & 방 전체에 메시지 전달
      round.set(String(senderId), { role, name: senderName, content });
      io.in(roomName).emit("role_play_message", {
        senderId,
        senderName,
        content,
        role,
        timestamp: new Date(),
      });

      if (!scenario) return;

      // 두 명 모두 발언했는지 확인
      const participants = roomParticipantsMap.get(roomName) || [];
      const allSpoke =
        participants.length >= 2 && participants.every((pid) => round.has(pid));

      if (allSpoke) {
        const roundMessages = Array.from(round.values());
        const roundSnapshot = new Map(round); // 채점용 스냅샷
        roomChatRoundMap.set(roomName, new Map()); // 즉시 라운드 초기화

        // 채점 (평균) - 두 발언을 평가해 공유 점수 산출
        let sharedScore = 0;
        try {
          const scores = await Promise.all(
            participants.map(async (pid) => {
              const msg = roundSnapshot.get(pid);
              if (!msg) return 0;
              return await scoreChat(msg.content, msg.role, msg.name, scenario);
            }),
          );
          const valid = scores.filter((s) => s > 0);
          sharedScore = valid.length
            ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length)
            : 0;
          if (sharedScore > 0) {
            io.in(roomName).emit("play_round_score", { score: sharedScore });
          }
        } catch (err) {
          console.error("[PLAY] Scoring error:", err.message);
        }

        // 아기 펫 반응 생성
        try {
          const petReply = await generatePetReply(roundMessages, scenario);
          io.in(roomName).emit("role_play_message", {
            senderId: "child_pet",
            senderName: "자식 펫 🐾",
            content: petReply,
            role: scenario?.childRole || "아기 펫",
            timestamp: new Date(),
          });
          io.in(roomName).emit("play_round_start"); // 다음 라운드 시작 신호
        } catch (err) {
          console.error("[PLAY] Pet reply error:", err.message);
          io.in(roomName).emit("play_round_start"); // 에러 시에도 다음 라운드 진행
        }
      } else {
        socket.emit("play_waiting_other"); // 상대방 차례를 기다리는 중
      }
    },
  );

  // 상황극 종료: DB 능력치 적용 후 방 전체에 결과 브로드캐스트
  socket.on("finish_play_room", async ({ childId, totalScore, roundCount }) => {
    const roomName = `play_room_${childId}`;

    // 이미 종료 처리된 방이면 스킵
    if (!playRoomStartedSet.has(roomName)) return;

    // 방 전체에 종료 중 알림
    io.in(roomName).emit("play_game_ending");

    // 점수 정규화 (avgScore 0~10)
    const cnt = Math.max(1, roundCount || 1);
    const avg = Math.max(0, Math.min(10, totalScore / cnt));
    const t = avg / 10;
    const calc = (lo, hi) => Math.round(lo + (hi - lo) * t);

    const changes = {
      stress: calc(5, -30),
      empathy: calc(-3, 20),
      affection: calc(-2, 15),
      altruism: calc(0, 10),
      knowledge: calc(-1, 12),
      logic: calc(-2, 10),
      health_hp: calc(-5, 10),
      hunger: calc(5, -10),
      cleanliness: calc(0, -5),
      exp: Math.round(5 + avg * 6),
    };

    try {
      const { pool } = require("./database/database");
      await pool.query(
        `
        UPDATE pets SET
          stress      = GREATEST(LEAST(stress      + $2,  100), 0),
          empathy     = GREATEST(LEAST(empathy     + $3,  100), 0),
          affection   = GREATEST(LEAST(affection   + $4,  100), 0),
          altruism    = GREATEST(LEAST(altruism    + $5,  100), 0),
          knowledge   = GREATEST(LEAST(knowledge   + $6,  100), 0),
          logic       = GREATEST(LEAST(logic       + $7,  100), 0),
          health_hp   = GREATEST(LEAST(health_hp   + $8,  100), 0),
          hunger      = GREATEST(LEAST(hunger      + $9,  100), 0),
          cleanliness = GREATEST(LEAST(cleanliness + $10, 100), 0),
          exp         = exp + $11
        WHERE id = $1
      `,
        [
          childId,
          changes.stress,
          changes.empathy,
          changes.affection,
          changes.altruism,
          changes.knowledge,
          changes.logic,
          changes.health_hp,
          changes.hunger,
          changes.cleanliness,
          changes.exp,
        ],
      );

      // 상태 초기화
      playRoomStartedSet.delete(roomName);
      roomParticipantsMap.delete(roomName);
      roomChatRoundMap.delete(roomName);
      roomScenarioMap.delete(roomName);
      console.log(
        `[PLAY] ${roomName} finished. avgScore=${Math.round(avg * 10)}`,
      );

      // 결과를 방 전체에 브로드캐스트
      io.in(roomName).emit("play_game_finished", {
        totalScore,
        statChanges: { ...changes, avgScore: Math.round(avg * 10) },
      });
    } catch (err) {
      console.error("[PLAY] finish error:", err.message);
      socket.emit("play_game_error", {
        message: "게임 종료 처리에 실패했습니다.",
      });
    }
  });

  // 상황극 클린업 함수
  const cleanupRolePlayReady = (childId) => {
    const roomName = `child_room_${childId}`;
    const readySet = rolePlayReadyMap.get(roomName);
    if (readySet) {
      readySet.delete(socket.petId);
      if (readySet.size === 0) rolePlayReadyMap.delete(roomName);
    }
  };

  // -------------------------------------------------------------
  // 🍼 분유주기(Feed Game) 관련 소켓 로직 (PlayRoom 방식 적용)
  // -------------------------------------------------------------

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

    if (feedRoomStartedSet.has(roomName)) {
      const game = feedGameMap.get(roomName);
      if (game) {
        // 이미 진행 중인 방이라면 새로운 소켓에 현재 상태 전송
        socket.emit("feed_game_started", {
          hint: game.hint,
          baseSelectorId: game.participants[0],
          toppingSelectorId: game.participants[1],
        });
        if (game.ingredients.base) {
          socket.emit("ingredient_selected", {
            role: "base",
            ingredientId: game.ingredients.base,
          });
        }
        if (game.ingredients.topping) {
          socket.emit("ingredient_selected", {
            role: "topping",
            ingredientId: game.ingredients.topping,
          });
        }
      }
      return;
    }
    feedRoomStartedSet.add(roomName);

    try {
      // 둘 다 모였으므로 게임 초기화 후 전체 브로드캐스트
      const hint = await feedGameService.generateCookingHint();
      // Strict Mode 재접속 시 아이디 변경 방지를 위해 petId 사용
      const baseSelectorId = String(sockets[0].petId);
      const toppingSelectorId = String(sockets[1].petId);

      feedGameMap.set(roomName, {
        hint,
        ingredients: {},
        participants: [baseSelectorId, toppingSelectorId].filter(Boolean),
      });

      io.in(roomName).emit("feed_game_started", {
        hint,
        baseSelectorId,
        toppingSelectorId,
      });
    } catch (err) {
      console.error("[FEED] init error:", err);
      feedRoomStartedSet.delete(roomName);
    }
  });

  socket.on("leave_feed_room", async ({ childId, petName }) => {
    const roomName = `feed_room_${childId}`;
    socket.leave(roomName);
    delete socket.feedRoomId;

    setTimeout(async () => {
      const sockets = await io.in(roomName).fetchSockets();
      const isPetStillInRoom = sockets.some(
        (s) => String(s.petId) === String(socket.petId),
      );
      if (!isPetStillInRoom) {
        io.in(roomName).emit("spouse_left_child_room", petName || "배우자");
        if (sockets.length === 0) {
          feedRoomStartedSet.delete(roomName);
          feedGameMap.delete(roomName);
        }
      }
    }, 500);
  });

  socket.on(
    "select_ingredient",
    async ({ childId, petId, role, ingredientId, petName }) => {
      const roomName = `feed_room_${childId}`;
      const game = feedGameMap.get(roomName);
      if (!game) return;

      game.ingredients[role] = ingredientId;

      io.in(roomName).emit("ingredient_selected", {
        role,
        ingredientId,
        petName,
      });

      // 양쪽 재료(베이스와 토핑)를 모두 선택했으면 결과 평가 진행
      if (game.ingredients.base && game.ingredients.topping) {
        try {
          // 중복 평가 방지를 위해 재료를 지워두거나 진행상태 플래그 사용 가능
          const recipe = {
            base: game.ingredients.base,
            topping: game.ingredients.topping,
          };

          io.in(roomName).emit("feed_game_evaluating");
          const result = await feedGameService.evaluateCooking(
            game.hint,
            recipe,
          );

          const { pool } = require("./database/database");
          const changes = {
            hunger: 100,
            affection: result.score > 80 ? 20 : result.score > 50 ? 10 : 5,
            healthHp: result.score > 60 ? 10 : 0,
            exp: Math.round(result.score * 1.5),
          };

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
          feedGameMap.delete(roomName);
          feedRoomStartedSet.delete(roomName);
        } catch (error) {
          console.error("Feed Game Evaluate Error:", error);
          io.in(roomName).emit("feed_game_error", {
            message: "결과 처리 중 문제가 발생했습니다.",
          });
        }
      }
    },
  );

  // -------------------------------------------------------------
  // 🛁 목욕시키기(Bath Game) 스무고개 관련 소켓 로직 (PlayRoom 방식 적용)
  // -------------------------------------------------------------

  socket.on("join_bath_room", async ({ childId, petId, petName }) => {
    const roomName = `bath_room_${childId}`;
    socket.petId = petId;
    socket.bathRoomId = childId;
    socket.join(roomName);
    console.log(
      `[BATH-DEBUG] join_bath_room: room=${roomName}, petId=${petId}, socketId=${socket.id}`,
    );

    const sockets = await io.in(roomName).fetchSockets();
    console.log(
      `[BATH-DEBUG] sockets in room: ${sockets.length}, startedSet has: ${bathRoomStartedSet.has(roomName)}, gameMap has: ${!!bathGameMap.get(roomName)}`,
    );

    if (bathRoomStartedSet.has(roomName)) {
      const game = bathGameMap.get(roomName);
      if (game && !game.isFinished) {
        console.log(`[BATH-DEBUG] Re-sending existing game state`);
        socket.emit("bath_game_started", {
          hint: game.hint,
          currentTurnPetId: game.currentTurnPetId,
        });
        game.questions.forEach((q) => {
          socket.emit("bath_question_answered", q);
        });
      } else {
        console.log(
          `[BATH-DEBUG] startedSet=true but game is null/finished, waiting for init broadcast`,
        );
      }
      return;
    }
    bathRoomStartedSet.add(roomName);

    try {
      const participantIds = sockets
        .map((s) => (s.petId ? String(s.petId) : null))
        .filter(Boolean);
      console.log(
        `[BATH-DEBUG] Initializing game... participants=${JSON.stringify(participantIds)}`,
      );
      const { word, hint } = await bathGameService.initializeGame();
      console.log(
        `[BATH-DEBUG] Game initialized! word=${word}, hint=${hint.substring(0, 30)}...`,
      );

      bathGameMap.set(roomName, {
        word,
        hint,
        questions: [],
        turnCount: 0,
        isFinished: false,
        participants: participantIds,
        currentTurnPetId: participantIds[0],
      });

      const socketsNow = await io.in(roomName).fetchSockets();
      console.log(
        `[BATH-DEBUG] Broadcasting bath_game_started to ${socketsNow.length} sockets in room`,
      );

      io.in(roomName).emit("bath_game_started", {
        hint,
        currentTurnPetId: participantIds[0],
      });
    } catch (err) {
      console.error("[BATH] init error:", err);
      bathRoomStartedSet.delete(roomName);
    }
  });

  socket.on("leave_bath_room", async ({ childId, petName }) => {
    const roomName = `bath_room_${childId}`;
    socket.leave(roomName);
    delete socket.bathRoomId;

    setTimeout(async () => {
      const sockets = await io.in(roomName).fetchSockets();
      const isPetStillInRoom = sockets.some(
        (s) => String(s.petId) === String(socket.petId),
      );
      if (!isPetStillInRoom) {
        io.in(roomName).emit("bath_partner_left", petName || "배우자");
        bathRoomStartedSet.delete(roomName);
        bathGameMap.delete(roomName);
      }
    }, 500);
  });

  socket.on(
    "ask_bath_question",
    async ({ childId, question, petName, petId }) => {
      const roomName = `bath_room_${childId}`;
      const game = bathGameMap.get(roomName);
      if (!game || game.isFinished) return;

      // 턴 체크 제거 - 혼자서도, 2인에서도 자유롭게 질문 가능

      try {
        const answer = await bathGameService.answerQuestion(
          game.word,
          question,
        );
        const questionLog = { petName, question, answer };
        game.questions.push(questionLog);
        game.turnCount++;

        io.in(roomName).emit("bath_question_answered", questionLog);

        const currentIndex = game.participants.indexOf(String(petId));
        const nextIndex = (currentIndex + 1) % game.participants.length;
        game.currentTurnPetId = game.participants[nextIndex];

        io.in(roomName).emit("bath_turn_changed", {
          currentTurnPetId: game.currentTurnPetId,
        });

        if (game.turnCount >= 20) {
          game.isFinished = true;
          const result = bathGameService.evaluateResult(false, 20);
          io.in(roomName).emit("bath_game_result", {
            ...result,
            word: game.word,
            changes: { exp: 0, affection: 0, cleanliness: 100 },
          });
          bathGameMap.delete(roomName);
          bathRoomStartedSet.delete(roomName);
        }
      } catch (error) {
        console.error("Bath Question Error:", error);
      }
    },
  );

  socket.on("guess_bath_word", async ({ childId, guess, petName }) => {
    const roomName = `bath_room_${childId}`;
    const game = bathGameMap.get(roomName);
    if (!game || game.isFinished) return;

    const normalizedGuess = guess.replace(/\s/g, "").toLowerCase();
    const normalizedWord = game.word.replace(/\s/g, "").toLowerCase();

    if (normalizedGuess === normalizedWord) {
      game.isFinished = true;
      const result = bathGameService.evaluateResult(true, game.turnCount + 1);
      const { pool } = require("./database/database");

      const t = Math.max(0, Math.min(100, result.score)) / 100;
      const changes = {
        cleanliness: 100,
        affection: Math.round(5 + 15 * t),
        intelligence: 10,
        exp: Math.round(result.score),
      };

      await pool.query(
        `UPDATE pets SET 
          cleanliness = 100, 
          affection = LEAST(affection + $2, 100),
          knowledge = LEAST(knowledge + $3, 100),
          exp = exp + $4
        WHERE id = $1`,
        [childId, changes.affection, changes.intelligence, changes.exp],
      );

      io.in(roomName).emit("bath_game_result", {
        ...result,
        word: game.word,
        changes,
      });
      bathGameMap.delete(roomName);
      bathRoomStartedSet.delete(roomName);
    } else {
      io.in(roomName).emit("bath_wrong_guess", { petName, guess });
    }
  });

  // 순수 소켓 접속 종료 (창 닫힘 등)
  socket.on("disconnect", async () => {
    // 상황극 준비 상태 제거
    if (socket.childRoomId) cleanupRolePlayReady(socket.childRoomId);

    // 💡 1. 채팅방 비정상 종료 대응 (DB 퇴장 처리)
    const { roomId, petName: roomPetName } = socket;
    if (roomId && roomPetName) {
      try {
        const { pool } = require("./database/database");
        const checkResult = await pool.query(
          "SELECT * FROM dating_rooms WHERE id = $1",
          [roomId],
        );

        if (checkResult.rows.length > 0) {
          const room = checkResult.rows[0];
          let updateQuery = "";
          let shouldUpdate = false;

          if (room.creator_pet_name === roomPetName) {
            if (room.participant_pet_name) {
              updateQuery =
                "UPDATE dating_rooms SET creator_pet_name = $1, participant_pet_name = NULL, status = 'waiting' WHERE id = $2";
              await pool.query(updateQuery, [
                room.participant_pet_name,
                roomId,
              ]);
              shouldUpdate = true;
            } else {
              await pool.query("DELETE FROM dating_rooms WHERE id = $1", [
                roomId,
              ]);
              shouldUpdate = true;
            }
          } else if (room.participant_pet_name === roomPetName) {
            updateQuery =
              "UPDATE dating_rooms SET participant_pet_name = NULL, status = 'waiting' WHERE id = $1";
            await pool.query(updateQuery, [roomId]);
            shouldUpdate = true;
          }

          if (shouldUpdate) {
            socket.to(roomId).emit("receive_dating_message", {
              sender: "System",
              message: `${roomPetName}님이 연결이 끊겨 퇴장했습니다.`,
              isSystem: true,
            });
            io.emit("rooms_updated");
          }
        }
      } catch (err) {
        console.error("Dating room disconnect cleanup error:", err);
      }
    }

    // 💡 2. 공동육아방 비정상 종료 대응
    const { childRoomId, childPetName, playRoomId, feedRoomId, bathRoomId } =
      socket;
    if (childRoomId && childPetName) {
      const roomName = `child_room_${childRoomId}`;
      socket.to(roomName).emit("spouse_left_child_room", childPetName);
    }

    // 미니게임 방 비정상 (새로고침 등) 강제 종료 시 startedSet 초기화 및 잔류 인원 알림
    const cleanupMiniGame = async (
      roomId,
      namespace,
      startedSet,
      gameMap,
      droppedPetName,
    ) => {
      if (!roomId) return;
      const roomName = `${namespace}_${roomId}`;
      const remaining = await io.in(roomName).fetchSockets();
      if (remaining.length === 0) {
        startedSet.delete(roomName);
        if (gameMap) gameMap.delete(roomName);
      } else {
        // 남은 인원이 있을 경우 상대방 팅김 알림 및 방 파기
        io.in(roomName).emit("spouse_left_child_room", droppedPetName);
        startedSet.delete(roomName);
        if (gameMap) gameMap.delete(roomName);
      }
    };

    const droppedPetName =
      socketToPetName.get(socket.id) || childPetName || "배우자";

    cleanupMiniGame(
      playRoomId,
      "play_room",
      playRoomStartedSet,
      roomParticipantsMap,
      droppedPetName,
    );
    cleanupMiniGame(
      feedRoomId,
      "feed_room",
      feedRoomStartedSet,
      feedGameMap,
      droppedPetName,
    );
    cleanupMiniGame(
      bathRoomId,
      "bath_room",
      bathRoomStartedSet,
      bathGameMap,
      droppedPetName,
    );

    // 💡 3. 접속 종료 시 Map에서 해당 세션 정보 제거 및 온라인 유저 목록 갱신
    const petName = socketToPetName.get(socket.id);
    if (petName) {
      const sockets = activeUsers.get(petName);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          activeUsers.delete(petName);
        }
      }
      socketToPetName.delete(socket.id);

      // 누군가 아예 모든 탭을 끄고 나갔으면 온라인 목록 바로 브로드캐스트 갱신
      io.emit("online_users_list", Array.from(activeUsers.keys()));
    }

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

const friendRoutes = require("./routes/friendRoutes");
app.use("/api/friends", friendRoutes);

// --- 5분마다 모든 펫의 배고픔(hunger) 1씩 감소 스케줄러 --- //
setInterval(async () => {
  try {
    const { pool } = require("./database/database");
    await pool.query(
      "UPDATE pets SET hunger = GREATEST(0, hunger - 1) WHERE hunger > 0",
    );
    console.log("🕒 [Scheduler] 모든 펫의 허기 수치가 1 감소했습니다.");
  } catch (err) {
    console.error("🕒 [Scheduler] 허기 감소 스케줄러 작업 중 오류:", err);
  }
}, 300000); // 5분 = 300,000ms
// ----------------------------------------------------- //

const PORT = process.env.PORT || 8000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 서버(Socket 포함)가 포트 ${PORT}에서 작동 중입니다.`);
});
