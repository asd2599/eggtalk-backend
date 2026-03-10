const { pool } = require("./database/database");

const resetDatabase = async () => {
  try {
    // cascade를 사용하여 연관된 테이블 데이터도 안전하게 삭제
    // users, pets, 그리고 friends 테이블 초기화
    const query = `
      TRUNCATE TABLE pets, users, friends RESTART IDENTITY CASCADE;
    `;
    await pool.query(query);
    console.log(
      "Database initialized successfully (pets, users, friends tables truncated)",
    );
  } catch (error) {
    console.error("Error initializing database:", error);
  } finally {
    pool.end();
  }
};

resetDatabase();
