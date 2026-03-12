const axios = require('axios');

/**
 * @file odsayService.js
 * @description ODsay API를 통한 대중교통 경로 탐색 및 선로 궤적(loadLane) 수집 서비스 (Backend)
 *
 * [인증 방식]
 * ODsay API 키는 등록된 도메인의 Origin 헤더로 인증됩니다.
 * URLSearchParams를 통해 apiKey를 포함하고, Origin/Referer 헤더를 함께 전송해야 합니다.
 */

const API_KEY = process.env.ODSAY_API_KEY;
const BASE_URL = 'https://api.odsay.com/v1/api';
const FRONTEND_ORIGIN = process.env.FRONTEND_URL || 'http://localhost:5173';

// API 호출 오남용 방지용 캐시 (과금 방지)
const requestCache = new Map();

/**
 * ODsay API 호출 공통 헬퍼
 * - URLSearchParams로 apiKey 포함 (특수문자 안전 인코딩)
 * - Origin/Referer 헤더 포함 (도메인 기반 인증)
 */
const odsayGet = (endpoint, params) => {
  if (!API_KEY) throw new Error('ODSAY_API_KEY 환경변수가 설정되지 않았습니다.');
  const query = new URLSearchParams({ ...params, apiKey: API_KEY }).toString();
  return axios.get(`${BASE_URL}/${endpoint}?${query}`, {
    headers: {
      Origin: FRONTEND_ORIGIN,
      Referer: `${FRONTEND_ORIGIN}/ms`,
    },
  });
};

const odsayService = {
  async searchStation(stationName) {
    if (!API_KEY) throw new Error('ODsay API Key is missing');
    try {
      const res = await odsayGet('searchStation', { lang: 0, stationName, CID: 1000 });
      if (!res.data?.result?.station) return null;
      const stations = res.data.result.station;
      const subwayStations = stations.filter((s) => s.stationClass === 2);
      return subwayStations.length > 0 ? subwayStations[0] : stations[0];
    } catch (e) {
      console.error(`[ODsay searchStation] 실패: ${stationName}`, e.message);
      return null;
    }
  },

  async searchPOI(searchKeyword) {
    const now = Date.now();
    const cacheKey = `poi_${searchKeyword}`;
    if (requestCache.get(cacheKey) && now - requestCache.get(cacheKey) < 500) return [];
    requestCache.set(cacheKey, now);

    try {
      const res = await odsayGet('searchPOI', { lang: 0, searchKeyword, CID: 1000 });
      return res.data?.result?.poi || [];
    } catch (e) {
      console.error(`[ODsay searchPOI] 실패: ${searchKeyword}`, e.message);
      return [];
    }
  },

  async getPublicTransPath(start, end, searchType = 0, pathType = 0) {
    // //* [Fixed] query string으로 전달된 경우 숫자로 변환 (문자열 "0" === 2 비교 버그 방지)
    const sType = Number(searchType);
    const pType = Number(pathType);

    const requestKey = `path_${JSON.stringify(start)}_${JSON.stringify(end)}_${sType}_${pType}`;
    const now = Date.now();
    if (requestCache.get(requestKey) && now - requestCache.get(requestKey) < 1200) return null;
    requestCache.set(requestKey, now);

    let SX, SY, EX, EY;

    const findLocation = async (keyword) => {
      if (typeof keyword === 'object' && keyword.x && keyword.y) {
        return { x: keyword.x, y: keyword.y };
      }
      const st = await this.searchStation(keyword);
      if (st) return { x: st.x, y: st.y };

      const pois = await this.searchPOI(keyword);
      if (pois && pois.length > 0) return { x: pois[0].x, y: pois[0].y };
      return null;
    };

    const startLoc = await findLocation(start);
    if (!startLoc) throw new Error(`출발지를 찾을 수 없습니다: "${start}"`);
    SX = startLoc.x; SY = startLoc.y;

    const endLoc = await findLocation(end);
    if (!endLoc) throw new Error(`도착지를 찾을 수 없습니다: "${end}"`);
    EX = endLoc.x; EY = endLoc.y;

    try {
      // //* [Fixed] ODsay 공식 파라미터명 사용:
      //   OPT: 경로 최적화 옵션 (0=최소시간, 1=최소환승, 2=최소도보)
      //   SearchPathType: 교통수단 (0=전체, 1=지하철, 2=버스)
      //   SearchType은 ODsay 비공식 파라미터였으므로 제거
      const opt = sType === 3 ? 1 : 0; // 최소환승(3) → ODsay OPT 1
      const searchPathType = pType === 3 ? 0 : pType; // 도보(3)는 ODsay 미지원 → 전체(0)

      const res = await odsayGet('searchPubTransPathT', {
        lang: 0, SX, SY, EX, EY,
        OPT: opt,
        SearchPathType: searchPathType,
      });

      if (res.data?.error) {
        const err = res.data.error;
        // ODsay 에러 구조: 인증 오류 = 배열[{message}], 검색 오류 = 객체{msg}
        const msg = Array.isArray(err) ? err[0]?.message : err?.msg;
        throw new Error(msg || '경로 검색 오류');
      }
      const resultPaths = res.data?.result?.path;
      if (!Array.isArray(resultPaths) || resultPaths.length === 0) throw new Error('검색된 경로가 없습니다.');

      const formattedPaths = resultPaths.map((path) => {
        let walkDist = 0;
        path.subPath.forEach((sub) => { if (sub.trafficType === 3) walkDist += sub.distance; });
        return { ...path, walkDistance: walkDist, totalFare: path.info.payment || 0, raw: path };
      });

      // 최단거리(2) 선택 시 클라이언트 정렬
      if (sType === 2) formattedPaths.sort((a, b) => a.info.totalDistance - b.info.totalDistance);
      return formattedPaths;
    } catch (err) {
      throw new Error(`통합 경로 조회 실패: ${err.message}`);
    }
  },

  async fetchLaneData(mapObj) {
    if (!mapObj) return [];
    try {
      const res = await odsayGet('loadLane', { mapObject: `0:0@${mapObj}` });

      const laneArray = res.data?.result?.lane;
      if (!Array.isArray(laneArray)) return [];

      const lanes = [];
      laneArray.forEach((lane) => {
        const points = [];
        (lane.section || []).forEach((sec) => {
          (sec.graphPos || []).forEach((pos) => {
            const lat = parseFloat(pos.y ?? pos.lat);
            const lng = parseFloat(pos.x ?? pos.lng);
            if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) points.push({ lat, lng });
          });
        });
        if (points.length > 0) lanes.push({ type: lane.type, points });
      });
      return lanes;
    } catch (err) {
      console.warn('[ODsay loadLane] 호출 실패:', err.message);
      return [];
    }
  },
};

module.exports = odsayService;
