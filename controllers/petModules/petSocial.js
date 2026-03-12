const { pool } = require("../../database/database");
const { OpenAI } = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "dummy_key",
});

const clamp = (val, min = 0, max = 100) => Math.max(min, Math.min(max, val));

// 상대방 펫 선물하기
const giftToPet = async (req, res) => {
  try {
    const { targetPetName, stats, message, giftName } = req.body;
    if (!targetPetName || !stats) return res.status(400).json({ message: "대상 펫 이름과 선물 스탯 정보가 필요합니다." });

    const getResult = await pool.query("SELECT * FROM pets WHERE LOWER(name) = LOWER($1)", [targetPetName.trim()]);
    if (getResult.rows.length === 0) return res.status(404).json({ message: "선물 받을 펫을 찾을 수 없습니다." });

    const pet = getResult.rows[0];
    const validStats = ["health_hp", "hunger", "cleanliness", "stress", "affection", "altruism", "empathy", "knowledge", "logic", "extroversion", "humor", "openness", "directness", "curiosity"];

    for (const [key, value] of Object.entries(stats)) {
      if (validStats.includes(key.toLowerCase()) && pet.hasOwnProperty(key.toLowerCase())) {
        pet[key.toLowerCase()] = clamp(Number(pet[key.toLowerCase()]) + Number(value));
      }
    }

    pet.exp += 15;
    const expNeeded = pet.level * 100;
    if (pet.exp >= expNeeded) { pet.level += 1; pet.exp -= expNeeded; }

    const updateQuery = `
      UPDATE pets SET exp = $1, level = $2, health_hp = $3, hunger = $4, cleanliness = $5, stress = $6, affection = $7, altruism = $8, empathy = $9, knowledge = $10, logic = $11, extroversion = $12, humor = $13, openness = $14, directness = $15, curiosity = $16
      WHERE name = $17 RETURNING *;
    `;
    const values = [pet.exp, pet.level, pet.health_hp, pet.hunger, pet.cleanliness, pet.stress, pet.affection, pet.altruism, pet.empathy, pet.knowledge, pet.logic, pet.extroversion, pet.humor, pet.openness, pet.directness, pet.curiosity, targetPetName];
    const updateResult = await pool.query(updateQuery, values);

    let reply = "";
    if (message && message.trim() !== "") {
      const systemPrompt = `너는 '${pet.name}'이고 성향은 '${pet.tendency}'야. '${giftName || "선물"}'을 받으며 "${message.trim()}"라는 말을 들었을 때 소감을 귀엽게 1~2문장으로 말해줘.`;
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [{ role: "system", content: systemPrompt }],
          max_tokens: 150, temperature: 0.8,
        });
        reply = completion.choices[0].message.content;
      } catch (err) { reply = "고마워!!"; }
    }

    return res.status(200).json({ pet: updateResult.rows[0], message: "선물을 성공적으로 전달했습니다!", reply });
  } catch (error) {
    console.error("giftToPet error:", error);
    return res.status(500).json({ message: "선물 처리 중 오류가 발생했습니다." });
  }
};

// 펫 교배
const breedPets = async (req, res) => {
  const { parent1Name, parent2Name, roomId } = req.body;
  if (!parent1Name || !parent2Name) return res.status(400).json({ message: "부모 펫 이름이 필요합니다." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const p1 = (await client.query("SELECT * FROM pets WHERE name = $1", [parent1Name])).rows[0];
    const p2 = (await client.query("SELECT * FROM pets WHERE name = $1", [parent2Name])).rows[0];

    if (!p1 || !p2) { await client.query("ROLLBACK"); return res.status(404).json({ message: "부모 펫을 찾을 수 없습니다." }); }
    if (p1.child_id && p2.child_id && p1.child_id === p2.child_id) {
      await client.query("ROLLBACK");
      const child = (await client.query("SELECT * FROM pets WHERE id = $1", [p1.child_id])).rows[0];
      return res.status(200).json({ message: "이미 탄생했습니다!", childPet: child });
    }
    if (p1.child_id || p2.child_id || p1.spouse_id || p2.spouse_id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "이미 교배되었거나 가족이 있는 펫입니다." });
    }

    const calcStat = (s1, s2) => Math.min(100, Math.floor((s1 + s2) / 2) + Math.floor(Math.random() * 10));
    const childStats = { knowledge: calcStat(p1.knowledge, p2.knowledge), affection: calcStat(p1.affection, p2.affection), altruism: calcStat(p1.altruism, p2.altruism), logic: calcStat(p1.logic, p2.logic), empathy: calcStat(p1.empathy, p2.empathy), extroversion: calcStat(p1.extroversion, p2.extroversion), humor: calcStat(p1.humor, p2.humor), openness: calcStat(p1.openness, p2.openness), directness: calcStat(p1.directness, p2.directness), curiosity: calcStat(p1.curiosity, p2.curiosity) };
    const randomColor = ["blue", "green", "pink", "purple", "red", "yellow"][Math.floor(Math.random() * 6)];

    const childResult = await client.query(`
      INSERT INTO pets (name, color, level, exp, hunger, cleanliness, health_hp, stress, knowledge, affection, altruism, logic, empathy, extroversion, humor, openness, directness, curiosity, tendency, face, shape, hand, parent1_id, parent2_id)
      VALUES ($1, $2, 1, 0, 100, 100, 100, 0, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'neutral', 'neutral', $13, $14, $15, $16) RETURNING *;
    `, [`${p1.name}와 ${p2.name}의 알`, randomColor, childStats.knowledge, childStats.affection, childStats.altruism, childStats.logic, childStats.empathy, childStats.extroversion, childStats.humor, childStats.openness, childStats.directness, childStats.curiosity, Math.random() > 0.5 ? p1.shape : p2.shape, Math.random() > 0.5 ? p1.hand : p2.hand, p1.id, p2.id]);

    const childPet = childResult.rows[0];
    await client.query("UPDATE pets SET spouse_id = $1, child_id = $2 WHERE id = $3", [p2.id, childPet.id, p1.id]);
    await client.query("UPDATE pets SET spouse_id = $1, child_id = $2 WHERE id = $3", [p1.id, childPet.id, p2.id]);
    if (roomId) await client.query("DELETE FROM dating_rooms WHERE id = $1", [roomId]);

    await client.query("COMMIT");
    return res.status(201).json({ message: "생명이 탄생했습니다!", childPet });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("breedPets error:", error);
    return res.status(500).json({ message: error.message });
  } finally { client.release(); }
};

module.exports = { giftToPet, breedPets };
