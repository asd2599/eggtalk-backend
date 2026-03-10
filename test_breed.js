const { pool } = require("./database/database");
(async () => {
  try {
    const res = await pool.query("SELECT * FROM pets ORDER BY id DESC LIMIT 2");
    if (res.rows.length < 2) {
      console.log("Not enough pets");
      process.exit(0);
    }
    const p1 = res.rows[0];
    const p2 = res.rows[1];

    const calcStat = (s1, s2) =>
      Math.min(100, Math.floor((s1 + s2) / 2) + Math.floor(Math.random() * 10));

    const childStats = {
      level: 1,
      exp: 0,
      hunger: 100,
      cleanliness: 100,
      health_hp: 100,
      stress: 0,
      knowledge: calcStat(p1.knowledge, p2.knowledge),
      affection: calcStat(p1.affection, p2.affection),
      altruism: calcStat(p1.altruism, p2.altruism),
      logic: calcStat(p1.logic, p2.logic),
      empathy: calcStat(p1.empathy, p2.empathy),
      extroversion: calcStat(p1.extroversion, p2.extroversion),
      humor: calcStat(p1.humor, p2.humor),
      openness: calcStat(p1.openness, p2.openness),
      directness: calcStat(p1.directness, p2.directness),
      curiosity: calcStat(p1.curiosity, p2.curiosity),
      tendency: "neutral",
      face: "neutral",
      shape: Math.random() > 0.5 ? p1.shape : p2.shape,
      hand: Math.random() > 0.5 ? p1.hand : p2.hand,
    };

    const childName = `${p1.name}와(과) ${p2.name}의 알`;
    const childColor = p1.color;

    const insertQuery = `
      INSERT INTO pets (
        user_id, name, color, level, exp, hunger, cleanliness, health_hp, stress,
        knowledge, affection, altruism, logic, empathy, 
        extroversion, humor, openness, directness, curiosity,
        tendency, face, shape, hand, parent1_id, parent2_id
      ) VALUES (
        NULL, $1, $2, $3, $4, $5, $6, $7, $8, 
        $9, $10, $11, $12, $13, 
        $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23, $24
      ) RETURNING *;
    `;
    const insertValues = [
      childName,
      childColor,
      childStats.level,
      childStats.exp,
      childStats.hunger,
      childStats.cleanliness,
      childStats.health_hp,
      childStats.stress,
      childStats.knowledge,
      childStats.affection,
      childStats.altruism,
      childStats.logic,
      childStats.empathy,
      childStats.extroversion,
      childStats.humor,
      childStats.openness,
      childStats.directness,
      childStats.curiosity,
      childStats.tendency,
      childStats.face,
      childStats.shape,
      childStats.hand,
      p1.id,
      p2.id,
    ];
    console.log("Values:", insertValues);
    const childResult = await pool.query(insertQuery, insertValues);
    console.log("Success:", childResult.rows[0].id);
  } catch (e) {
    console.error("DB ERROR:", e.stack);
  } finally {
    pool.end();
  }
})();
