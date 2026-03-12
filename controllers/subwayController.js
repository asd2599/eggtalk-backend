const axios = require('axios');
const {
  SUBWAY_STATION_COORDS_V2,
  STATION_ALIASES,
} = require('../utils/subwayData/coords');
const { SUBWAY_LINE_MAP } = require('../utils/subwayData/lineMap'); // //* [Modified Code] correct path for line map
const { findShortestPath, getDistance } = require('../utils/subwayUtils');
const odsayService = require('../utils/odsayService');

// Simple in-memory cache
const cache = new Map();
const CACHE_TTL = 30000; // 30 seconds

const calculateBearing = (lat1, lng1, lat2, lng2) => {
  const avgLat = (lat1 + lat2) / 2;
  const cosLat = Math.cos((avgLat * Math.PI) / 180);
  const dy = lat2 - lat1;
  const dx = (lng2 - lng1) * cosLat;
  let angle = (Math.atan2(dx, dy) * 180) / Math.PI;
  return (angle + 360) % 360;
};

exports.getSubwayPositions = async (req, res) => {
  const lineName = req.query.line;
  if (!lineName)
    return res.status(400).json({ error: 'Line name is required' });

  const apiKey = process.env.SUBWAY_API_KEY;
  if (!apiKey)
    return res.status(500).json({ error: 'Subway API key not configured' });

  const cacheKey = `subway_${lineName}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    const url = `http://swopenAPI.seoul.go.kr/api/subway/${apiKey}/json/realtimePosition/0/200/${encodeURIComponent(lineName)}`;
    const response = await axios.get(url);

    if (!response.data || !response.data.realtimePositionList) {
      // //* [Modified Code] 응답은 성공했으나 데이터가 없는 경우를 위한 명확한 빈 배열 반환
      const emptyResult = { realtimePositionList: [] };
      cache.set(cacheKey, { timestamp: Date.now(), data: emptyResult });
      return res.json(emptyResult);
    }

    const positions = response.data.realtimePositionList.map((item, index) => {
      const rawStationName = item.statnNm.trim();
      let stationName = rawStationName
        .split('(')[0]
        .trim()
        .replace('종착', '')
        .replace('출발', '')
        .replace('지선', '')
        .trim();

      const aliasName = STATION_ALIASES[stationName] || stationName;
      // //* [Modified Code] 이수역 특수 처리 (7호선은 이수, 나머지는 총신대입구)
      let finalStationName = (stationName === '총신대입구' && lineName === '7호선') ? '이수' : aliasName;

      let stationCoords =
        SUBWAY_STATION_COORDS_V2[lineName]?.[finalStationName] ||
        SUBWAY_STATION_COORDS_V2[lineName]?.[finalStationName + '역'];

      if (!stationCoords) {
        // Fallback search
        for (const line in SUBWAY_STATION_COORDS_V2) {
          stationCoords =
            SUBWAY_STATION_COORDS_V2[line][finalStationName] ||
            SUBWAY_STATION_COORDS_V2[line][finalStationName + '역'];
          if (stationCoords) break;
        }
      }

      let lat = stationCoords ? stationCoords.lat : 37.566229;
      let lng = stationCoords ? stationCoords.lng : 126.981498;
      let angle = 0;

      // Calculate bearing
      let lineStations = SUBWAY_LINE_MAP[lineName];
      if (lineStations && Array.isArray(lineStations)) {
        const currentIndex = lineStations.indexOf(stationName);
        if (currentIndex !== -1) {
          let nextIndex =
            item.updnLine === '0' ? currentIndex - 1 : currentIndex + 1;
          if (lineName === '2호선') {
            nextIndex =
              item.updnLine === '0'
                ? (currentIndex + 1) % lineStations.length
                : (currentIndex - 1 + lineStations.length) %
                  lineStations.length;
          }
          const nextStationName = lineStations[nextIndex];
          const nextCoords =
            nextStationName &&
            (SUBWAY_STATION_COORDS_V2[lineName]?.[nextStationName] ||
              SUBWAY_STATION_COORDS_V2[lineName]?.[nextStationName + '역']);
          if (nextCoords) {
            angle = calculateBearing(lat, lng, nextCoords.lat, nextCoords.lng);
          }
        }
      }

      return {
        id: `${item.trainNo}_${index}`,
        lat,
        lng,
        line: lineName,
        updnLine: item.updnLine,
        angle,
        isExpress: item.directAt === '1',
        trainName: `${item.directAt === '1' ? '[급행] ' : ''}${lineName} ${rawStationName} ${item.trainSttus === '0' ? '진입' : item.trainSttus === '1' ? '도착' : '출발'}`,
      };
    });

    cache.set(cacheKey, { timestamp: Date.now(), data: positions });
    res.json(positions);
  } catch (error) {
    console.error('Subway API Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch subway positions' });
  }
};

exports.getBusPositions = async (req, res) => {
  const { routeId, routeName } = req.query;
  if (!routeId) return res.status(400).json({ error: 'Route ID is required' });

  const apiKey = process.env.BUS_API_KEY;
  if (!apiKey)
    return res.status(500).json({ error: 'Bus API key not configured' });

  const cacheKey = `bus_${routeId}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    const url = `http://ws.bus.go.kr/api/rest/buspos/getBusPosByRtid?serviceKey=${apiKey}&busRouteId=${routeId}&resultType=json`;
    const response = await axios.get(url);

    if (!response.data?.msgBody?.itemList) {
      return res.json([]);
    }

    const items = Array.isArray(response.data.msgBody.itemList)
      ? response.data.msgBody.itemList
      : [response.data.msgBody.itemList];

    const positions = items.map((item) => ({
      id: item.vehId,
      lat: parseFloat(item.tmY),
      lng: parseFloat(item.tmX),
      plateNo: item.plainNo,
      routeName: routeName || 'Unknown',
    }));

    cache.set(cacheKey, { timestamp: Date.now(), data: positions });
    res.json(positions);
  } catch (error) {
    console.error('Bus API Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch bus positions' });
  }
};

