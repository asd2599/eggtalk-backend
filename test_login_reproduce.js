const axios = require('axios');

async function testLogin() {
  try {
    const res = await axios.post('http://localhost:8000/login', {
      email: 'test@example.com',
      password: 'password'
    });
    console.log('SUCCESS:', res.data);
  } catch (err) {
    if (err.response) {
      console.log('ERROR STATUS:', err.response.status);
      console.log('ERROR DATA:', err.response.data);
    } else {
      console.error('ERROR:', err.message);
    }
  }
}

testLogin();
