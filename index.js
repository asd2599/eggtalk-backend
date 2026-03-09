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

  // DB 기반 상태 환경에서 통신을 위해서 소켓 Room 에만 입장 (방 관리는 DB에서 이미 끝남)
  socket.on("join_dating_room", ({ roomId, petName }, callback) => {
    // 💡 React StrictMode 등 이중 조인 요청에 의한 다중 시스템 메시지 도배 방지
    if (!socket.rooms.has(roomId)) {
      socket.join(roomId);
      // 비정상 종료(창 닫기 등) 대응을 위해 소켓 객체에 정보 저장
      socket.roomId = roomId;
      socket.petName = petName;

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
        console.error("Disconnect room cleanup error:", err);
      }
    }

    // 💡 2. 접속 종료 시 Map에서 해당 세션 정보 제거
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
