require("dotenv").config({ path: "../.env" });
const { pool } = require("../database/database");

const createDatingRoomsTable = async () => {
  const queryText = `
    CREATE TABLE IF NOT EXISTS dating_rooms (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) NOT NULL,
      creator_pet_name VARCHAR(50) NOT NULL,
      participant_pet_name VARCHAR(50),
      status VARCHAR(20) DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'closed')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  try {
    await pool.query(queryText);
    console.log("dating_rooms 테이블이 성공적으로 생성되었습니다.");
  } catch (error) {
    console.error("dating_rooms 테이블 생성 중 오류 발생:", error);
  } finally {
    pool.end();
  }
};

createDatingRoomsTable();
