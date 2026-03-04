const { pool } = require("./database/database");

const createTableQuery = `
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        pet_id INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
`;

const createTable = async () => {
  try {
    await pool.query(createTableQuery);
    console.log("Users table created successfully.");
  } catch (err) {
    console.error("Error creating users table:", err);
  } finally {
    pool.end();
  }
};

createTable();
