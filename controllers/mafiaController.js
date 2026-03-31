const { pool } = require("../database/database");

// 방 목록 조회
exports.getMafiaRooms = async (req, res) => {
  try {
    // 30분 이상 경과된 대기 중인 방 자동 삭제
    await pool.query(`
      DELETE FROM mafia_rooms 
      WHERE created_at < NOW() - INTERVAL '30 minutes' 
      AND status = 'waiting'
    `);

    const query = `
      SELECT r.*, p.name as host_name, 
      (SELECT COUNT(*) FROM mafia_participants WHERE room_id = r.id) as current_players
      FROM mafia_rooms r
      LEFT JOIN pets p ON r.host_id = p.id
      WHERE r.status = 'waiting'
      ORDER BY r.created_at DESC
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: "방 목록 조회 실패", error: err.message });
  }
};

// 방 생성
exports.createMafiaRoom = async (req, res) => {
  const { title, petId } = req.body;
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      
      const roomRes = await client.query(
        "INSERT INTO mafia_rooms (title, host_id) VALUES ($1, $2) RETURNING id",
        [title, petId]
      );
      const roomId = roomRes.rows[0].id;
      
      await client.query(
        "INSERT INTO mafia_participants (room_id, pet_id, is_ready) VALUES ($1, $2, $3)",
        [roomId, petId, true] // 방장은 기본적으로 레디 상태
      );
      
      await client.query("COMMIT");
      res.json({ success: true, roomId });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ message: "방 생성 실패", error: err.message });
  }
};

// 방 참여
exports.joinMafiaRoom = async (req, res) => {
  const { roomId } = req.params;
  const { petId } = req.body;
  try {
    const roomCheck = await pool.query("SELECT * FROM mafia_rooms WHERE id = $1", [roomId]);
    if (roomCheck.rows.length === 0) return res.status(404).json({ message: "방을 찾을 수 없습니다." });
    
    const countCheck = await pool.query("SELECT COUNT(*) FROM mafia_participants WHERE room_id = $1", [roomId]);
    if (countCheck.rows[0].count >= 4) return res.status(400).json({ message: "방이 가득 찼습니다. (최대 4명)" });

    await pool.query(
      "INSERT INTO mafia_participants (room_id, pet_id) VALUES ($1, $2) ON CONFLICT (room_id, pet_id) DO NOTHING",
      [roomId, petId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "방 참여 실패", error: err.message });
  }
};

// 레디 토글
exports.toggleReady = async (req, res) => {
  const { roomId } = req.params;
  const { petId, isReady } = req.body;
  try {
    await pool.query(
      "UPDATE mafia_participants SET is_ready = $1 WHERE room_id = $2 AND pet_id = $3",
      [isReady, roomId, petId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "레디 상태 변경 실패", error: err.message });
  }
};

// 방 참여자 정보 조회
exports.getRoomParticipants = async (req, res) => {
  const { roomId } = req.params;
  try {
    const query = `
      SELECT p.*, pets.name, pets.face, pets.shape, pets.hand, pets.color, pets.tendency
      FROM mafia_participants p
      JOIN pets ON p.pet_id = pets.id
      WHERE p.room_id = $1
      ORDER BY p.joined_at ASC
    `;
    const result = await pool.query(query, [roomId]);
    const roomInfo = await pool.query("SELECT * FROM mafia_rooms WHERE id = $1", [roomId]);
    res.json({ participants: result.rows, room: roomInfo.rows[0] });
  } catch (err) {
    res.status(500).json({ message: "참여자 정보 조회 실패", error: err.message });
  }
};

// 방 퇴장
exports.leaveMafiaRoom = async (req, res) => {
  const { roomId } = req.params;
  const { petId } = req.body;
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 참여자 목록에서 삭제
      await client.query(
        "DELETE FROM mafia_participants WHERE room_id = $1 AND pet_id = $2",
        [roomId, petId]
      );

      // 방 정보 확인
      const roomRes = await client.query("SELECT host_id FROM mafia_rooms WHERE id = $1", [roomId]);
      if (roomRes.rows.length > 0) {
        const remainingRes = await client.query(
          "SELECT pet_id FROM mafia_participants WHERE room_id = $1 ORDER BY joined_at ASC LIMIT 1",
          [roomId]
        );

        if (remainingRes.rows.length === 0) {
          // 남은 사람이 없으면 방 삭제
          await client.query("DELETE FROM mafia_rooms WHERE id = $1", [roomId]);
        } else if (roomRes.rows[0].host_id === parseInt(petId)) {
          // 방장이 나갔으면 다음 사람에게 방장 위임
          const nextHostId = remainingRes.rows[0].pet_id;
          await client.query(
            "UPDATE mafia_rooms SET host_id = $1 WHERE id = $2",
            [nextHostId, roomId]
          );
          // 새로운 방장은 자동으로 레디 상태로 변경
          await client.query(
            "UPDATE mafia_participants SET is_ready = true WHERE room_id = $1 AND pet_id = $2",
            [roomId, nextHostId]
          );
        }
      }

      await client.query("COMMIT");
      res.json({ success: true });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ message: "방 퇴장 실패", error: err.message });
  }
};

// AI 참가자 추가
exports.addAiParticipant = async (req, res) => {
  const { roomId } = req.params;
  try {
    // 1. 방 정보 및 인원 확인
    const countCheck = await pool.query("SELECT COUNT(*) FROM mafia_participants WHERE room_id = $1", [roomId]);
    if (countCheck.rows[0].count >= 4) return res.status(400).json({ message: "방이 가득 찼습니다." });

    // 2. 현재 방에 없는 랜덤 펫 하나 가져오기 (전체 펫 중에서 선택)
    const randomPetQuery = `
      SELECT id FROM pets 
      WHERE id NOT IN (SELECT pet_id FROM mafia_participants WHERE room_id = $1)
      ORDER BY RANDOM() LIMIT 1
    `;
    const petRes = await pool.query(randomPetQuery, [roomId]);
    if (petRes.rows.length === 0) return res.status(404).json({ message: "사용 가능한 AI 펫이 없습니다." });

    const petId = petRes.rows[0].id;

    // 3. 참여자로 추가 (봇은 항상 레디)
    await pool.query(
      "INSERT INTO mafia_participants (room_id, pet_id, is_ready) VALUES ($1, $2, true) ON CONFLICT DO NOTHING",
      [roomId, petId]
    );

    res.json({ success: true, petId });
  } catch (err) {
    res.status(500).json({ message: "AI 추가 실패", error: err.message });
  }
};
