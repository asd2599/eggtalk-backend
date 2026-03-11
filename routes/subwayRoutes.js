const express = require('express');
const router = express.Router();
const subwayController = require('../controllers/subwayController');

/**
 * @swagger
 * /api/subway/positions:
 *   get:
 *     summary: 실시간 지하철 위치 정보 조회
 *     tags:
 *       - Subway
 *     parameters:
 *       - in: query
 *         name: line
 *         required: true
 *         description: "지하철 호선명 (예: 1호선, 2호선)"
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 실시간 위경도 및 상태 정보 배열
 */
router.get('/subway/positions', subwayController.getSubwayPositions);
router.get('/bus/positions', subwayController.getBusPositions);

// //* [NEW] [Modified Code] 최단 경로 탐색 API
router.get('/subway/path', subwayController.getSubwayPath);

// //* [NEW] [Modified Code] ODsay 기반 상세 경로 탐색 API
router.get('/subway/search-path', subwayController.searchComplexPath);

// //* [NEW] [Modified Code] ODsay 기반 역 검색 API
router.get('/subway/search-station', subwayController.searchStation);

// //* [NEW] [Modified Code] ODsay 기반 POI 검색 API
router.get('/subway/search-poi', subwayController.searchPOI);

// //* [NEW] [Modified Code] ODsay 기반 상세 선로 데이터 조회 API
router.get('/subway/load-lane', subwayController.getLoadLane);

module.exports = router;
