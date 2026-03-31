const express = require("express");
const router = express.Router();
const mafiaController = require("../controllers/mafiaController");
const { authenticateToken: authMiddleware } = require("../middlewares/authMiddleware");

// 방 목록 조회
router.get("/mafia/rooms", authMiddleware, mafiaController.getMafiaRooms);

// 방 생성
router.post("/mafia/rooms", authMiddleware, mafiaController.createMafiaRoom);

// 참여자 정보 조회 (대기실)
router.get("/mafia/rooms/:roomId/participants", authMiddleware, mafiaController.getRoomParticipants);

// 방 참여
router.post("/mafia/rooms/:roomId/join", authMiddleware, mafiaController.joinMafiaRoom);

// 레디 토글
router.post("/mafia/rooms/:roomId/ready", authMiddleware, mafiaController.toggleReady);

// 방 퇴장
router.post("/mafia/rooms/:roomId/leave", authMiddleware, mafiaController.leaveMafiaRoom);

// AI 참가자 추가
router.post("/mafia/rooms/:roomId/ai", authMiddleware, mafiaController.addAiParticipant);

module.exports = router;
