/**
 * [utils/subwayUtils.js]
 * 역할: 지하철 경로 탐색(Dijkstra), 그래프 생성 및 거리 계산 유틸리티입니다.
 * 구성:
 * 1. buildSubwayGraph: 노선 정보를 바탕으로 인접 리스트 기반 그래프 생성
 * 2. findShortestPath: 다익스트라 알고리즘을 통한 최단 경로 탐색
 * 3. getDistance: 위경도 기반 두 점 사이의 거리 계산
 */

const { SUBWAY_LINE_MAP } = require('./subwayData/lineMap');

/**
 * 1단계: 지하철 그래프 구축
 * - LINE_MAP의 순서를 기반으로 인접 역 연결
 * - 환승역(동일 역명, 다른 호선) 자동 연결
 */
const buildSubwayGraph = () => {
  const graph = {};
  const transferWaitTime = 5; // 환승 가중치 (분)
  const stationTravelTime = 2; // 역 간 이동 가중치 (분)

  // 1. 노선도 기반 기본 연결 (Line Map 기반)
  Object.entries(SUBWAY_LINE_MAP).forEach(([line, stations]) => {
    for (let i = 0; i < stations.length - 1; i++) {
        const stationA = stations[i];
        const stationB = stations[i+1];

        const nodeA = `${stationA}|${line}`;
        const nodeB = `${stationB}|${line}`;

        if (!graph[nodeA]) graph[nodeA] = {};
        if (!graph[nodeB]) graph[nodeB] = {};

        graph[nodeA][nodeB] = stationTravelTime;
        graph[nodeB][nodeA] = stationTravelTime;
    }
  });

  // 2. 환승역 자동 연결
  const stationToNodes = {};
  Object.keys(graph).forEach(nodeId => {
    const [station, line] = nodeId.split('|');
    if (!stationToNodes[station]) stationToNodes[station] = [];
    stationToNodes[station].push(nodeId);
  });

  Object.entries(stationToNodes).forEach(([station, nodes]) => {
    if (nodes.length > 1) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const nodeA = nodes[i];
          const nodeB = nodes[j];
          graph[nodeA][nodeB] = transferWaitTime;
          graph[nodeB][nodeA] = transferWaitTime;
        }
      }
    }
  });

  return graph;
};

/**
 * 2단계: 최단 경로 탐색 (다익스트라)
 */
const findShortestPath = (startStation, endStation) => {
  const graph = buildSubwayGraph();
  const startNodes = Object.keys(graph).filter(n => n.startsWith(`${startStation}|`));
  const endNodes = Object.keys(graph).filter(n => n.startsWith(`${endStation}|`));

  if (!startNodes.length || !endNodes.length) return null;

  let bestResult = null;

  startNodes.forEach(sNode => {
    endNodes.forEach(eNode => {
      const result = dijkstra(graph, sNode, eNode);
      if (result && (!bestResult || result.distance < bestResult.distance)) {
        bestResult = result;
      }
    });
  });

  return bestResult;
};

const dijkstra = (graph, startNode, endNode) => {
    const distances = {};
    const prev = {};
    const queue = new Set(Object.keys(graph));

    queue.forEach(node => {
        distances[node] = Infinity;
        prev[node] = null;
    });
    distances[startNode] = 0;

    while (queue.size > 0) {
        let u = null;
        for (const node of queue) {
            if (u === null || distances[node] < distances[u]) u = node;
        }

        if (distances[u] === Infinity || u === endNode) break;
        queue.delete(u);

        for (const [v, weight] of Object.entries(graph[u])) {
            if (!queue.has(v)) continue;
            const alt = distances[u] + weight;
            if (alt < distances[v]) {
                distances[v] = alt;
                prev[v] = u;
            }
        }
    }

    if (distances[endNode] === Infinity) return null;

    const path = [];
    let curr = endNode;
    while (curr) {
        const [name, line] = curr.split('|');
        path.unshift({ name, line });
        curr = prev[curr];
    }

    return { distance: distances[endNode], path };
};

/**
 * 3단계: 기타 유틸리티
 */
const getDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            /* eslint-disable-next-line */
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

module.exports = {
  buildSubwayGraph,
  findShortestPath,
  getDistance
};
