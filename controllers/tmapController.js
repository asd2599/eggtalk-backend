// //* [Added Code] Tmap API 연동 컨트롤러 (도보 길찾기)
const axios = require('axios');

exports.getPedestrianPath = async (req, res) => {
  try {
    const { startX, startY, endX, endY, startName, endName } = req.query;

    if (!startX || !startY || !endX || !endY) {
      return res.status(400).json({
        success: false,
        error: 'startX, startY, endX, endY 파라미터가 필요합니다.',
      });
    }

    const tmapApiKey = process.env.TMAP_API_KEY;
    if (!tmapApiKey) {
      return res.status(500).json({
        success: false,
        error: '서버에 TMAP_API_KEY가 설정되지 않았습니다.',
      });
    }

    // Tmap 도보 길찾기 API (POST 요청)
    const options = {
      method: 'POST',
      url: 'https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1&format=json',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        appKey: tmapApiKey,
      },
      data: {
        startX: String(startX),
        startY: String(startY),
        endX: String(endX),
        endY: String(endY),
        reqCoordType: 'WGS84GEO',
        resCoordType: 'WGS84GEO',
        startName: startName || '출발지',
        endName: endName || '도착지',
      },
    };

    const response = await axios(options);
    
    // Tmap에서 반환한 GeoJSON FeatureCollection 중 LineString 좌표 추출
    const features = response.data.features || [];
    let pathCoordinates = [];
    
    // //* [Added Code] 전체 도보 거리(m)와 소요 시간(초) 추출
    let totalDistance = 0;
    let totalTime = 0;

    if (features.length > 0 && features[0].properties) {
      totalDistance = features[0].properties.totalDistance || 0;
      totalTime = features[0].properties.totalTime || 0;
    }

    features.forEach((feature) => {
      const geometry = feature.geometry;
      if (geometry.type === 'LineString') {
        geometry.coordinates.forEach((coord) => {
          // GeoJSON은 [경도(lng), 위도(lat)] 순서
          pathCoordinates.push({ lat: coord[1], lng: coord[0] });
        });
      }
    });

    res.status(200).json({
      success: true,
      result: {
        path: pathCoordinates,
        totalDistance,
        totalTime,
        rawFeatureCollection: response.data,
      },
    });
  } catch (error) {
    console.error('[Tmap Pedestrian API Error]', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.error?.message || 'Tmap API 연동 중 오류가 발생했습니다.',
    });
  }
};
