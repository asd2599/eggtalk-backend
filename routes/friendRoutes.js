const express = require("express");
const router = express.Router();
const friendController = require("../controllers/friendController");
const { authenticateToken } = require("../middlewares/authMiddleware");

/**
 * @swagger
 * tags:
 *   name: Friends
 *   description: 친구 관련 API (요청, 수락, 거절, 목록)
 */

/**
 * @swagger
 * /friends/request:
 *   post:
 *     summary: "친구 요청 보내기"
 *     description: "특정 유저에게 친구 요청을 보냅니다."
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - receiver_id
 *             properties:
 *               receiver_id:
 *                 type: integer
 *     responses:
 *       201:
 *         description: "성공적으로 친구 요청 보냄"
 *       400:
 *         description: "잘못된 요청 파라미터 또는 자기 자신에게 요청 불가"
 *       404:
 *         description: "존재하지 않는 유저"
 *       409:
 *         description: "이미 친구이거나 친구 요청 진행 중"
 */
router.post("/request", authenticateToken, friendController.requestFriend);

/**
 * @swagger
 * /friends/accept:
 *   put:
 *     summary: "친구 요청 수락"
 *     description: "나에게 온 대기 중인 친구 요청을 수락합니다."
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - request_id
 *             properties:
 *               request_id:
 *                 type: integer
 *                 description: "친구 테이블의 ID PK"
 *     responses:
 *       200:
 *         description: "성공적으로 수락 처리됨"
 *       404:
 *         description: "권한이 없거나 찾을 수 없는 요청"
 */
router.put("/accept", authenticateToken, friendController.acceptFriend);

/**
 * @swagger
 * /friends/reject:
 *   put:
 *     summary: "친구 요청 거절(삭제)"
 *     description: "대기 중인 요청을 거절하거나, 기존 친구를 삭제합니다."
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - request_id
 *             properties:
 *               request_id:
 *                 type: integer
 *                 description: "친구 테이블의 ID PK"
 *     responses:
 *       200:
 *         description: "성공적으로 삭제/거절 처리됨"
 *       404:
 *         description: "권한이 없거나 찾을 수 없는 기록"
 */
router.put("/reject", authenticateToken, friendController.rejectFriend);

/**
 * @swagger
 * /friends:
 *   get:
 *     summary: "내 친구 / 요청 목록 조회"
 *     description: "수락된 친구 목록과 받은/보낸 요청(PENDING) 목록을 반환합니다."
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "조회 성공"
 */
router.get("/", authenticateToken, friendController.getFriends);

module.exports = router;
