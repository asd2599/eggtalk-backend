
require('dotenv').config();
const axios = require('axios');

async function testAPIs() {
  const line = '2호선';
  const apiKey = process.env.SUBWAY_API_KEY;
  const odsayKey = process.env.ODSAY_API_KEY;

  console.log('--- Environment Check ---');
  console.log('SUBWAY_API_KEY length:', apiKey ? apiKey.length : 0);
  console.log('ODSAY_API_KEY length:', odsayKey ? odsayKey.length : 0);

  console.log('\n--- Testing Subway API (Seoul Open Data) ---');
  try {
    const url = `http://swopenAPI.seoul.go.kr/api/subway/${apiKey}/json/realtimePosition/0/5/${encodeURIComponent(line)}`;
    const res = await axios.get(url);
    console.log('Subway API Status:', res.status);
    console.log('Subway API Data Preview:', JSON.stringify(res.data).substring(0, 200));
  } catch (e) {
    console.error('Subway API Error:', e.message);
    if (e.response) console.error('Subway API Error Body:', e.response.data);
  }

  console.log('\n--- Testing ODsay API (searchStation) ---');
  try {
    const url = `https://api.odsay.com/v1/api/searchStation`;
    const res = await axios.get(url, {
      params: { lang: 0, stationName: '강남역', CID: 1000, apiKey: odsayKey }
    });
    console.log('ODsay API Status:', res.status);
    console.log('ODsay API Data Preview:', JSON.stringify(res.data).substring(0, 200));
  } catch (e) {
    console.error('ODsay API Error:', e.message);
    if (e.response) console.error('ODsay API Error Body:', e.response.data);
  }
}

testAPIs();
