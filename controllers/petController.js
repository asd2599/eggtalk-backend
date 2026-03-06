const { pool } = require("../database/database");
const { OpenAI } = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "dummy_key",
});

// 로그인한 유저의 펫 정보 조회
const getMyPet = async (req, res) => {
  try {
    const userId = req.user.id; // 인증 미들웨어에서 넘어온 유저 정보 가정

    const query = "SELECT * FROM pets WHERE user_id = $1";
    const result = await pool.query(query, [userId]);

    if (result.rows.length === 0) {
      return res.status(200).json({
        pet: null,
        message: "펫이 존재하지 않습니다. 생성페이지로 이동하세요.",
      });
    }

    return res
      .status(200)
      .json({ pet: result.rows[0], message: "펫 조회 성공" });
  } catch (error) {
    console.error("getMyPet error:", error);
    return res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
};

// 펫 초기 생성
const createPet = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, color } = req.body;

    if (!name || !color) {
      return res
        .status(400)
        .json({ message: "이름과 색상은 필수 입력값입니다." });
    }

    // 펫 보유 중복 체크
    const checkQuery = "SELECT id FROM pets WHERE user_id = $1";
    const checkResult = await pool.query(checkQuery, [userId]);
    if (checkResult.rows.length > 0) {
      return res.status(400).json({ message: "이미 펫을 보유하고 있습니다." });
    }

    const insertQuery = `
      INSERT INTO pets (
        user_id, name, color, level, exp, hunger, cleanliness, health_hp, stress, 
        knowledge, affection, altruism, logic, empathy, 
        extroversion, humor, openness, directness, curiosity,
        tendency
      ) VALUES (
        $1, $2, $3, 1, 0, 100, 100, 100, 0,
        0, 0, 0, 0, 0,
        0, 0, 0, 0, 0,
        'neutral'
      ) RETURNING *;
    `;

    const insertResult = await pool.query(insertQuery, [userId, name, color]);
    const newPet = insertResult.rows[0];

    // ✅ 생성된 펫의 ID를 users 테이블에 갱신
    await pool.query("UPDATE users SET pet_id = $1 WHERE id = $2", [
      newPet.id,
      userId,
    ]);

    return res.status(201).json({ pet: newPet, message: "펫 생성 완료" });
  } catch (error) {
    console.error("createPet error:", error);
    return res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
};

// 상태별 상한/하한값 유지 함수 (예: 0~100 사이)
const clamp = (val, min = 0, max = 100) => Math.max(min, Math.min(max, val));

// 액션 데이터 (프론트와 동일한 구조)
const ACTIONS_DATA = {
  1001: {
    category: "Eating",
    name: "Eating",
    increaseStatus: "health_hp",
    increaseValue: 5,
    decreaseStatus: "hunger",
    decreaseValue: -20,
    exp: 10,
  },
  1002: {
    category: "Cleaning",
    name: "Cleaning",
    increaseStatus: "cleanliness",
    increaseValue: 30,
    decreaseStatus: "stress",
    decreaseValue: -5,
    exp: 5,
  },
  1003: {
    category: "Sleep",
    name: "Sleep 1",
    increaseStatus: "health_hp",
    increaseValue: 40,
    decreaseStatus: "stress",
    decreaseValue: -30,
    exp: 5,
  },
  1004: {
    category: "Sleep",
    name: "Sleep 2",
    increaseStatus: "health_hp",
    increaseValue: 40,
    decreaseStatus: "hunger",
    decreaseValue: 20,
    exp: 5,
  },
  1005: {
    category: "Playing",
    name: "Playing 1",
    increaseStatus: "affection",
    increaseValue: 10,
    decreaseStatus: "hunger",
    decreaseValue: 10,
    exp: 15,
  },
  1006: {
    category: "Playing",
    name: "Playing 2",
    increaseStatus: "hunger",
    increaseValue: 10,
    decreaseStatus: "stress",
    decreaseValue: -15,
    exp: 20,
  },
  1007: {
    category: "Volunteer",
    name: "Volunteer 1",
    increaseStatus: "altruism",
    increaseValue: 10,
    decreaseStatus: "health_hp",
    decreaseValue: -5,
    exp: 25,
  },
  1008: {
    category: "Volunteer",
    name: "Volunteer 2",
    increaseStatus: "empathy",
    increaseValue: 5,
    decreaseStatus: "health_hp",
    decreaseValue: -10,
    exp: 25,
  },
  1009: {
    category: "Chat",
    name: "Chat 1",
    increaseStatus: "empathy",
    increaseValue: 5,
    exp: 10,
  },
  1010: {
    category: "Chat",
    name: "Chat 2",
    increaseStatus: "affection",
    increaseValue: 5,
    exp: 10,
  },
  1011: {
    category: "Chat",
    name: "Chat 3",
    increaseStatus: "knowledge",
    increaseValue: 5,
    exp: 10,
  },
  1012: {
    category: "Playing",
    name: "Playing 3",
    increaseStatus: "logic",
    increaseValue: 10,
    decreaseStatus: "stress",
    decreaseValue: -5,
    exp: 15,
  },
};

