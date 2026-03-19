const { login } = require('./controllers/userController');
const httpMocks = require('node-mocks-http');

async function testInternalLogin() {
  const req = httpMocks.createRequest({
    method: 'POST',
    url: '/login',
    body: {
      email: 'abc@abc.com', // 실제 존재하는 유저 이메일로 테스트 필요
      password: 'password'
    }
  });
  const res = httpMocks.createResponse();

  try {
    await login(req, res);
    console.log('STATUS:', res.statusCode);
    console.log('DATA:', res._getData());
  } catch (err) {
    console.error('CRASHED WITH ERROR:', err);
  }
}

testInternalLogin();
