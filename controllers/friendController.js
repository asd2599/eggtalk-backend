const { pool } = require("../database/database");

// 친구 요청 보내기
exports.requestFriend = async (req, res) => {
  const requester_id = req.user.id;
  const { receiver_id, receiver_pet_name } = req.body;

  try {
    let finalReceiverId = receiver_id;

    // receiver_id가 없고 receiver_pet_name만 온 경우 pets 테이블 조인 검색
    if (!finalReceiverId && receiver_pet_name) {
      const petUserResult = await pool.query(
        "SELECT user_id FROM pets WHERE name = $1",
        [receiver_pet_name],
      );
      if (petUserResult.rows.length > 0) {
        finalReceiverId = petUserResult.rows[0].user_id;
      }
    }

    if (!finalReceiverId) {
      return res
        .status(400)
        .json({ message: "요청 받을 유저의 ID 또는 펫 이름이 필요합니다." });
    }

    if (requester_id === finalReceiverId) {
      return res
        .status(400)
        .json({ message: "자기 자신에게 친구 요청을 보낼 수 없습니다." });
    }

    // 받는 유저가 존재하는지 확인
    const userCheck = await pool.query("SELECT id FROM users WHERE id = $1", [
      finalReceiverId,
    ]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ message: "존재하지 않는 유저입니다." });
    }

    const query = `
      INSERT INTO friends (requester_id, receiver_id)
      VALUES ($1, $2)
      RETURNING *;
    `;
    const result = await pool.query(query, [requester_id, finalReceiverId]);

    res.status(201).json({
      message: "친구 요청을 성공적으로 보냈습니다.",
      request: result.rows[0],
    });
  } catch (error) {
    if (error.code === "23505") {
      // 23505: unique_violation
      return res
        .status(409)
        .json({ message: "이미 친구이거나 친구 요청이 진행 중입니다." });
    }
    console.error("친구 요청 에러:", error);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
};

// 친구 요청 수락
exports.acceptFriend = async (req, res) => {
  const receiver_id = req.user.id;
  const { request_id } = req.body;

  try {
    if (!request_id) {
      return res.status(400).json({ message: "수락할 요청 ID가 필요합니다." });
    }

    const query = `
      UPDATE friends
      SET status = 'ACCEPTED', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND receiver_id = $2 AND status = 'PENDING'
      RETURNING *;
    `;
    const result = await pool.query(query, [request_id, receiver_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "유효한 친구 요청을 찾을 수 없거나 이미 처리되었습니다.",
      });
    }

    res.status(200).json({
      message: "친구 요청을 수락했습니다.",
      friend: result.rows[0],
    });
  } catch (error) {
    console.error("친구 수락 에러:", error);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
};

// 친구 요청 거절 (또는 친구 삭제)
exports.rejectFriend = async (req, res) => {
  const user_id = req.user.id;
  const { request_id } = req.body; // friend table의 PK

  try {
    if (!request_id) {
      return res
        .status(400)
        .json({ message: "거절(삭제)할 요청 ID가 필요합니다." });
    }

    // PENDING 요청을 거절하는 경우, 혹은 ACCEPTED 친구를 삭제하는 경우 모두 대응되도록 설계
    // 본인이 receiver(요청받음)이거나 requester(요청보냄)인 경우만 삭제 가능
    const query = `
      DELETE FROM friends
      WHERE id = $1 AND (receiver_id = $2 OR requester_id = $2)
      RETURNING *;
    `;
    const result = await pool.query(query, [request_id, user_id]);

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "권한이 없거나 요청을 찾을 수 없습니다." });
    }

    res.status(200).json({
      message: "친구 요청을 거절(삭제)했습니다.",
      deletedRecord: result.rows[0],
    });
  } catch (error) {
    console.error("친구 거절 에러:", error);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
};

// 내 친구 목록 조회
exports.getFriends = async (req, res) => {
  const userId = req.user.id;

  try {
    // 1. 수락된 친구 목록 (펫 정보 포함)
    const friendsQuery = `
      SELECT f.id as request_id, 
             u.id as user_id, 
             u.email as email,
             p.name as pet_name,
             p.level as pet_level,
             p.color as pet_color,
             f.status,
             f.created_at,
             f.updated_at
      FROM friends f
      JOIN users u ON u.id = CASE 
                                WHEN f.requester_id = $1 THEN f.receiver_id 
                                ELSE f.requester_id 
                             END
      LEFT JOIN pets p ON p.user_id = u.id
      WHERE (f.requester_id = $1 OR f.receiver_id = $1) 
        AND f.status = 'ACCEPTED';
    `;
    const friendsResult = await pool.query(friendsQuery, [userId]);

    // 2. 내가 받은 요청 (PENDING - 요청 보낸 사람의 펫 정보 포함)
    const receivedRequestsQuery = `
      SELECT f.id as request_id, 
             u.id as requester_id, 
             u.email as requester_email,
             p.name as pet_name,
             p.level as pet_level,
             p.color as pet_color,
             f.created_at
      FROM friends f
      JOIN users u ON f.requester_id = u.id
      LEFT JOIN pets p ON p.user_id = u.id
      WHERE f.receiver_id = $1 AND f.status = 'PENDING';
    `;
    const receivedResult = await pool.query(receivedRequestsQuery, [userId]);

    // 3. 내가 보낸 요청 (PENDING - 요청 받을 사람의 펫 정보 포함)
    const sentRequestsQuery = `
      SELECT f.id as request_id, 
             u.id as receiver_id, 
             u.email as receiver_email,
             p.name as pet_name,
             p.level as pet_level,
             p.color as pet_color,
             f.created_at
      FROM friends f
      JOIN users u ON f.receiver_id = u.id
      LEFT JOIN pets p ON p.user_id = u.id
      WHERE f.requester_id = $1 AND f.status = 'PENDING';
    `;
    const sentResult = await pool.query(sentRequestsQuery, [userId]);

    res.status(200).json({
      friends: friendsResult.rows,
      receivedRequests: receivedResult.rows,
      sentRequests: sentResult.rows,
    });
  } catch (error) {
    console.error("친구 목록 조회 에러:", error);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
};