// 액션 실행
const performAction = async (req, res) => {
  try {
    const userId = req.user.id;
    const { actionKey } = req.body;

    const action = ACTIONS_DATA[actionKey];
    if (!action) {
      return res.status(400).json({ message: "유효하지 않은 액션입니다." });
    }

    // 현재 펫 상태 조회
    const getQuery = "SELECT * FROM pets WHERE user_id = $1";
    const getResult = await pool.query(getQuery, [userId]);

    if (getResult.rows.length === 0) {
      return res.status(404).json({ message: "펫을 찾을 수 없습니다." });
    }

    const pet = getResult.rows[0];

    // 스탯 업데이트
    if (action.increaseStatus) {
      pet[action.increaseStatus] = clamp(
        Number(pet[action.increaseStatus]) + Number(action.increaseValue),
      );
    }
    if (action.decreaseStatus) {
      pet[action.decreaseStatus] = clamp(
        Number(pet[action.decreaseStatus]) + Number(action.decreaseValue),
      );
    }

    // 경험치 및 레벨업 처리 로직 (간단 구현)
    pet.exp += action.exp;
    const expNeeded = pet.level * 100; // 예시로 레벨당 100의 경험치 필요라고 가정
    if (pet.exp >= expNeeded) {
      pet.level += 1;
      pet.exp -= expNeeded; // 잔여 경험치 이월
    }

    // 업데이트 쿼리
    const updateQuery = `
      UPDATE pets
      SET 
        exp = $1,
        level = $2,
        health_hp = $3,
        hunger = $4,
        cleanliness = $5,
        stress = $6,
        affection = $7,
        altruism = $8,
        empathy = $9,
        knowledge = $10,
        logic = $11,
        extroversion = $12,
        humor = $13,
        openness = $14,
        directness = $15,
        curiosity = $16
      WHERE user_id = $17
      RETURNING *;
    `;

    const values = [
      Number(pet.exp) || 0,
      Number(pet.level) || 1,
      Number(pet.health_hp) || 0,
      Number(pet.hunger) || 0,
      Number(pet.cleanliness) || 0,
      Number(pet.stress) || 0,
      Number(pet.affection) || 0,
      Number(pet.altruism) || 0,
      Number(pet.empathy) || 0,
      Number(pet.knowledge) || 0,
      Number(pet.logic) || 0,
      Number(pet.extroversion) || 0,
      Number(pet.humor) || 0,
      Number(pet.openness) || 0,
      Number(pet.directness) || 0,
      Number(pet.curiosity) || 0,
      userId,
    ];

    const updateResult = await pool.query(updateQuery, values);

    return res
      .status(200)
      .json({ pet: updateResult.rows[0], message: "액션 수행 성공" });
  } catch (error) {
    console.error("performAction error:", error);
    return res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
};

// 상위 10개 펫 랭킹 조회
const getRanking = async (req, res) => {
  try {
    const query = `
      SELECT id, name, color, level, exp, user_id
      FROM pets
      ORDER BY level DESC, exp DESC
      LIMIT 10
    `;
    const result = await pool.query(query);

    return res.status(200).json({
      ranking: result.rows,
      message: "랭킹 조회 성공",
    });
  } catch (error) {
    console.error("getRanking error:", error);
    return res
      .status(500)
      .json({ message: "랭킹을 불러오는 중 오류가 발생했습니다." });
  }
};

// 펫과 채팅 & 경험치 보상
const chatWithPet = async (req, res) => {
  try {
    const userId = req.user.id;
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ message: "메시지를 입력해주세요." });
    }

    // 1. 유저 펫 정보 로드
    const petQuery = "SELECT * FROM pets WHERE user_id = $1";
    const petResult = await pool.query(petQuery, [userId]);

    if (petResult.rows.length === 0) {
      return res.status(404).json({ message: "펫을 먼저 생성해주세요." });
    }
    const pet = petResult.rows[0];

    // 2. OpenAI API 호출
    let reply = "";
    let analysisResult = {
      empathy: 0,
      logic: 0,
      knowledge: 0,
      affection: 0,
      altruism: 0,
      extroversion: 0,
      humor: 0,
      openness: 0,
      directness: 0,
      curiosity: 0,
    };

    if (
      !process.env.OPENAI_API_KEY ||
      process.env.OPENAI_API_KEY === "your_openai_api_key_here"
    ) {
      reply = `(API 키가 없어 임시 모드로 대답할게!) 바우와우~ "${message}"라고 했어? 재미있다 멍!`;
      analysisResult.empathy = 2; // 테스트용 임시 수치
      analysisResult.affection = 3;
    } else {
      const systemPrompt = `
        너는 이제 사용자의 소중한 인공지능 반려동물이야.
        이름은 '${pet.name}'이고, 성향은 '${pet.tendency}'야. (neutral, active, calm 등 다양해)

        아래 두 가지 작업을 수행하고 JSON 형식으로만 반환해:
        1. "reply": 사용자의 메시지에 대해 짧고 귀엽게 1~2문장으로 대답. 이모지도 사용하고 '멍', '냥' 같은 말투 포함.
        2. "analysis": **네가 할 대답이 아니라, 방금 사용자가 입력한 메시지 자체를 분석**해서 해당 메시지가 지닌 성격을 기준으로 아래 10가지 능력치 증감을 -5 ~ +5 정수로 평가해.
        {
          "reply": "여기에 대답 작성",
          "analysis": {
            "empathy": (사용자 메시지에 나타난 공감 능력, -5 ~ 5 정수),
            "logic": (사용자 메시지에 나타난 논리력, -5 ~ 5 정수),
            "knowledge": (사용자 메시지에 나타난 지식 수준, -5 ~ 5 정수),
            "affection": (사용자 메시지에 나타난 애정도, -5 ~ 5 정수),
            "altruism": (사용자 메시지에 나타난 이타성, -5 ~ 5 정수),
            "extroversion": (사용자 메시지에 나타난 외향성, -5 ~ 5 정수),
            "humor": (사용자 메시지에 나타난 유머 감각, -5 ~ 5 정수),
            "openness": (사용자 메시지에 나타난 개방성/수용성, -5 ~ 5 정수),
            "directness": (사용자 메시지에 나타난 직설성/솔직함, -5 ~ 5 정수),
            "curiosity": (사용자 메시지에 나타난 호기심, -5 ~ 5 정수)
          }
        }
        연관이 없는 능력치는 0으로 고정해.
      `;

      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: message },
          ],
          max_tokens: 250,
          temperature: 0.8,
        });

        const responseContent = completion.choices[0].message.content;
        const parsedResponse = JSON.parse(responseContent);

        reply = parsedResponse.reply || "멍멍! 잘 이해하지 못했어요.";
        analysisResult = {
          ...analysisResult,
          ...(parsedResponse.analysis || {}),
        };
      } catch (error) {
        console.error("AI 분석 파싱 에러:", error);
        reply = "멍! (응답을 분석하는데 실패했어..!)";
      }
    }

    // 3. 대화 시 경험치 상승 및 분석된 점수로 DB 갱신
    const clampValue = (val, max = 100) => Math.max(0, Math.min(max, val));

    // pet의 현재 상태값에 analysisResult 증감을 더해서 업데이트
    const newEmpathy = clampValue(pet.empathy + (analysisResult.empathy || 0));
    const newLogic = clampValue(pet.logic + (analysisResult.logic || 0));
    const newKnowledge = clampValue(
      pet.knowledge + (analysisResult.knowledge || 0),
    );
    const newAffection = clampValue(
      pet.affection + (analysisResult.affection || 0),
    );
    const newAltruism = clampValue(
      pet.altruism + (analysisResult.altruism || 0),
    );
    const newExtroversion = clampValue(
      pet.extroversion + (analysisResult.extroversion || 0),
    );
    const newHumor = clampValue(pet.humor + (analysisResult.humor || 0));
    const newOpenness = clampValue(
      pet.openness + (analysisResult.openness || 0),
    );
    const newDirectness = clampValue(
      pet.directness + (analysisResult.directness || 0),
    );
    const newCuriosity = clampValue(
      pet.curiosity + (analysisResult.curiosity || 0),
    );

    const updateQuery = `
      UPDATE pets
      SET 
        exp = exp + 10,
        empathy = $1,
        logic = $2,
        knowledge = $3,
        affection = $4,
        altruism = $5,
        extroversion = $6,
        humor = $7,
        openness = $8,
        directness = $9,
        curiosity = $10
      WHERE id = $11
      RETURNING *
    `;
    const updateResult = await pool.query(updateQuery, [
      newEmpathy,
      newLogic,
      newKnowledge,
      newAffection,
      newAltruism,
      newExtroversion,
      newHumor,
      newOpenness,
      newDirectness,
      newCuriosity,
      pet.id,
    ]);
    const updatedPet = updateResult.rows[0];

    // 레벨업 로직 (요구경험치 100 * level)
    const requiredExp = updatedPet.level * 100;
    if (updatedPet.exp >= requiredExp) {
      const levelUpQuery = `
        UPDATE pets
        SET
          level = level + 1,
          exp = exp - $2,
          health_hp = 100
        WHERE id = $1
        RETURNING *
      `;
      const levelUpResult = await pool.query(levelUpQuery, [
        pet.id,
        requiredExp,
      ]);
      return res
        .status(200)
        .json({ reply, pet: levelUpResult.rows[0], analysis: analysisResult });
    }

    return res
      .status(200)
      .json({ reply, pet: updatedPet, analysis: analysisResult });
  } catch (error) {
    console.error("chatWithPet error:", error);
    return res.status(500).json({ message: "대화 중 오류가 발생했습니다." });
  }
};

