const { pool } = require("../../database/database");

// 상태별 상한/하한값 유지 함수 (예: 0~100 사이)
const clamp = (val, min = 0, max = 100) => Math.max(min, Math.min(max, val));

// 로그인한 유저의 펫 정보 조회
const getMyPet = async (req, res) => {
  try {
    const userId = req.user.id;
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

    // 1. 이름 중복 체크
    const nameCheckQuery = "SELECT id FROM pets WHERE name = $1";
    const nameCheckResult = await pool.query(nameCheckQuery, [name]);
    if (nameCheckResult.rows.length > 0) {
      return res.status(400).json({
        message: "이미 존재하는 펫 이름입니다. 다른 이름을 사용해주세요.",
      });
    }

    // 2. 펫 보유 중복 체크
    const checkQuery = "SELECT id FROM pets WHERE user_id = $1";
    const checkResult = await pool.query(checkQuery, [userId]);
    if (checkResult.rows.length > 0) {
      return res.status(400).json({ message: "이미 펫을 보유하고 있습니다." });
    }

    const insertQuery = `
      INSERT INTO pets (
        user_id, name, color, 
        hunger, cleanliness, health_hp, 
        knowledge, affection, altruism, logic, empathy, 
        extroversion, humor, openness, directness, curiosity,
        face, shape, hand
      ) VALUES (
        $1, $2, $3, 
        50, 50, 50, 
        50, 50, 50, 50, 50, 
        10, 10, 10, 10, 10,
        'neutral', 'circle', 'open'
      ) RETURNING *;
    `;

    const insertResult = await pool.query(insertQuery, [userId, name, color]);
    const newPet = insertResult.rows[0];

    // 생성된 펫의 ID를 users 테이블에 갱신
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

module.exports = {
  getMyPet,
  createPet,
  getRanking,
  clamp,
};
