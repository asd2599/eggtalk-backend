const { pool } = require('./database/database');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

async function debugLoginLogic() {
  const email = 'abc@abc.com'; // 유저가 제보한 이메일 또는 기본 테스트 계정
  
  try {
    console.log('1. DB Querying for email:', email);
    const user = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    console.log('User found:', user.rows.length > 0);
    
    if (user.rows.length > 0) {
      console.log('2. Bcrypt compare...');
      const password = 'password'; // 테스트용
      const hash = user.rows[0].password;
      if (!hash) {
        console.log('User has no password (social login?)');
      } else {
        const isMatch = await bcrypt.compare(password, hash);
        console.log('Password match:', isMatch);
      }
      
      console.log('3. JWT Signing...');
      const token = jwt.sign(
        { userId: user.rows[0].id, email: user.rows[0].email },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
      );
      console.log('Token created successfully');
    }
  } catch (err) {
    console.error('STEP FAILED:', err);
  } finally {
    process.exit();
  }
}

debugLoginLogic();
