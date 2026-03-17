const { pool } = require("../database/database");

// 쪽지 보내기
exports.sendMessage = async (req, res) => {
  const sender_id = req.user.id;
  const { receiver_id, content } = req.body;

  if (!receiver_id || !content) {
    return res.status(400).json({ message: "수신자 ID와 내용을 모두 입력해주세요." });
  }

  try {
    const query = `
      INSERT INTO messages (sender_id, receiver_id, content)
      VALUES ($1, $2, $3)
      RETURNING *;
    `;
    const result = await pool.query(query, [sender_id, receiver_id, content]);

    // 수신자의 펫 이름을 가져와서 소켓 알림 등에 활용할 수 있도록 함
    const receiverPetQuery = "SELECT name FROM pets WHERE user_id = $1";
    const receiverPet = await pool.query(receiverPetQuery, [receiver_id]);

    res.status(201).json({
      success: true,
      message: "쪽지를 성공적으로 보냈습니다.",
      data: result.rows[0],
      receiverPetName: receiverPet.rows[0]?.name
    });
  } catch (error) {
    console.error("쪽지 전송 에러:", error);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
};

// 쪽지 목록 조회 (내가 받은 쪽지)
exports.getReceivedMessages = async (req, res) => {
  const userId = req.user.id;

  try {
    const query = `
      SELECT m.*, p.name as sender_pet_name, p.color as sender_pet_color
      FROM messages m
      JOIN pets p ON m.sender_id = p.user_id
      WHERE m.receiver_id = $1
      ORDER BY m.created_at DESC;
    `;
    const result = await pool.query(query, [userId]);

    res.status(200).json({
      success: true,
      messages: result.rows
    });
  } catch (error) {
    console.error("쪽지 조회 에러:", error);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
};

// 쪽지 목록 조회 (내가 보낸 쪽지)
exports.getSentMessages = async (req, res) => {
  console.log("[DEBUG-BACK] getSentMessages hit for user:", req.user.id);
  const userId = req.user.id;

  try {
    const query = `
      SELECT m.*, p.name as receiver_pet_name, p.color as receiver_pet_color
      FROM messages m
      JOIN pets p ON m.receiver_id = p.user_id
      WHERE m.sender_id = $1
      ORDER BY m.created_at DESC;
    `;
    const result = await pool.query(query, [userId]);

    res.status(200).json({
      success: true,
      messages: result.rows
    });
  } catch (error) {
    console.error("보낸 쪽지 조회 에러:", error);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
};

// 읽음 처리
exports.markAsRead = async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  try {
    const query = `
      UPDATE messages
      SET is_read = TRUE
      WHERE id = $1 AND receiver_id = $2
      RETURNING *;
    `;
    const result = await pool.query(query, [id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "쪽지를 찾을 수 없거나 권한이 없습니다." });
    }

    res.status(200).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error("쪽지 읽음 처리 에러:", error);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
};

// 쪽지 삭제
exports.deleteMessage = async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  try {
    const query = `
      DELETE FROM messages
      WHERE id = $1 AND (sender_id = $2 OR receiver_id = $2)
      RETURNING *;
    `;
    const result = await pool.query(query, [id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "쪽지를 찾을 수 없거나 권한이 없습니다." });
    }

    res.status(200).json({
      success: true,
      message: "쪽지가 삭제되었습니다."
    });
  } catch (error) {
    console.error("쪽지 삭제 에러:", error);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
};
