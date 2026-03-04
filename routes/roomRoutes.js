const express = require("express");
const router = express.Router();
const roomController = require("../controllers/roomController");

// 로그인 토큰 인증 미들웨어를 거쳐야 방 관련 API를 사용할 수 있게 합니다.
const {
  authenticateToken: authMiddleware,
} = require("../middlewares/authMiddleware");

// 전체 채팅방 목록 조회 (LoungePage 등)
router.get("/rooms", authMiddleware, roomController.getRooms);

// 특정 채팅방 정보 상세 조회
router.get("/rooms/:roomId", authMiddleware, roomController.getRoomInfo);

// 새 채팅방 만들기
router.post("/rooms", authMiddleware, roomController.createRoom);

// 특정 채팅방 참여 (조인)
router.post("/rooms/:roomId/join", authMiddleware, roomController.joinRoom);

// 특정 채팅방 퇴장 (리브)
router.post("/rooms/:roomId/leave", authMiddleware, roomController.leaveRoom);

module.exports = router;
