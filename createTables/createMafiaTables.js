const { pool } = require("../database/database");

const createMafiaTablesQuery = `
    CREATE TABLE IF NOT EXISTS mafia_rooms (
        id SERIAL PRIMARY KEY,
        title VARCHAR(100) NOT NULL,
        host_id INTEGER REFERENCES pets(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'waiting', -- waiting, playing, finished
        max_players INTEGER DEFAULT 4,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS mafia_participants (
        id SERIAL PRIMARY KEY,
        room_id INTEGER REFERENCES mafia_rooms(id) ON DELETE CASCADE,
        pet_id INTEGER REFERENCES pets(id) ON DELETE CASCADE,
        is_ready BOOLEAN DEFAULT false,
        role VARCHAR(20),
        is_dead BOOLEAN DEFAULT false,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(room_id, pet_id)
    );
`;

const createTables = async () => {
    try {
        await pool.query(createMafiaTablesQuery);
        console.log("Mafia tables created successfully.");
    } catch (err) {
        console.error("Error creating mafia tables:", err);
    } finally {
        pool.end();
    }
};

createTables();
