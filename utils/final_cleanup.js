const fs = require('fs');
const path = require('path');

const targets = [
  'c:\\Users\\pc9\\Desktop\\AICC 8\\1_TEAM_PROJECT\\FRONT\\eggtalk-frontend\\src\\features\\MS\\paths',
  'c:\\Users\\pc9\\Desktop\\AICC 8\\1_TEAM_PROJECT\\FRONT\\eggtalk-frontend\\src\\features\\MS\\scripts',
  'c:\\Users\\pc9\\Desktop\\AICC 8\\1_TEAM_PROJECT\\FRONT\\eggtalk-frontend\\src\\features\\MS\\subwayPaths.js',
  'c:\\Users\\pc9\\Desktop\\AICC 8\\1_TEAM_PROJECT\\FRONT\\eggtalk-frontend\\src\\features\\MS\\subwayPaths_exports.js',
  'c:\\Users\\pc9\\Desktop\\AICC 8\\1_TEAM_PROJECT\\FRONT\\eggtalk-frontend\\src\\features\\MS\\utils\\dijkstra.js',
  'c:\\Users\\pc9\\Desktop\\AICC 8\\1_TEAM_PROJECT\\FRONT\\eggtalk-frontend\\src\\features\\MS\\utils\\subwayGraph.js',
  'c:\\Users\\pc9\\Desktop\\AICC 8\\1_TEAM_PROJECT\\FRONT\\eggtalk-frontend\\src\\features\\MS\\utils\\odsayApi.js',
  'c:\\Users\\pc9\\Desktop\\AICC 8\\1_TEAM_PROJECT\\BACK\\eggtalk-backend\\utils\\extract_connectivity.js',
  'c:\\Users\\pc9\\Desktop\\AICC 8\\1_TEAM_PROJECT\\BACK\\eggtalk-backend\\utils\\subwayData.js',
  'c:\\Users\\pc9\\Desktop\\AICC 8\\1_TEAM_PROJECT\\BACK\\eggtalk-backend\\utils\\cleanup.js'
];

console.log('--- GEMINI HARD CLEANUP START ---');
targets.forEach(target => {
  if (fs.existsSync(target)) {
    try {
      // recursive: true for directories, force: true to ignore errors
      fs.rmSync(target, { recursive: true, force: true });
      console.log(`[OK] Deleted: ${target}`);
    } catch (err) {
      console.log(`[FAIL] Error deleting ${target}: ${err.message}`);
    }
  } else {
    console.log(`[MISS] Already gone or not found: ${target}`);
  }
});
console.log('--- GEMINI HARD CLEANUP END ---');
process.exit(0);
