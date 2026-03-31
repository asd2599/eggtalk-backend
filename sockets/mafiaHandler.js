const { pool } = require("../database/database");
const { generateMafiaPetOpinion } = require("../services/mafiaService");

// 서버 메모리에 방 상태 저장
const mafiaRooms = new Map();

module.exports = (io, socket, state) => {
  
  socket.on("mafia_join_room", async ({ roomId }) => {
    const roomName = `mafia_room_${roomId}`;
    socket.join(roomName);
    socket.mafiaRoomId = roomId;
    io.to(roomName).emit("mafia_sync_needed");
  });

  socket.on("mafia_toggle_ready", ({ roomId }) => {
    io.to(`mafia_room_${roomId}`).emit("mafia_sync_needed");
  });

  socket.on("mafia_send_message", async ({ roomId, text, sender }) => {
    const roomName = `mafia_room_${roomId}`;
    const room = mafiaRooms.get(roomId);
    
    if (room?.phase === 'vote') {
      return; // 투표 중 채팅 금지
    }

    const senderPlayer = room?.players.find(p => p.anonName === sender);
    if (senderPlayer?.isDead) return;

    const msg = { sender, text, isPet: false, timestamp: Date.now() };
    if (room) {
      room.messages.push(msg);
      if (room.messages.length > 50) room.messages.shift();
    }
    io.to(roomName).emit("mafia_message", msg);
  });

  // 투표 기능
  socket.on("mafia_cast_vote", ({ roomId, targetId }) => {
    const room = mafiaRooms.get(roomId);
    if (!room || room.phase !== 'vote') return;

    // 누가 투표했는지 (소켓에 저장된 정보 혹은 프론트에서 보낸 sender 정보 활용 가능하지만, 보안상 소켓 연동 권장)
    // 여기선 간단히 펫ID 매칭으로 투표자 식별 (실제 서비스에선 세션/토큰 활용)
    // 프론트에서 내 정보(p.id)도 같이 보내도록 수정 필요하지만, 여기선 일단 소켓 매칭 시도
    const voter = room.players.find(p => p.type === 'human' && !p.isDead); // TODO: 더 정교한 매칭
    if (voter) {
        room.votes[voter.id] = targetId;
        io.to(`mafia_room_${roomId}`).emit("mafia_vote_synced", { votes: room.votes });
    }
  });

  socket.on("mafia_leave_game", async ({ roomId }) => {
    stopGame(io, roomId, "플레이어가 퇴장하여 게임을 종료합니다.");
  });

  socket.on("mafia_start_game", async ({ roomId }) => {
    const roomName = `mafia_room_${roomId}`;
    try {
      const participantsQuery = `
        SELECT p.*, pets.name as pet_name FROM mafia_participants p
        JOIN pets ON p.pet_id = pets.id WHERE p.room_id = $1
      `;
      const { rows: participants } = await pool.query(participantsQuery, [roomId]);
      if (participants.length < 1) return;

      const anonymousNames = ["침착한 갈매기", "용감한 거북이", "날렵한 치타", "똑똑한 부엉이", "온순한 양", "무서운 사자", "빠른 토끼", "느긋한 판다", "우아한 학", "고독한 늑대", "활기찬 돌고래", "다정한 코끼리", "영리한 여우", "우직한 곰", "화려한 공작", "신중한 사슴"];
      const shuffledNames = anonymousNames.sort(() => Math.random() - 0.5);
      
      let gamePlayers = [];
      participants.forEach((p, idx) => {
        gamePlayers.push({ id: `h_${p.pet_id}`, petId: p.pet_id, type: 'human', anonName: shuffledNames[idx * 2], isDead: false, role: 'citizen' });
        gamePlayers.push({ id: `p_${p.pet_id}`, petId: p.pet_id, type: 'pet', anonName: shuffledNames[idx * 2 + 1], isDead: false, role: 'citizen', ownerPetId: p.pet_id });
      });

      const totalCount = gamePlayers.length;
      const mafiaCount = totalCount >= 8 ? 2 : 1;
      const mafiaIndices = [];
      while (mafiaIndices.length < mafiaCount) {
        const r = Math.floor(Math.random() * totalCount);
        if (!mafiaIndices.includes(r)) mafiaIndices.push(r);
      }
      mafiaIndices.forEach(idx => gamePlayers[idx].role = 'mafia');

      mafiaRooms.set(roomId, { roomId, players: gamePlayers, phase: 'day', timer: 120, messages: [], votes: {}, interval: null, aiTimeout: null });
      await pool.query("UPDATE mafia_rooms SET status = 'playing' WHERE id = $1", [roomId]);
      io.to(roomName).emit("mafia_game_started", { players: gamePlayers });

      startDay(io, roomId);
      scheduleAiSpeech(io, roomId);
    } catch (err) { console.error(err); }
  });

  socket.on("disconnect", () => {
    if (socket.mafiaRoomId) {
      const room = mafiaRooms.get(socket.mafiaRoomId);
      if (room) stopGame(io, socket.mafiaRoomId, "연결 끊김으로 게임이 종료됩니다.");
    }
  });
};

