const express = require('express');
const router = express.Router();
const busController = require('../controllers/busController');

// //* [Modified Code] 버스 위치 정보 API 라우트 등록
router.get('/bus/positions', busController.getBusPositions);

module.exports = router;
