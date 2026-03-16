const { pool } = require("../database/database");

const createTableQuery = `
    CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
`;

const createTable = async () => {
  try {
    await pool.query(createTableQuery);
    console.log("Messages table created successfully.");
  } catch (err) {
    console.error("Error creating messages table:", err);
  } finally {
    pool.end();
  }
};

createTable();