const stopGame = async (io, roomId, reason) => {
  const room = mafiaRooms.get(roomId);
  if (!room) return;
  if (room.interval) clearInterval(room.interval);
  if (room.aiTimeout) clearTimeout(room.aiTimeout);
  io.to(`mafia_room_${roomId}`).emit("mafia_game_ended", { reason });
  mafiaRooms.delete(roomId);
  await pool.query("UPDATE mafia_rooms SET status = 'waiting' WHERE id = $1", [roomId]);
};

const checkWinCondition = (io, roomId) => {
  const room = mafiaRooms.get(roomId);
  if (!room) return;
  const aliveMafia = room.players.filter(p => !p.isDead && p.role === 'mafia');
  const aliveCitizen = room.players.filter(p => !p.isDead && p.role === 'citizen');
  if (aliveMafia.length === 0) return stopGame(io, roomId, "모든 마피아가 제거되었습니다. 시민 승리!");
  if (aliveMafia.length >= aliveCitizen.length) return stopGame(io, roomId, "마피아 세력이 마을을 점령했습니다. 마피아 승리!");
};

const startVote = (io, roomId) => {
  const room = mafiaRooms.get(roomId);
  if (!room) return;
  room.phase = "vote";
  room.timer = 20;
  room.votes = {};
  io.to(`mafia_room_${roomId}`).emit("mafia_phase_change", "vote");
  io.to(`mafia_room_${roomId}`).emit("mafia_message", { system: true, text: "🗳️ 투표 시간입니다! 처형할 대상을 클릭하세요." });

  room.interval = setInterval(() => {
    room.timer--;
    io.to(`mafia_room_${roomId}`).emit("mafia_timer", room.timer);
    if (room.timer <= 0) {
      clearInterval(room.interval);
      executePlayer(io, roomId);
    }
  }, 1000);
};

