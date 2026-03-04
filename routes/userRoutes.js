const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: 유저 관련 API (회원가입, 로그인)
 */

/**
 * @swagger
 * /signup:
 *   post:
 *     summary: "회원가입"
 *     description: "새로운 유저 계정을 생성합니다."
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - nickname
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               nickname:
 *                 type: string
 *     responses:
 *       201:
 *         description: "성공적으로 유저 생성됨"
 *       400:
 *         description: "잘못된 요청 파라미터"
 */
router.post("/signup", userController.signup);

/**
 * @swagger
 * /login:
 *   post:
 *     summary: "로그인"
 *     description: "유저 인증을 수행하고 JWT 토큰을 발급받습니다."
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: "성공적으로 로그인됨"
 *       401:
 *         description: "인증 실패 (잘못된 이메일 또는 비밀번호)"
 */
router.post("/login", userController.login);

module.exports = router;
