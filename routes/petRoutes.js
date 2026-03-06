const express = require("express");
const router = express.Router();
const petController = require("../controllers/petController");
const { authenticateToken } = require("../middlewares/authMiddleware");

/**
 * @swagger
 * tags:
 *   name: Pets
 *   description: 펫 관련 API (조회, 랭킹, 생성, 액션, 채팅, 성향 분석)
 */

/**
 * @swagger
 * /api/pets/my:
 *   get:
 *     summary: "내 펫 정보 조회"
 *     description: "현재 로그인한 사용자의 펫 정보를 가져옵니다."
 *     tags: [Pets]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "성공적으로 펫 정보를 가져옴"
 *       401:
 *         description: "인증 실패 (토큰 없음 또는 유효하지 않음)"
 *       404:
 *         description: "펫 정보를 찾을 수 없음"
 */
// 펫 정보 조회
router.get("/api/pets/my", authenticateToken, petController.getMyPet);

/**
 * @swagger
 * /api/pets/ranking:
 *   get:
 *     summary: "펫 랭킹 조회"
 *     description: "전체 펫을 대상으로 경험치, 레벨 기반 상위 10명을 조회합니다."
 *     tags: [Pets]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "랭킹 조회 성공"
 *       401:
 *         description: "인증 실패"
 */
// 랭킹 조회 (전체 펫 대상 상위 10명)
router.get("/api/pets/ranking", authenticateToken, petController.getRanking);

/**
 * @swagger
 * /api/pets:
 *   post:
 *     summary: "펫 생성"
 *     description: "새로운 펫을 생성합니다."
 *     tags: [Pets]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - type
 *             properties:
 *               name:
 *                 type: string
 *                 description: 펫 이름
 *               type:
 *                 type: string
 *                 description: 펫 종류
 *     responses:
 *       201:
 *         description: "펫 생성 성공"
 *       400:
 *         description: "잘못된 요청"
 *       401:
 *         description: "인증 실패"
 */
// 펫 생성
router.post("/api/pets", authenticateToken, petController.createPet);

/**
 * @swagger
 * /api/pets/action:
 *   post:
 *     summary: "펫 액션 수행"
 *     description: "펫에게 액션(먹이 주기, 놀아주기 등)을 수행하여 상태를 업데이트합니다."
 *     tags: [Pets]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - actionType
 *             properties:
 *               actionType:
 *                 type: string
 *                 description: "수행할 액션 종류 (예: 'FEED', 'PLAY')"
 *                 example: "FEED"
 *     responses:
 *       200:
 *         description: "액션 수행 성공"
 *       400:
 *         description: "잘못된 액션"
 *       401:
 *         description: "인증 실패"
 */
// 펫 상태 업데이트 (액션 수행)
router.post("/api/pets/action", authenticateToken, petController.performAction);

/**
 * @swagger
 * /api/pets/chat:
 *   post:
 *     summary: "펫 채팅"
 *     description: "AI 펫과 채팅을 진행합니다."
 *     tags: [Pets]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *                 description: 사용자의 채팅 메시지
 *     responses:
 *       200:
 *         description: "채팅 응답 성공"
 *       401:
 *         description: "인증 실패"
 */
// 펫 채팅
router.post("/api/pets/chat", authenticateToken, petController.chatWithPet);

/**
 * @swagger
 * /api/pets/analyze-tendency:
 *   post:
 *     summary: "AI 성향 분석"
 *     description: "펫의 채팅, 액션 기록 등을 바탕으로 AI 성향 분석 결과를 도출합니다."
 *     tags: [Pets]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "성향 분석 성공"
 *       401:
 *         description: "인증 실패"
 */
// AI 성향 분석
router.post(
  "/api/pets/analyze-tendency",
  authenticateToken,
  petController.analyzeTendency,
);

/**
 * @swagger
 * /api/pets/gift:
 *   post:
 *     summary: "상대방 펫에게 선물하기"
 *     description: "지정된 다른 펫에게 선물을 주어 능력치를 변화시킵니다."
 *     tags: [Pets]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "성공적으로 선물을 전송함"
 *       400:
 *         description: "잘못된 요청 매개변수"
 *       404:
 *         description: "대상 펫을 찾을 수 없음"
 */
// 펫에게 선물 보내기
router.post("/api/pets/gift", authenticateToken, petController.giftToPet);

/**
 * @swagger
 * /api/pets/auto-comment:
 *   post:
 *     summary: "펫 자동 대화 (침묵 깨기)"
 *     description: "최근 대화 내역을 바탕으로 펫이 자동으로 대화를 유도하는 멘트를 생성합니다."
 *     tags: [Pets]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               lastMessages:
 *                 type: array
 *                 items:
 *                   type: object
 *                 description: 최근 대화 내역 (최대 10개)
 *     responses:
 *       200:
 *         description: "성공적으로 멘트를 생성함"
 *       401:
 *         description: "인증 실패"
 */
// 펫 자동 대화 멘트 생성
router.post(
  "/api/pets/auto-comment",
  authenticateToken,
  petController.getAutoComment,
);

module.exports = router;
