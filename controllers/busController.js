const axios = require('axios');

const BUS_API_KEY = process.env.BUS_API_KEY;

const busController = {
  getBusPositions: async (req, res) => {
    const { routeId, routeName } = req.query;
    if (!routeId) {
      return res.status(400).json({ error: 'routeId is required' });
    }

    try {
      // //* [Mentor's Tip] 서울 열린데이터 광장 버스 위치 API (Json 형식 지원)
      const url = `http://ws.bus.go.kr/api/rest/buspos/getBusPosByRtid?serviceKey=${BUS_API_KEY}&busRouteId=${routeId}&resultType=json`;
      
      const response = await axios.get(url);
      
      if (!response.data || !response.data.msgBody || !response.data.msgBody.itemList) {
        return res.json([]);
      }

      const items = response.data.msgBody.itemList;
      
      // 프론트엔드 기대 형식으로 변환: { id, lat, lng, plateNo, routeName }
      const formattedBuses = items.map(item => ({
        id: item.vehId, // 차량 고유 ID
        lat: parseFloat(item.tmY), // 위도
        lng: parseFloat(item.tmX), // 경도
        plateNo: item.plainNo, // 차량 번호판
        routeName: routeName || 'Bus'
      }));

      res.json(formattedBuses);
    } catch (error) {
      console.error(`[Bus API Error] routeId: ${routeId}`, error.message);
      res.status(500).json({ error: 'Failed to fetch bus positions' });
    }
  }
};

module.exports = busController;
