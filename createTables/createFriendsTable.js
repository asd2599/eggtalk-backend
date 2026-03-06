require("dotenv").config({ path: "../.env" });
const { pool } = require("../database/database");

const createFriendsTable = async () => {
  const queryText = `
    CREATE TABLE IF NOT EXISTS friends (
      id SERIAL PRIMARY KEY,
      requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT chk_no_self_request CHECK (requester_id != receiver_id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_friends_unique_pair 
    ON friends (LEAST(requester_id, receiver_id), GREATEST(requester_id, receiver_id));
  `;

  try {
    await pool.query(queryText);
    console.log("friends 테이블이 성공적으로 생성되었습니다.");
  } catch (error) {
    console.error("friends 테이블 생성 중 오류 발생:", error);
  } finally {
    pool.end();
  }
};

createFriendsTable();
