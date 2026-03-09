const { pool } = require("./database/database");

const migrate = async () => {
  try {
    console.log("Starting migration: adding is_hatched to pets table...");
    await pool.query(`
      ALTER TABLE pets 
      ADD COLUMN IF NOT EXISTS is_hatched BOOLEAN DEFAULT FALSE;
    `);
    console.log("Migration successful: is_hatched column added.");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    process.exit();
  }
};

migrate();
