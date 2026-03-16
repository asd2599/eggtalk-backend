const { pool } = require("../../database/database");
const { OpenAI } = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "dummy_key",
});

const getChildPet = async (req, res) => {
  try {
    const userId = req.user.id;
    const parent = (await pool.query("SELECT * FROM pets WHERE user_id = $1", [userId])).rows[0];
    if (!parent) return res.status(404).json({ message: "메인 펫이 없습니다." });
    if (!parent.child_id) return res.status(200).json({ childPet: null, message: "자식 펫이 없습니다." });

    const child = (await pool.query("SELECT * FROM pets WHERE id = $1", [parent.child_id])).rows[0];
    if (!child) return res.status(200).json({ childPet: null, message: "자식 펫 데이터를 찾을 수 없습니다." });

    let spousePet = null;
    if (parent.spouse_id) {
      spousePet = (await pool.query("SELECT * FROM pets WHERE id = $1", [parent.spouse_id])).rows[0];
    }
    return res.status(200).json({ childPet: child, myPet: parent, spousePet });
  } catch (error) { return res.status(500).json({ message: "서버 에러" }); }
};

const hatchPet = async (req, res) => {
  try {
    const { childId } = req.body;
    if (!childId) return res.status(400).json({ message: "ID 필요" });

    const parents = (await pool.query("SELECT * FROM pets WHERE child_id = $1", [childId])).rows;
    let stats = { knowledge: 0, affection: 0, altruism: 0, logic: 0, empathy: 0, extroversion: 0, humor: 0, openness: 0, directness: 0, curiosity: 0 };
    if (parents.length > 0) {
      parents.forEach(p => Object.keys(stats).forEach(k => stats[k] += p[k] || 0));
      Object.keys(stats).forEach(k => stats[k] = Math.round(stats[k] / parents.length));
    }

    const shape = (stats.logic + stats.altruism) > (stats.affection + stats.empathy) ? "square" : "circle";
    const color = stats.knowledge > stats.curiosity ? "blue" : "yellow";
    const face = stats.affection > 60 ? "happy" : "neutral";
    const tendency = stats.extroversion > 60 ? "활발한" : "차분한";

    const updateResult = await pool.query(`
      UPDATE pets SET is_hatched = TRUE, level = 1, exp = 0, hunger = 50, cleanliness = 50, health_hp = 50, stress = 50,
      knowledge = $1, affection = $2, altruism = $3, logic = $4, empathy = $5, extroversion = $6, humor = $7, openness = $8, directness = $9, curiosity = $10,
      shape = $11, color = $12, face = $13, hand = 'open', tendency = $14
      WHERE id = $15 RETURNING *`,
      [stats.knowledge, stats.affection, stats.altruism, stats.logic, stats.empathy, stats.extroversion, stats.humor, stats.openness, stats.directness, stats.curiosity, shape, color, face, tendency, childId]
    );

    return res.status(200).json({ message: "부화 완료", pet: updateResult.rows[0] });
  } catch (error) { return res.status(500).json({ message: "서버 에러" }); }
};

const performChildAction = async (req, res) => {
  try {
    const userId = req.user.id;
    const { actionType, score = 0, roundCount = 1 } = req.body;
    const parent = (await pool.query("SELECT child_id FROM pets WHERE user_id = $1", [userId])).rows[0];
    if (!parent || !parent.child_id) return res.status(404).json({ message: "자식 펫 없음" });
    const childId = parent.child_id;

    if (actionType === "FEED") {
      const result = await pool.query("UPDATE pets SET hunger = LEAST(hunger + 30, 100), exp = exp + 10 WHERE id = $1 RETURNING *", [childId]);
      return res.status(200).json({ message: "식사 완료", childPet: result.rows[0] });
    } else if (actionType === "CLEAN") {
      const result = await pool.query("UPDATE pets SET cleanliness = LEAST(cleanliness + 30, 100), exp = exp + 10 WHERE id = $1 RETURNING *", [childId]);
      return res.status(200).json({ message: "청소 완료", childPet: result.rows[0] });
    } else if (actionType === "PLAY") {
      const avg = Math.max(0, Math.min(10, roundCount > 0 ? score / roundCount : 0));
      const t = avg / 10;
      const calc = (low, high) => Math.round(low + (high - low) * t);
      const changes = { stress: calc(5, -30), empathy: calc(-3, 20), affection: calc(-2, 15), exp: Math.round(5 + avg * 6) };

      const result = await pool.query(`
        UPDATE pets SET stress = GREATEST(LEAST(stress + $2, 100), 0), empathy = LEAST(empathy + $3, 100), affection = LEAST(affection + $4, 100), exp = exp + $5
        WHERE id = $1 RETURNING *`, [childId, changes.stress, changes.empathy, changes.affection, changes.exp]);
      return res.status(200).json({ message: "놀이 완료", childPet: result.rows[0], statChanges: changes });
    }
    return res.status(400).json({ message: "유효하지 않은 액션" });
  } catch (error) { return res.status(500).json({ message: "서버 에러" }); }
};