// AI 성향 분석 및 업데이트
const analyzeTendency = async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. 유저 펫 정보 로드
    const petQuery = "SELECT * FROM pets WHERE user_id = $1";
    const petResult = await pool.query(petQuery, [userId]);

    if (petResult.rows.length === 0) {
      return res.status(404).json({ message: "펫을 먼저 생성해주세요." });
    }
    const pet = petResult.rows[0];

    // 2. OpenAI API 호출
    let newTendency = "neutral";
    let analysisReason = "기본 성향 유지중";

    if (
      !process.env.OPENAI_API_KEY ||
      process.env.OPENAI_API_KEY === "your_openai_api_key_here"
    ) {
      newTendency = "active";
      analysisReason = "(테스트 모드) 임의의 성향으로 변경되었습니다.";
    } else {
      const statsJson = JSON.stringify({
        level: pet.level,
        exp: pet.exp,
        hunger: pet.hunger,
        cleanliness: pet.cleanliness,
        health_hp: pet.health_hp,
        stress: pet.stress,
        affection: pet.affection,
        knowledge: pet.knowledge,
        empathy: pet.empathy,
        logic: pet.logic,
        altruism: pet.altruism,
        extroversion: pet.extroversion,
        humor: pet.humor,
        openness: pet.openness,
        directness: pet.directness,
        curiosity: pet.curiosity,
      });

      const systemPrompt = `
        다음은 가상의 인공지능 펫의 종합적인 현재 능력치 및 상태(JSON 포맷) 데이터야: 
        ${statsJson}
        
        네 목표는 이 데이터를 종합적으로 고려하여 이 펫에게 가장 어울리는 단어를 아래 10개의 **영문 소문자** 성향 중에서 단 '1개'만 선택하는 거야.
        
        [선택 가능한 성향 목록]
        neutral (중립적인, 특징이 적음)
        active (활동적인, 스트레스가 낮고 체력이 높음)
        calm (차분한, 지식이나 논리가 상대적으로 높음)
        affectionate (애교 많은, 애정도가 유독 높음)
        empathetic (공감을 잘하는, 공감이 높음)
        smart (영리한, 지식이 매우 높음)
        logical (논리적인, 논리 수치가 높음)
        altruistic (이타적인, 이타성이 높음)
        gloomy (우울한, 스트레스가 높고 애정도 등 감정이 모두 낮음)
        hungry (식탐많은, 포만감이 비정상적으로 부족함)

        다음 JSON 형식으로만 응답해:
        {
          "tendency": "(위 목록 중 정확히 일치하는 단어 1개)",
          "reason": "(이 성향을 선택한 이유를 사용자가 보기 좋게 1문장으로 한국어로 설명)"
        }
      `;

      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: systemPrompt }],
          max_tokens: 150,
          temperature: 0.5,
        });

        const responseContent = completion.choices[0].message.content;
        const parsedResponse = JSON.parse(responseContent);

        newTendency = parsedResponse.tendency || "neutral";
        analysisReason = parsedResponse.reason || "능력치 기반 분석 완료";

        // 유효한 성향인지 확인(10개 중 하나인지), 아니라면 기본값 처리
        const validTendencies = [
          "neutral",
          "active",
          "calm",
          "affectionate",
          "empathetic",
          "smart",
          "logical",
          "altruistic",
          "gloomy",
          "hungry",
        ];
        if (!validTendencies.includes(newTendency)) {
          newTendency = "neutral";
        }
      } catch (error) {
        console.error("성향 분석 파싱 에러:", error);
        return res
          .status(500)
          .json({ message: "성향을 분석하는 중 에러가 발생했습니다." });
      }
    }

    // 3. 분석된 성향으로 DB 업데이트
    const updateQuery = `
      UPDATE pets
      SET tendency = $1
      WHERE id = $2
      RETURNING *
    `;
    const updateResult = await pool.query(updateQuery, [newTendency, pet.id]);
    const updatedPet = updateResult.rows[0];

    return res.status(200).json({
      pet: updatedPet,
      reason: analysisReason,
      message: "성향 분석 완료",
    });
  } catch (error) {
    console.error("analyzeTendency error:", error);
    return res
      .status(500)
      .json({ message: "성향 분석 중 오류가 발생했습니다." });
  }
};

