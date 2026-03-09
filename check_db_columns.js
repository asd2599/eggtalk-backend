const { pool } = require("./database/database");

const checkDb = async () => {
  try {
    const res = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'pets'",
    );
    console.log("--- CURRENT COLUMNS ---");
    console.log(res.rows.map((r) => r.column_name).join(", "));
    console.log("-----------------------");

    const hasFace = res.rows.some((r) => r.column_name === "face");
    const hasShape = res.rows.some((r) => r.column_name === "shape");
    const hasHand = res.rows.some((r) => r.column_name === "hand");

    if (!hasFace || !hasShape || !hasHand) {
      console.log("Missing columns found. Attempting to add...");
      await pool.query(`
                ALTER TABLE pets 
                ADD COLUMN IF NOT EXISTS face VARCHAR(50) DEFAULT 'neutral',
                ADD COLUMN IF NOT EXISTS shape VARCHAR(50) DEFAULT 'circle',
                ADD COLUMN IF NOT EXISTS hand VARCHAR(50) DEFAULT 'open'
            `);
      console.log("Columns added successfully.");
    } else {
      console.log("All required columns already exist.");
    }
  } catch (err) {
    console.error("DB_ERROR:", err.message);
  } finally {
    await pool.end();
    process.exit(0);
  }
};

checkDb();
