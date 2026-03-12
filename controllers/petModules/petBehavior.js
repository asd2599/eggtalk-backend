const { pool } = require("../../database/database");
const { OpenAI } = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "dummy_key",
});

const clamp = (val, min = 0, max = 100) => Math.max(min, Math.min(max, val));
const clampValue = (val, max = 100) => Math.max(0, Math.min(max, val));

const ACTIONS_DATA = {
  1001: { category: "Eating", name: "Eating", increaseStatus: "health_hp", increaseValue: 5, decreaseStatus: "hunger", decreaseValue: -20, exp: 10 },
  1002: { category: "Cleaning", name: "Cleaning", increaseStatus: "cleanliness", increaseValue: 30, decreaseStatus: "stress", decreaseValue: -5, exp: 5 },
  1003: { category: "Sleep", name: "Sleep 1", increaseStatus: "health_hp", increaseValue: 40, decreaseStatus: "stress", decreaseValue: -30, exp: 5 },
  1004: { category: "Sleep", name: "Sleep 2", increaseStatus: "health_hp", increaseValue: 40, decreaseStatus: "hunger", decreaseValue: 20, exp: 5 },
  1005: { category: "Playing", name: "Playing 1", increaseStatus: "affection", increaseValue: 10, decreaseStatus: "hunger", decreaseValue: 10, exp: 15 },
  1006: { category: "Playing", name: "Playing 2", increaseStatus: "hunger", increaseValue: 10, decreaseStatus: "stress", decreaseValue: -15, exp: 20 },
  1007: { category: "Volunteer", name: "Volunteer 1", increaseStatus: "altruism", increaseValue: 10, decreaseStatus: "health_hp", decreaseValue: -5, exp: 25 },
  1008: { category: "Volunteer", name: "Volunteer 2", increaseStatus: "empathy", increaseValue: 5, decreaseStatus: "health_hp", decreaseValue: -10, exp: 25 },
  1009: { category: "Chat", name: "Chat 1", increaseStatus: "empathy", increaseValue: 5, exp: 10 },
  1010: { category: "Chat", name: "Chat 2", increaseStatus: "affection", increaseValue: 5, exp: 10 },
  1011: { category: "Chat", name: "Chat 3", increaseStatus: "knowledge", increaseValue: 5, exp: 10 },
  1012: { category: "Playing", name: "Playing 3", increaseStatus: "logic", increaseValue: 10, decreaseStatus: "stress", decreaseValue: -5, exp: 15 },
};

