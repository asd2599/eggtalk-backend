const express = require('express');
const router = express.Router();
const tmapController = require('../controllers/tmapController');

/**
 * @swagger
 * /api/tmap/pedestrian:
 *   get:
 *     summary: Tmap 도보 경로 탐색
 *     tags:
 *       - Tmap
 *     parameters:
 *       - in: query
 *         name: startX
 *         required: true
 *         schema:
 *           type: number
 *       - in: query
 *         name: startY
 *         required: true
 *         schema:
 *           type: number
 *       - in: query
 *         name: endX
 *         required: true
 *         schema:
 *           type: number
 *       - in: query
 *         name: endY
 *         required: true
 *         schema:
 *           type: number
 *       - in: query
 *         name: startName
 *         required: false
 *         schema:
 *           type: string
 *       - in: query
 *         name: endName
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 도보 궤적 배열
 */
router.get('/tmap/pedestrian', tmapController.getPedestrianPath);

module.exports = router;
