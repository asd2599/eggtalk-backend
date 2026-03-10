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
  socket.on("join_child_room", async ({ childId, petName }) => {
    const roomName = `child_room_${childId}`;
    socket.join(roomName);

    // 소켓 객체에 정보 저장 (연결 끊김 대비)
    socket.childRoomId = childId;
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
    delete socket.childRoomId;
    delete socket.childPetName;
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

  // 순수 소켓 접속 종료 (창 닫힘 등)
  socket.on("disconnect", async () => {
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
    const { childRoomId, childPetName } = socket;
    if (childRoomId && childPetName) {
      const roomName = `child_room_${childRoomId}`;
      socket.to(roomName).emit("spouse_left_child_room", childPetName);
    }

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
