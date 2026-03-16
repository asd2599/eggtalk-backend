const express = require("express");
const router = express.Router();
const messageController = require("../controllers/messageController");
const { authenticateToken } = require("../middlewares/authMiddleware");

/**
 * @swagger
 * tags:
 *   name: Messages
 *   description: 쪽지 관련 API (전송, 조회, 삭제)
 */

/**
 * @swagger
 * /api/messages:
 *   post:
 *     summary: "쪽지 보내기"
 *     tags: [Messages]
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
 *               - content
 *             properties:
 *               receiver_id:
 *                 type: integer
 *               content:
 *                 type: string
 */
router.post("/", authenticateToken, messageController.sendMessage);

/**
 * @swagger
 * /api/messages:
 *   get:
 *     summary: "받은 쪽지 목록 조회"
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 */
router.get("/", authenticateToken, messageController.getReceivedMessages);

/**
 * @swagger
 * /api/messages/{id}/read:
 *   put:
 *     summary: "쪽지 읽음 처리"
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 */
router.put("/:id/read", authenticateToken, messageController.markAsRead);

/**
 * @swagger
 * /api/messages/{id}:
 *   delete:
 *     summary: "쪽지 삭제"
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 */
router.delete("/:id", authenticateToken, messageController.deleteMessage);

module.exports = router;
