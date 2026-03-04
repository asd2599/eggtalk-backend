const express = require("express");
const router = express.Router();
const petController = require("../controllers/petController");
const { authenticateToken } = require("../middlewares/authMiddleware");

// 펫 정보 조회
router.get("/api/pets/my", authenticateToken, petController.getMyPet);

// 랭킹 조회 (전체 펫 대상 상위 10명)
router.get("/api/pets/ranking", authenticateToken, petController.getRanking);

// 펫 생성
router.post("/api/pets", authenticateToken, petController.createPet);
// 펫 상태 업데이트 (액션 수행)
router.post("/api/pets/action", authenticateToken, petController.performAction);

// 펫 채팅
router.post("/api/pets/chat", authenticateToken, petController.chatWithPet);

// AI 성향 분석
router.post(
  "/api/pets/analyze-tendency",
  authenticateToken,
  petController.analyzeTendency,
);

module.exports = router;
