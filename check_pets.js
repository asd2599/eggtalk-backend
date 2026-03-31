const { pool } = require("./database/database");

async function checkPets() {
  try {
    const res = await pool.query("SELECT id, name FROM pets LIMIT 10");
    console.log(JSON.stringify(res.rows, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
checkPets();