const executePlayer = (io, roomId) => {
  const room = mafiaRooms.get(roomId);
  if (!room) return;

  // AI 투표 시뮬레이션
  const alivePlayers = room.players.filter(p => !p.isDead);
  const alivePets = alivePlayers.filter(p => p.type === 'pet');
  alivePets.forEach(pet => {
    // 주인(ownerPetId)을 제외한 다른 생존자 중 한 명 랜덤 지목
    const targets = alivePlayers.filter(p => p.id !== `h_${pet.ownerPetId}` && p.id !== pet.id);
    if (targets.length > 0) {
      const target = targets[Math.floor(Math.random() * targets.length)];
      room.votes[pet.id] = target.id;
    }
  });

  const tally = {};
  const voteDetailsArr = [];

  Object.entries(room.votes).forEach(([voterId, targetId]) => {
    const voter = room.players.find(p => p.id === voterId);
    const target = room.players.find(p => p.id === targetId);
    if (voter && target) {
      voteDetailsArr.push(`${voter.anonName} -> ${target.anonName}`);
    }
    const p = room.players.find(pl => pl.id === targetId);
    if (p) tally[p.anonName] = (tally[p.anonName] || 0) + 1;
  });

  const voteDetailsStr = voteDetailsArr.length > 0 ? "📜 상세 투표 기록:\n" + voteDetailsArr.join(", ") : "📜 상세 투표 기록: (투표 없음)";

  let executed = null;
  let maxVotes = 0;
  Object.entries(tally).forEach(([name, count]) => {
    if (count > maxVotes) {
      maxVotes = count;
      executed = name;
    }
  });

  io.to(`mafia_room_${roomId}`).emit("mafia_message", { system: true, text: voteDetailsStr });

  if (executed) {
    const victim = room.players.find(p => p.anonName === executed);
    victim.isDead = true;
    io.to(`mafia_room_${roomId}`).emit("mafia_player_dead", { players: room.players });
    
    let resultLog = "📊 투표 결과: ";
    Object.entries(tally).forEach(([name, count]) => { resultLog += `${name}(${count}표) `; });
    io.to(`mafia_room_${roomId}`).emit("mafia_message", { system: true, text: resultLog });
    io.to(`mafia_room_${roomId}`).emit("mafia_message", { system: true, text: `⚖️ 최다 득표자 [${executed}]이(가) 처형되었습니다. 그의 정체는 [${victim.role}]이었습니다.` });
  } else {
    io.to(`mafia_room_${roomId}`).emit("mafia_message", { system: true, text: "🗳️ 투표 결과가 동수이거나 투표가 없어 아무도 처형되지 않았습니다." });
  }

  if (!checkWinCondition(io, roomId)) startNight(io, roomId);
};

const startDay = (io, roomId) => {
  const room = mafiaRooms.get(roomId);
  if (!room) return;
  room.phase = "day";
  room.timer = 120;
  io.to(`mafia_room_${roomId}`).emit("mafia_phase_change", "day");
  room.interval = setInterval(() => {
    room.timer--;
    io.to(`mafia_room_${roomId}`).emit("mafia_timer", room.timer);
    if (room.timer <= 0) { clearInterval(room.interval); startVote(io, roomId); }
  }, 1000);
};

const startNight = (io, roomId) => {
  const room = mafiaRooms.get(roomId);
  if (!room) return;
  room.phase = "night";
  room.timer = 20;
  io.to(`mafia_room_${roomId}`).emit("mafia_phase_change", "night");
  room.interval = setInterval(() => {
    room.timer--;
    io.to(`mafia_room_${roomId}`).emit("mafia_timer", room.timer);
    if (room.timer <= 0) { clearInterval(room.interval); startDay(io, roomId); }
  }, 1000);
};

const scheduleAiSpeech = (io, roomId) => {
  const room = mafiaRooms.get(roomId);
  if (!room) return;
  const delay = Math.floor(Math.random() * 5000) + 10000; // 10s ~ 15s
  room.aiTimeout = setTimeout(async () => {
    await triggerPetOpinions(io, roomId);
    scheduleAiSpeech(io, roomId);
  }, delay);
};

const triggerPetOpinions = async (io, roomId) => {
  const room = mafiaRooms.get(roomId);
  if (!room || room.phase !== 'day') return;
  const alivePets = room.players.filter(p => p.type === 'pet' && !p.isDead);
  if (alivePets.length === 0) return;
  const pet = alivePets[Math.floor(Math.random() * alivePets.length)];
  try {
    const opinion = await generateMafiaPetOpinion({
      role: pet.role, phase: room.phase, petName: pet.anonName, tendency: "neutral", players: room.players, recentMessages: room.messages
    });
    const petMsg = { sender: pet.anonName, text: opinion, isPet: true, timestamp: Date.now() };
    room.messages.push(petMsg);
    io.to(`mafia_room_${roomId}`).emit("mafia_message", petMsg);
  } catch (err) { console.error(err); }
};
