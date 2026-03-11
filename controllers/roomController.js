const { pool } = require("../database/database");

// 전체 활성화/대기 중인 방 목록 조회 (Lounge)
exports.getRooms = async (req, res) => {
  try {
    // 1. 오래된 유령 방(대기상태 30분 이상) 및 상태 무관하게 3시간 이상 경과된 방 자동 청소
    await pool.query(`
      DELETE FROM dating_rooms 
      WHERE (status = 'waiting' AND created_at < NOW() - INTERVAL '30 minutes')
         OR (created_at < NOW() - INTERVAL '3 hours')
    `);

    // 2. 남은 방 목록 조회
    const query = `
      SELECT id, name, creator_pet_name, participant_pet_name, status, created_at
      FROM dating_rooms
      WHERE status IN ('waiting', 'active')
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query);

    // 프론트엔드 기존 방식 호환을 위한 데이터 가공
    const rooms = {};
    result.rows.forEach((row) => {
      const users = [{ id: null, petName: row.creator_pet_name }]; // socket.id는 더이상 로비에서 중요치 않음
      if (row.participant_pet_name) {
        users.push({ id: null, petName: row.participant_pet_name });
      }
      rooms[row.id] = { name: row.name, users, status: row.status };
    });

    res.json(rooms);
  } catch (err) {
    console.error("getRooms 에러:", err);
    res.status(500).json({ error: "방 목록을 불러오지 못했습니다." });
  }
};

// 방 생성
exports.createRoom = async (req, res) => {
  const { roomName, petName } = req.body;
  if (!roomName || !petName) {
    return res.status(400).json({ error: "방 이름과 펫 이름이 필요합니다." });
  }

  try {
    const query = `
      INSERT INTO dating_rooms (name, creator_pet_name, status)
      VALUES ($1, $2, 'waiting')
      RETURNING id
    `;
    const result = await pool.query(query, [roomName, petName]);
    const roomId = result.rows[0].id;

    // 생성된 후 모든 클라이언트(로비 포함)에 목록 갱신을 알림
    const io = req.app.get("io");
    if (io) {
      io.emit("rooms_updated");
    }

    res.json({ success: true, roomId });
  } catch (err) {
    console.error("createRoom 에러:", err);
    res.status(500).json({ error: "방 생성에 실패했습니다." });
  }
};

// 방 입장 (최대 2명 검증)
exports.joinRoom = async (req, res) => {
  const { roomId } = req.params;
  const { petName } = req.body;

  if (!petName) {
    return res.status(400).json({ error: "펫 이름이 필요합니다." });
  }

  // UUID 유효성 검사 (PostgreSQL UUID 문법 에러 방지)
  const uuidRegex =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!uuidRegex.test(roomId)) {
    return res.status(400).json({
      success: false,
      message: "잘못된 접근입니다 (유효하지 않은 방 형식).",
    });
  }

  try {
    // 1. 방 존재 및 상태 확인
    const checkQuery = `SELECT * FROM dating_rooms WHERE id = $1`;
    const checkResult = await pool.query(checkQuery, [roomId]);

    if (checkResult.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "존재하지 않는 방입니다." });
    }

    const room = checkResult.rows[0];

    // 자신이 만든 방일 경우 (재입장 허용 처리)
    if (room.creator_pet_name === petName) {
      return res.json({ success: true, roomId });
    }

    // 이미 들어와있는 참가자일 경우 재입장 허용
    if (room.participant_pet_name === petName) {
      return res.json({ success: true, roomId });
    }

    if (room.status === "active" || room.participant_pet_name) {
      return res
        .status(403)
        .json({ success: false, message: "방 인원이 가득 찼습니다." });
    }

    // 2. 방 입장 처리 (participant 업데이트 및 상태 변경)
    const updateQuery = `
      UPDATE dating_rooms 
      SET participant_pet_name = $1, status = 'active'
      WHERE id = $2
    `;
    await pool.query(updateQuery, [petName, roomId]);

    // 방 상태 변화 시 모든 클라이언트(로비)에 목록 갱신 알림
    const io = req.app.get("io");
    if (io) {
      io.emit("rooms_updated");
    }

    res.json({ success: true, roomId });
  } catch (err) {
    console.error("joinRoom 에러:", err);
    res.status(500).json({ error: "방 입장에 실패했습니다." });
  }
};

// 방 정보 상세 조회 (DatingPage 진입 시 상대방 파악용)
exports.getRoomInfo = async (req, res) => {
  const { roomId } = req.params;

  // UUID 유효성 검사
  const uuidRegex =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!uuidRegex.test(roomId)) {
    return res.status(400).json({
      success: false,
      message: "잘못된 접근입니다 (유효하지 않은 방 형식).",
    });
  }

  try {
    const query = `SELECT * FROM dating_rooms WHERE id = $1`;
    const result = await pool.query(query, [roomId]);

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "존재하지 않는 방입니다." });
    }

    const row = result.rows[0];

    // (변경) 각 참여자의 상세 펫 정보를 함께 불러오기 위한 쿼리
    let users = [];
    if (row.creator_pet_name || row.participant_pet_name) {
      const petNames = [row.creator_pet_name, row.participant_pet_name].filter(
        Boolean,
      );
      const petQuery = `SELECT * FROM pets WHERE name = ANY($1)`;
      const petResult = await pool.query(petQuery, [petNames]);

      users = petResult.rows.map((petRow) => ({
        id: null,
        petName: petRow.name,
        petData: petRow, // 프론트의 new Pet() 생성자에 통째로 넣을 원본 데이터
      }));
    }

    res.json({
      success: true,
      room: { id: row.id, name: row.name, users, status: row.status },
    });
  } catch (err) {
    console.error("getRoomInfo 에러:", err);
    res.status(500).json({ error: "방 정보를 불러오지 못했습니다." });
  }
};

// 방 퇴장
exports.leaveRoom = async (req, res) => {
  const { roomId } = req.params;
  const { petName } = req.body;

  if (!petName)
    return res.status(400).json({ error: "본인의 펫 이름이 필요합니다." });

  // UUID 유효성 검사
  const uuidRegex =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!uuidRegex.test(roomId)) {
    return res.status(400).json({
      success: false,
      message: "잘못된 접근입니다 (유효하지 않은 방 형식).",
    });
  }

  try {
    const checkQuery = `SELECT * FROM dating_rooms WHERE id = $1`;
    const checkResult = await pool.query(checkQuery, [roomId]);

    if (checkResult.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "이미 방이 존재하지 않습니다." });
    }

    const room = checkResult.rows[0];

    // 1. 방장(creator)이 나가는 경우
    if (room.creator_pet_name === petName) {
      if (room.participant_pet_name) {
        // 참가자 승급
        const updateQuery = `
          UPDATE dating_rooms
          SET creator_pet_name = $1, participant_pet_name = NULL, status = 'waiting'
          WHERE id = $2
        `;
        await pool.query(updateQuery, [room.participant_pet_name, roomId]);
      } else {
        const deleteQuery = `DELETE FROM dating_rooms WHERE id = $1`;
        await pool.query(deleteQuery, [roomId]);
      }
    }
    // 2. 참가자(participant)가 나가는 경우
    else if (room.participant_pet_name === petName) {
      if (room.creator_pet_name) {
        const updateQuery = `
          UPDATE dating_rooms
          SET participant_pet_name = NULL, status = 'waiting'
          WHERE id = $1
        `;
        await pool.query(updateQuery, [roomId]);
      } else {
        const deleteQuery = `DELETE FROM dating_rooms WHERE id = $1`;
        await pool.query(deleteQuery, [roomId]);
      }
    }

    // 퇴장/방 폭파 후 모든 클라이언트(로비 포함)에 목록 갱신을 알림
    const io = req.app.get("io");
    if (io) {
      // 퇴장 메시지 먼저 남은 사람에게 쏘기
      io.to(roomId).emit("receive_dating_message", {
        sender: "System",
        message: `${petName}님이 방을 나갔습니다.`,
        isSystem: true,
      });
      // 이후 전체 로비 갱신
      io.emit("rooms_updated");
    }

    res.json({ success: true, message: "정상적으로 퇴장했습니다." });
  } catch (err) {
    console.error("leaveRoom 에러:", err);
    res.status(500).json({ error: "방 퇴장 처리에 실패했습니다." });
  }
};