const renamePet = async (req, res) => {
  try {
    const { petId } = req.params;
    const { name } = req.body;
    const result = await pool.query("UPDATE pets SET name = $1 WHERE id = $2 RETURNING *", [name, petId]);
    return res.status(200).json({ message: "이름 변경 성공", pet: result.rows[0] });
  } catch (error) { return res.status(500).json({ message: "서버 에러" }); }
};

const abandonPet = async (req, res) => {
  const { childId } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE pets SET spouse_id = NULL, child_id = NULL WHERE child_id = $1", [childId]);
    const deleteResult = await client.query("DELETE FROM pets WHERE id = $1 RETURNING *", [childId]);
    await client.query("COMMIT");
    return res.status(200).json({ message: "파양 완료", deletedPet: deleteResult.rows[0] });
  } catch (error) { await client.query("ROLLBACK"); return res.status(500).json({ message: "서버 에러" }); }
  finally { client.release(); }
};

const analyzeChildTendency = async (req, res) => {
  try {
    const userId = req.user.id;
    const parent = (await pool.query("SELECT * FROM pets WHERE user_id = $1", [userId])).rows[0];
    if (!parent || !parent.child_id) return res.status(404).json({ message: "자식 펫이 없습니다." });
    const childId = parent.child_id;

    const childResult = await pool.query("SELECT * FROM pets WHERE id = $1", [childId]);
    const child = childResult.rows[0];

    const VALID_OPTIONS = {
      face: ["angry", "confused", "dizzy", "excited", "gloomy", "neutral", "playful", "relaxed", "relieved", "sad", "smug", "tired"],
      shape: ["circle", "rhombus", "square", "squircle"],
      hand: ["closed", "open", "peace", "point", "rock", "thumb"]
    };

    let newTendency = "neutral", newFace = "neutral", newHand = "open", newShape = "circle", analysisReason = "분석 완료";
    
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== "your_openai_api_key_here") {
      const statsJson = JSON.stringify(child);
      const systemPrompt = `너는 아기 펫 발달 분석가야. 아기 펫의 현재 스탯 ${statsJson}을 보고 성장을 분석해줘.
다음 옵션 중에서만 선택해서 JSON으로 반환해:
- tendency: 아이의 현재 성향 (1개 명사, 예: "쑥스러움", "에너자이저" 등)
- face: ${VALID_OPTIONS.face.join(", ")} 중 하나 (스탯에 어울리는 표정)
- shape: ${VALID_OPTIONS.shape.join(", ")} 중 하나 (스탯에 어울리는 몸체형)
- hand: ${VALID_OPTIONS.hand.join(", ")} 중 하나 (스탯에 어울리는 손 모양)
- reason: 아이의 성향에 대한 설명 (1~2문장)
- appearance_reason: 해당 외형(face, shape, hand)으로 변화한 이유에 대한 설명 (1~2문장)

반드시 정확한 옵션 명칭을 사용해야 하며, 부모가 아이의 변화를 실감할 수 있도록 다정하고 상세하게 설명해줘.`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4-turbo-preview", // 더 정교한 분석을 위해 모델 업그레이드 제안 (없으면 gpt-3.5-turbo 유지)
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: systemPrompt }],
        max_tokens: 500,
        temperature: 0.8, // 다양성을 위해 온도를 살짝 높임
      });

      const parsed = JSON.parse(completion.choices[0].message.content);
      newTendency = parsed.tendency || "neutral";
      newFace = VALID_OPTIONS.face.includes(parsed.face) ? parsed.face : "neutral";
      newHand = VALID_OPTIONS.hand.includes(parsed.hand) ? parsed.hand : "open";
      newShape = VALID_OPTIONS.shape.includes(parsed.shape) ? parsed.shape : "circle";
      
      // 성향 설명과 외형 설명을 합쳐서 풍부한 피드백 제공
      const tendencyReason = parsed.reason || "발달 분석 완료";
      const appearanceReason = parsed.appearance_reason || "새로운 모습으로 성장했습니다.";
      analysisReason = `${tendencyReason}\n\n[외형 변화]: ${appearanceReason}`;
    }

    const updateResult = await pool.query(
      `UPDATE pets SET tendency = $1, face = $2, hand = $3, shape = $4 WHERE id = $5 RETURNING *`,
      [newTendency, newFace, newHand, newShape, childId]
    );

    return res.status(200).json({ pet: updateResult.rows[0], reason: analysisReason, message: "아기 펫 성향 분석 완료" });
  } catch (error) {
    console.error("analyzeChildTendency error:", error);
    return res.status(500).json({ message: "서버 에러" });
  }
};

module.exports = { getChildPet, hatchPet, performChildAction, renamePet, abandonPet, analyzeChildTendency };