// 액션 실행
const performAction = async (req, res) => {
  try {
    const userId = req.user.id;
    const { actionKey } = req.body;
    const action = ACTIONS_DATA[actionKey];
    if (!action) return res.status(400).json({ message: "유효하지 않은 액션입니다." });

    const getQuery = "SELECT * FROM pets WHERE user_id = $1";
    const getResult = await pool.query(getQuery, [userId]);
    if (getResult.rows.length === 0) return res.status(404).json({ message: "펫을 찾을 수 없습니다." });

    const pet = getResult.rows[0];
    if (action.increaseStatus) pet[action.increaseStatus] = clamp(Number(pet[action.increaseStatus]) + Number(action.increaseValue));
    if (action.decreaseStatus) pet[action.decreaseStatus] = clamp(Number(pet[action.decreaseStatus]) + Number(action.decreaseValue));

    pet.exp += action.exp;
    const expNeeded = pet.level * 100;
    if (pet.exp >= expNeeded) {
      pet.level += 1;
      pet.exp -= expNeeded;
    }

    const updateQuery = `
      UPDATE pets
      SET exp = $1, level = $2, health_hp = $3, hunger = $4, cleanliness = $5, stress = $6, affection = $7, altruism = $8, empathy = $9, knowledge = $10, logic = $11, extroversion = $12, humor = $13, openness = $14, directness = $15, curiosity = $16
      WHERE user_id = $17 RETURNING *;
    `;
    const values = [pet.exp, pet.level, pet.health_hp, pet.hunger, pet.cleanliness, pet.stress, pet.affection, pet.altruism, pet.empathy, pet.knowledge, pet.logic, pet.extroversion, pet.humor, pet.openness, pet.directness, pet.curiosity, userId];
    const updateResult = await pool.query(updateQuery, values);
    return res.status(200).json({ pet: updateResult.rows[0], message: "액션 수행 성공" });
  } catch (error) {
    console.error("performAction error:", error);
    return res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
};

// 펫과 채팅 & 경험치 보상
const chatWithPet = async (req, res) => {
  try {
    const userId = req.user.id;
    const { message } = req.body;
    if (!message) return res.status(400).json({ message: "메시지를 입력해주세요." });

    const petQuery = "SELECT * FROM pets WHERE user_id = $1";
    const petResult = await pool.query(petQuery, [userId]);
    if (petResult.rows.length === 0) return res.status(404).json({ message: "펫을 먼저 생성해주세요." });
    const pet = petResult.rows[0];

    let reply = "";
    let analysisResult = { empathy: 0, logic: 0, knowledge: 0, affection: 0, altruism: 0, extroversion: 0, humor: 0, openness: 0, directness: 0, curiosity: 0 };

    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === "your_openai_api_key_here") {
      reply = `(API 키가 없어 임시 모드로 대답할게!) 바우와우~ "${message}"라고 했어? 재미있다 멍!`;
      analysisResult.empathy = 2;
      analysisResult.affection = 3;
    } else {
      const systemPrompt = `
        너는 이제 사용자의 소중한 인공지능 반려동물이야. 이름은 '${pet.name}'이고, 성향은 '${pet.tendency}'야.
        아래 두 가지 작업을 수행하고 JSON 형식으로만 반환해:
        1. "reply": 사용자의 메시지에 대해 짧고 귀엽게 1~3문장으로 대답. 이모지도 사용.
        2. "analysis": 사용자가 입력한 메시지 자체를 분석해서 10가지 능력치 증감을 -5 ~ +5 정수로 평가.
        { "reply": "...", "analysis": { ... } }
      `;
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: message }],
          max_tokens: 250,
          temperature: 0.8,
        });
        const parsedResponse = JSON.parse(completion.choices[0].message.content);
        reply = parsedResponse.reply || "멍멍! 잘 이해하지 못했어요.";
        analysisResult = { ...analysisResult, ...(parsedResponse.analysis || {}) };
      } catch (error) {
        console.error("AI 분석 파싱 에러:", error);
        reply = "멍! (응답을 분석하는데 실패했어..!)";
      }
    }

    const updateQuery = `
      UPDATE pets
      SET exp = exp + 10, empathy = $1, logic = $2, knowledge = $3, affection = $4, altruism = $5, extroversion = $6, humor = $7, openness = $8, directness = $9, curiosity = $10
      WHERE id = $11 RETURNING *
    `;
    const updateResult = await pool.query(updateQuery, [
      clampValue(pet.empathy + (analysisResult.empathy || 0)),
      clampValue(pet.logic + (analysisResult.logic || 0)),
      clampValue(pet.knowledge + (analysisResult.knowledge || 0)),
      clampValue(pet.affection + (analysisResult.affection || 0)),
      clampValue(pet.altruism + (analysisResult.altruism || 0)),
      clampValue(pet.extroversion + (analysisResult.extroversion || 0)),
      clampValue(pet.humor + (analysisResult.humor || 0)),
      clampValue(pet.openness + (analysisResult.openness || 0)),
      clampValue(pet.directness + (analysisResult.directness || 0)),
      clampValue(pet.curiosity + (analysisResult.curiosity || 0)),
      pet.id
    ]);
    const updatedPet = updateResult.rows[0];
    const requiredExp = updatedPet.level * 100;
    if (updatedPet.exp >= requiredExp) {
      const levelUpResult = await pool.query(`UPDATE pets SET level = level + 1, exp = exp - $2, health_hp = 100 WHERE id = $1 RETURNING *`, [pet.id, requiredExp]);
      return res.status(200).json({ reply, pet: levelUpResult.rows[0], analysis: analysisResult });
    }
    return res.status(200).json({ reply, pet: updatedPet, analysis: analysisResult });
  } catch (error) {
    console.error("chatWithPet error:", error);
    return res.status(500).json({ message: "대화 중 오류가 발생했습니다." });
  }
};

