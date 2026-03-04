const { pool } = require("../database/database");

const createTableQuery = `
    CREATE TABLE IF NOT EXISTS pets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(50) NOT NULL,
        color VARCHAR(50) NOT NULL,
        level INTEGER DEFAULT 1,
        exp INTEGER DEFAULT 0,
        hunger INTEGER DEFAULT 100,
        cleanliness INTEGER DEFAULT 100,
        health_hp INTEGER DEFAULT 100,
        stress INTEGER DEFAULT 0,
        knowledge INTEGER DEFAULT 0,
        affection INTEGER DEFAULT 0,
        altruism INTEGER DEFAULT 0,
        logic INTEGER DEFAULT 0,
        empathy INTEGER DEFAULT 0,
        extroversion INTEGER DEFAULT 0,
        humor INTEGER DEFAULT 0,
        openness INTEGER DEFAULT 0,
        directness INTEGER DEFAULT 0,
        curiosity INTEGER DEFAULT 0,
        tendency VARCHAR(50) DEFAULT 'neutral',
        last_chat_time TIMESTAMP,
        today_chat_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
`;

const alterTableQuery = `
    ALTER TABLE pets
    ADD COLUMN IF NOT EXISTS extroversion INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS humor INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS openness INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS directness INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS curiosity INTEGER DEFAULT 0;
`;

const createTable = async () => {
  try {
    await pool.query(createTableQuery);
    await pool.query(alterTableQuery);
    console.log("Pets table created or altered successfully.");
  } catch (err) {
    console.error("Error creating pets table:", err);
  } finally {
    pool.end();
  }
};

createTable();