// 상대방 펫 선물하기
const giftToPet = async (req, res) => {
  try {
    const userId = req.user.id;
    const { targetPetName, giftName, stats, message } = req.body;

    if (!targetPetName || !stats) {
      return res
        .status(400)
        .json({ message: "대상 펫 이름과 선물 스탯 정보가 필요합니다." });
    }

    // 대상 펫 정보 조회
    const getQuery = "SELECT * FROM pets WHERE name = $1";
    const getResult = await pool.query(getQuery, [targetPetName]);

    if (getResult.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "선물 받을 펫을 찾을 수 없습니다." });
    }

    const pet = getResult.rows[0];

    // 스탯 업데이트 적용
    for (const [key, value] of Object.entries(stats)) {
      // pets 테이블에 존재하는 컬럼인지 간이 체크 후 적용
      if (pet.hasOwnProperty(key)) {
        pet[key] = clamp(Number(pet[key]) + Number(value));
      }
    }

    // 선물 수령에 따른 기본 보너스 경험치 15 고정 부여
    pet.exp += 15;
    const expNeeded = pet.level * 100;
    if (pet.exp >= expNeeded) {
      pet.level += 1;
      pet.exp -= expNeeded;
    }

    // 업데이트 쿼리 (performAction 과 유사)
    const updateQuery = `
      UPDATE pets
      SET 
        exp = $1,
        level = $2,
        health_hp = $3,
        hunger = $4,
        cleanliness = $5,
        stress = $6,
        affection = $7,
        altruism = $8,
        empathy = $9,
        knowledge = $10,
        logic = $11,
        extroversion = $12,
        humor = $13,
        openness = $14,
        directness = $15,
        curiosity = $16
      WHERE name = $17
      RETURNING *;
    `;

    const values = [
      Number(pet.exp) || 0,
      Number(pet.level) || 1,
      Number(pet.health_hp) || 0,
      Number(pet.hunger) || 0,
      Number(pet.cleanliness) || 0,
      Number(pet.stress) || 0,
      Number(pet.affection) || 0,
      Number(pet.altruism) || 0,
      Number(pet.empathy) || 0,
      Number(pet.knowledge) || 0,
      Number(pet.logic) || 0,
      Number(pet.extroversion) || 0,
      Number(pet.humor) || 0,
      Number(pet.openness) || 0,
      Number(pet.directness) || 0,
      Number(pet.curiosity) || 0,
      targetPetName,
    ];

    const updateResult = await pool.query(updateQuery, values);

    // AI 대답 생성 로직
    let reply = "";
    if (message && message.trim() !== "") {
      const systemPrompt = `너는 이제 사용자의 소중한 인공지능 반려동물이야.
이름은 '${pet.name}'이고, 성향은 '${pet.tendency}'야.

사용자가 방금 너에게 특별한 선물 '${req.body.giftName || "선물"}'을 주면서 이렇게 말했어: "${message.trim()}"

이 선물을 받은 소감과 감사 인사를 너의 성향에 맞게 귀엽게 1~2문장으로 대답해줘. 이모지도 꼭 포함해.`;

      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [{ role: "system", content: systemPrompt }],
          max_tokens: 150,
          temperature: 0.8,
        });
        reply = completion.choices[0].message.content;
      } catch (err) {
        console.error("AI 선물 대답 파싱 에러:", err);
        reply = "멍! 선물 고마워!! (에러로 인해 응답 실패)";
      }
    }

    return res.status(200).json({
      pet: updateResult.rows[0],
      message: "선물을 성공적으로 전달했습니다!",
      reply: reply,
    });
  } catch (error) {
    console.error("giftToPet error:", error);
    return res
      .status(500)
      .json({ message: "선물 처리 중 오류가 발생했습니다." });
  }
};

module.exports = {
  getMyPet,
  createPet,
  performAction,
  getRanking,
  chatWithPet,
  analyzeTendency,
  giftToPet,
};