// 자동 멘트 생성
const getAutoComment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { lastMessages } = req.body;
    const petQuery = "SELECT * FROM pets WHERE user_id = $1";
    const petResult = await pool.query(petQuery, [userId]);
    if (petResult.rows.length === 0) return res.status(404).json({ message: "펫을 먼저 생성해주세요." });
    const pet = petResult.rows[0];

    let reply = "";
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === "your_openai_api_key_here") {
      reply = `${pet.name} : 주인이 말이 없네.. 심심하다 멍! (테스트 모드)`;
    } else {
      const contextText = lastMessages && Array.isArray(lastMessages) ? lastMessages.map((m) => `${m.sender}: ${m.message || m.text}`).join("\n") : "대화 내역 없음";
      const systemPrompt = `너는 유저의 인공지능 반려동물 '${pet.name}'이야. 성향은 '${pet.tendency}'야. 10초간 침묵 시 어색함을 깨는 한마디를 해줘. 대화 내역 참고: \n${contextText}`;
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [{ role: "system", content: systemPrompt }],
          max_tokens: 150,
          temperature: 0.8,
        });
        reply = completion.choices[0].message.content;
      } catch (err) {
        reply = "멍! 다들 어디갔어? 나랑 놀자! 🐾";
      }
    }
    return res.status(200).json({ reply, petName: pet.name, message: "자동 멘트 생성 성공" });
  } catch (error) {
    console.error("getAutoComment error:", error);
    return res.status(500).json({ message: "자동 멘트 생성 중 오류가 발생했습니다." });
  }
};

// 성향 분석
const analyzeTendency = async (req, res) => {
  try {
    const userId = req.user.id;
    const petQuery = "SELECT * FROM pets WHERE user_id = $1";
    const petResult = await pool.query(petQuery, [userId]);
    if (petResult.rows.length === 0) return res.status(404).json({ message: "펫을 먼저 생성해주세요." });
    const pet = petResult.rows[0];

    let newTendency = "neutral", newFace = "neutral", newHand = "open", newShape = "circle", analysisReason = "분석 완료";
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === "your_openai_api_key_here") {
      newTendency = "active"; newFace = "excited"; newHand = "peace"; newShape = "squircle";
    } else {
      const statsJson = JSON.stringify(pet);
      const systemPrompt = `너는 펫 인격 부여술사야. 스탯 ${statsJson} 기반으로 tendency(1개 명사), face, hand, shape, reason(1문장)을 JSON으로 반환해.`;
      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: systemPrompt }],
        max_tokens: 150, temperature: 0.7,
      });
      const parsed = JSON.parse(completion.choices[0].message.content);
      newTendency = parsed.tendency || "neutral"; newFace = parsed.face || "neutral"; newHand = parsed.hand || "open"; newShape = parsed.shape || "circle"; analysisReason = parsed.reason || "분석 완료";
    }

    const updateResult = await pool.query(`UPDATE pets SET tendency = $1, face = $2, hand = $3, shape = $4 WHERE id = $5 RETURNING *`, [newTendency, newFace, newHand, newShape, pet.id]);
    return res.status(200).json({ pet: updateResult.rows[0], reason: analysisReason, message: "성향 분석 완료" });
  } catch (error) {
    console.error("analyzeTendency error:", error);
    return res.status(500).json({ message: "성향 분석 중 오류가 발생했습니다." });
  }
};

module.exports = { performAction, chatWithPet, getAutoComment, analyzeTendency };