/**
 * //* [NEW] [Modified Code] 지하철 경로 탐색 (최단 시간/거리)
 * GET /api/subway/path?start=강남&end=서울역
 */
exports.getSubwayPath = async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) {
    return res.status(400).json({ error: 'Start and end stations are required' });
  }

  try {
    // 1. 내부 다익스트라 엔진을 통한 최단 경로 계산
    const result = findShortestPath(start, end);
    
    // 2. 부가 정보 (ODsay 연동 등) 필요 시 추가 가능
    // //* [Mentor's Tip] 내부 엔진은 좌표 기반 오프라인 계산이며, 
    // //* 실시간 사고/지연 등은 ODsay API 결과를 병합하여 신뢰도를 높일 수 있습니다.
    
    if (!result) {
      return res.status(404).json({ error: 'Path not found' });
    }

    res.json(result);
  } catch (error) {
    console.error('Path Finding Error:', error.message);
    res.status(500).json({ error: 'Internal server error during path finding' });
  }
};

/**
 * //* [NEW] [Modified Code] ODsay 기반 상세 경로 탐색 (도보 포함)
 * GET /api/subway/search-path?sx=127.1&sy=37.5&ex=127.0&ey=37.4
 */
exports.searchComplexPath = async (req, res) => {
  const { sx, sy, ex, ey } = req.query;
  // //* [Modified Code] query string은 항상 문자열이므로 숫자로 명시적 변환
  const searchType = Number(req.query.searchType ?? 0);
  const pathType = Number(req.query.pathType ?? 0);

  if (!sx || !sy || !ex || !ey) {
    return res.status(400).json({ error: 'All coordinates (sx, sy, ex, ey) are required' });
  }

  try {
    const pathData = await odsayService.getPublicTransPath(
      { x: sx, y: sy },
      { x: ex, y: ey },
      searchType,
      pathType,
    );

    // //* [Fixed] pathData가 null(스로틀)일 때 map() 호출로 TypeError 발생하던 버그 수정
    if (!pathData) {
      return res.status(429).json({ error: '요청이 너무 빠릅니다. 잠시 후 다시 시도해주세요.' });
    }

    res.json({ result: { path: pathData.map((p) => p.raw) } });
  } catch (error) {
    console.error('ODsay Search Error:', error.message);
    
    // //* [Added Code] Token Bucket Rate Limiter에 의해 차단된 경우 명시적 429 반환
    if (error.status === 429) {
      return res.status(429).json({ error: error.message });
    }

    // //* [Fixed] 실제 ODsay 에러 메시지를 그대로 전달 (generic 메시지 제거)
    res.status(500).json({ error: error.message || 'ODsay 경로 탐색 실패' });
  }
};

/**
 * //* [Modified Code] ODsay 기반 역 검색 — 자동완성용으로 전체 결과 반환
 * 기존: axios 직접 호출 (Rate Limit 누락)
 * 변경: Token Bucket이 적용된 odsayService.getRaw 호출로 변경
 */
exports.searchStation = async (req, res) => {
  const { stationName } = req.query;
  if (!stationName) return res.status(400).json({ error: 'Station name is required' });
  try {
    const response = await odsayService.getRaw('searchStation', {
      lang: 0,
      stationName,
      CID: 1000,
    });
    
    // axios의 경우 data에 들어있으므로
    const stations = response.data?.result?.station || [];
    // 지하철역(stationClass===2) 우선, 없으면 전체 반환
    const subwayStations = stations.filter((s) => s.stationClass === 2);
    const result = subwayStations.length > 0 ? subwayStations : stations;
    res.json({ result: { station: result } });
  } catch (error) {
    console.error('[searchStation]', error.message);
    if (error.status === 429) {
      return res.status(429).json({ error: error.message });
    }
    res.status(500).json({ error: 'Station search failed' });
  }
};

/**
 * //* [NEW] [Modified Code] ODsay 기반 장소(POI) 검색
 */
exports.searchPOI = async (req, res) => {
  const { searchKeyword } = req.query;
  if (!searchKeyword) return res.status(400).json({ error: 'Search keyword is required' });
  try {
    const data = await odsayService.searchPOI(searchKeyword);
    res.json({ result: { poi: data } });
  } catch (error) {
    res.status(500).json({ error: 'POI search failed' });
  }
};

/**
 * //* [NEW] [Modified Code] ODsay 기반 상세 선로 데이터(loadLane) 조회
 * 기존: axios 직접 호출
 * 변경: Token Bucket이 적용된 odsayService.getRaw 호출
 */
exports.getLoadLane = async (req, res) => {
  const { mapObject } = req.query;
  if (!mapObject) return res.status(400).json({ error: 'mapObject is required' });
  try {
    const fullMapObject = `0:0@${mapObject}`;
    const response = await odsayService.getRaw('loadLane', { mapObject: fullMapObject });
    
    if (response.data?.result) return res.json(response.data);
    res.json({ result: response.data });
  } catch (error) {
    if (error.status === 429) {
      return res.status(429).json({ error: error.message });
    }
    res.status(500).json({ error: 'Load lane failed' });
  }
};
