
require('dotenv').config();
const axios = require('axios');

async function debug() {
  const subwayKey = process.env.SUBWAY_API_KEY;
  const odsayKey = process.env.ODSAY_API_KEY;

  console.log('--- Config ---');
  console.log('SUBWAY_KEY:', subwayKey);
  console.log('ODSAY_KEY:', odsayKey);

  // 1. Subway Position Test
  try {
    const line = '2호선';
    const url = `http://swopenAPI.seoul.go.kr/api/subway/${subwayKey}/json/realtimePosition/0/5/${encodeURIComponent(line)}`;
    console.log('\nSubway Request:', url);
    const res = await axios.get(url);
    console.log('Subway Response Status:', res.status);
    console.log('Subway Response Data:', JSON.stringify(res.data, null, 2));
  } catch (e) {
    console.log('Subway Error:', e.message);
  }

  // 2. ODsay Search Test
  try {
    const term = '강남역';
    const url = `https://api.odsay.com/v1/api/searchStation`;
    console.log('\nODsay Request:', url, 'term:', term);
    const res = await axios.get(url, {
      params: { lang: 0, stationName: term, CID: 1000, apiKey: odsayKey }
    });
    console.log('ODsay Status:', res.status);
    console.log('ODsay Response Data:', JSON.stringify(res.data, null, 2));
  } catch (e) {
    console.log('ODsay Error:', e.message);
  }
}

debug();
