const { pool } = require("./database/database");

const migrate = async () => {
  try {
    console.log("Starting DB migration for breeding feature...");

    // 1. UNIQUE constraint drop
    try {
      await pool.query(
        "ALTER TABLE pets DROP CONSTRAINT IF EXISTS pets_user_id_key;",
      );
      console.log("Dropped UNIQUE constraint on user_id.");
    } catch (e) {
      console.log(
        "pets_user_id_key might not exist or already dropped:",
        e.message,
      );
    }

    // 2. DROP NOT NULL from user_id
    await pool.query("ALTER TABLE pets ALTER COLUMN user_id DROP NOT NULL;");
    console.log("Dropped NOT NULL constraint on user_id.");

    // 3. ADD Relationship Columns
    await pool.query(`
            ALTER TABLE pets
            ADD COLUMN IF NOT EXISTS spouse_id INTEGER REFERENCES pets(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS child_id INTEGER REFERENCES pets(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS parent1_id INTEGER REFERENCES pets(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS parent2_id INTEGER REFERENCES pets(id) ON DELETE SET NULL;
        `);
    console.log("Added family relationship columns.");

    console.log("Migration completed successfully.");
  } catch (e) {
    console.error("Migration error:", e.message);
  } finally {
    await pool.end();
    process.exit(0);
  }
};

migrate();
