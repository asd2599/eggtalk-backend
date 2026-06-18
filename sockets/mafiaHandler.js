const { pool } = require("../database/database");
const { generateMafiaPetOpinion } = require("../services/mafiaService");

// 서버 메모리에 진행 중인 게임 상태 저장 (key: String(roomId))
const mafiaRooms = new Map();

const roomChannel = (roomId) => `mafia_room_${roomId}`;
const getRoom = (roomId) => mafiaRooms.get(String(roomId));
const roleKo = (role) => (role === "mafia" ? "마피아" : "시민");

// ---------------------------------------------------------------------------
// 역할 은닉: 각 시청자(petId)에게 보여줄 players 배열을 개인화한다.
//  - 내 캐릭터(휴먼/펫)의 역할은 항상 공개
//  - 죽은 캐릭터의 역할은 전원 공개
//  - 내가 마피아면 동료 마피아 공개
//  - 그 외 생존자의 역할은 null로 가린다 (프론트는 타인 역할을 표시하지 않음)
// ---------------------------------------------------------------------------
const maskPlayers = (room, viewerPetId) => {
  const myHuman = room.players.find(
    (p) => p.type === "human" && p.petId === viewerPetId,
  );
  const iAmMafia = myHuman?.role === "mafia";
  return room.players.map((p) => {
    const mine = p.petId === viewerPetId;
    const reveal = mine || p.isDead || (iAmMafia && p.role === "mafia");
    return {
      id: p.id,
      petId: p.petId,
      type: p.type,
      anonName: p.anonName,
      isDead: p.isDead,
      role: reveal ? p.role : null,
      ownerPetId: p.ownerPetId,
    };
  });
};

// 개인화된 players 배열을 룸 내 각 소켓에 맞춰 전송
const emitPlayers = async (io, room, eventName) => {
  const sockets = await io.in(roomChannel(room.roomId)).fetchSockets();
  for (const s of sockets) {
    s.emit(eventName, { players: maskPlayers(room, s.data.mafiaPetId) });
  }
};

// 룸 내 살아있는 마피아(휴먼) 소켓에게만 메시지 전송 (밤 비밀 채팅 등)
const emitToMafia = async (io, room, msg) => {
  const sockets = await io.in(roomChannel(room.roomId)).fetchSockets();
  for (const s of sockets) {
    const human = room.players.find(
      (p) =>
        p.type === "human" &&
        p.petId === s.data.mafiaPetId &&
        !p.isDead &&
        p.role === "mafia",
    );
    if (human) s.emit("mafia_message", msg);
  }
};

const sys = (io, roomId, text) =>
  io.to(roomChannel(roomId)).emit("mafia_message", { system: true, text });

module.exports = (io, socket, state) => {
  // 대기실/게임 공통: 룸 입장 (+ 게임 진행 중이면 상태 동기화)
  socket.on("mafia_join_room", async ({ roomId, petId }) => {
    socket.join(roomChannel(roomId));
    socket.data.mafiaRoomId = String(roomId);
    if (petId != null) socket.data.mafiaPetId = Number(petId);

    const room = getRoom(roomId);
    if (room) {
      // 재연결 유예 타이머 취소
      const pending = room.pendingLeaves.get(socket.data.mafiaPetId);
      if (pending) {
        clearTimeout(pending);
        room.pendingLeaves.delete(socket.data.mafiaPetId);
      }
      // 새로고침/재접속 복구용 전체 상태 동기화
      socket.emit("mafia_sync_game", {
        players: maskPlayers(room, socket.data.mafiaPetId),
        phase: room.phase,
        timer: room.timer,
        messages: room.messages,
        day: room.day,
      });
    } else {
      io.to(roomChannel(roomId)).emit("mafia_sync_needed");
    }
  });

  socket.on("mafia_toggle_ready", ({ roomId }) => {
    io.to(roomChannel(roomId)).emit("mafia_sync_needed");
  });

  socket.on("mafia_send_message", ({ roomId, text, sender }) => {
    if (!text || !text.trim()) return;
    const room = getRoom(roomId);

    // 대기실(게임 미시작): 그대로 브로드캐스트
    if (!room) {
      io.to(roomChannel(roomId)).emit("mafia_message", {
        sender,
        text,
        isPet: false,
        timestamp: Date.now(),
      });
      return;
    }

    // 게임 중: 서버가 발신자를 petId로 식별(스푸핑 방지)
    const me = room.players.find(
      (p) => p.type === "human" && p.petId === socket.data.mafiaPetId,
    );
    if (!me || me.isDead) return;
    if (room.phase === "vote") return; // 투표 중 채팅 금지
    if (room.phase === "night" && me.role !== "mafia") return; // 밤엔 마피아만

    const msg = { sender: me.anonName, text, isPet: false, timestamp: Date.now() };
    room.messages.push(msg);
    if (room.messages.length > 50) room.messages.shift();

    if (room.phase === "night") {
      emitToMafia(io, room, msg); // 밤 채팅은 마피아끼리만
    } else {
      io.to(roomChannel(roomId)).emit("mafia_message", msg);
    }
  });

  // 낮 투표
  socket.on("mafia_cast_vote", ({ roomId, targetId }) => {
    const room = getRoom(roomId);
    if (!room || room.phase !== "vote") return;
    const voter = room.players.find(
      (p) =>
        p.type === "human" && p.petId === socket.data.mafiaPetId && !p.isDead,
    );
    if (!voter) return;
    const target = room.players.find((p) => p.id === targetId && !p.isDead);
    if (!target) return;
    room.votes[voter.id] = target.id;
    io.to(roomChannel(roomId)).emit("mafia_vote_synced", { votes: room.votes });
  });

  // 밤 마피아 처치 지목
  socket.on("mafia_night_action", ({ roomId, targetId }) => {
    const room = getRoom(roomId);
    if (!room || room.phase !== "night") return;
    const actor = room.players.find(
      (p) =>
        p.type === "human" &&
        p.petId === socket.data.mafiaPetId &&
        !p.isDead &&
        p.role === "mafia",
    );
    if (!actor) return;
    const target = room.players.find(
      (p) => p.id === targetId && !p.isDead && p.role !== "mafia",
    );
    if (!target) return;
    room.nightKillTarget = target.id;
    socket.emit("mafia_message", {
      system: true,
      text: `🔪 [${target.anonName}]님을 오늘 밤 처치 대상으로 지목했습니다.`,
    });
  });

  socket.on("mafia_leave_game", ({ roomId }) => {
    if (socket.data.mafiaPetId != null)
      handlePlayerLeave(io, roomId, socket.data.mafiaPetId);
  });

  socket.on("mafia_start_game", async ({ roomId }) => {
    if (getRoom(roomId)) return; // 이미 진행 중이면 무시 (중복 시작 방지)
    try {
      const participantsQuery = `
        SELECT p.*, pets.name as pet_name FROM mafia_participants p
        JOIN pets ON p.pet_id = pets.id WHERE p.room_id = $1
      `;
      const { rows: participants } = await pool.query(participantsQuery, [roomId]);
      if (participants.length < 1) return;

      const anonymousNames = ["침착한 갈매기", "용감한 거북이", "날렵한 치타", "똑똑한 부엉이", "온순한 양", "무서운 사자", "빠른 토끼", "느긋한 판다", "우아한 학", "고독한 늑대", "활기찬 돌고래", "다정한 코끼리", "영리한 여우", "우직한 곰", "화려한 공작", "신중한 사슴"];
      const shuffledNames = [...anonymousNames].sort(() => Math.random() - 0.5);

      const gamePlayers = [];
      participants.forEach((p, idx) => {
        gamePlayers.push({ id: `h_${p.pet_id}`, petId: p.pet_id, type: "human", anonName: shuffledNames[idx * 2], isDead: false, role: "citizen" });
        gamePlayers.push({ id: `p_${p.pet_id}`, petId: p.pet_id, type: "pet", anonName: shuffledNames[idx * 2 + 1], isDead: false, role: "citizen", ownerPetId: p.pet_id });
      });

      const totalCount = gamePlayers.length;
      const mafiaCount = totalCount >= 8 ? 2 : 1;
      const mafiaIndices = [];
      while (mafiaIndices.length < mafiaCount) {
        const r = Math.floor(Math.random() * totalCount);
        if (!mafiaIndices.includes(r)) mafiaIndices.push(r);
      }
      mafiaIndices.forEach((idx) => (gamePlayers[idx].role = "mafia"));

      const room = {
        roomId: String(roomId),
        players: gamePlayers,
        phase: "day",
        day: 0,
        timer: 120,
        messages: [],
        votes: {},
        nightKillTarget: null,
        lastNightVictim: null,
        interval: null,
        aiTimeout: null,
        pendingLeaves: new Map(),
      };
      mafiaRooms.set(String(roomId), room);
      await pool.query("UPDATE mafia_rooms SET status = 'playing' WHERE id = $1", [roomId]);

      await emitPlayers(io, room, "mafia_game_started");

      // 각 플레이어에게 본인 역할 개별 통지
      const sockets = await io.in(roomChannel(roomId)).fetchSockets();
      for (const s of sockets) {
        const myHuman = room.players.find((p) => p.type === "human" && p.petId === s.data.mafiaPetId);
        const myPet = room.players.find((p) => p.type === "pet" && p.petId === s.data.mafiaPetId);
        if (myHuman) {
          s.emit("mafia_message", { system: true, text: `🎭 당신의 직업은 [${roleKo(myHuman.role)}]입니다.` });
          if (myPet) s.emit("mafia_message", { system: true, text: `🐾 당신의 펫(${myPet.anonName})의 직업은 [${roleKo(myPet.role)}]입니다.` });
        }
      }
      sys(io, roomId, "☀️ 게임이 시작되었습니다. 낮 토론을 시작하세요!");

      startDay(io, roomId);
      scheduleAiSpeech(io, roomId);
    } catch (err) {
      console.error("[mafia] start_game error:", err);
    }
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.mafiaRoomId;
    if (!roomId) return;
    const room = getRoom(roomId);
    if (!room) return; // 대기실 단계의 연결 종료는 게임에 영향 없음
    const petId = socket.data.mafiaPetId;
    if (petId == null) return;
    // 재연결 유예: 10초 내 재접속(mafia_join_room)하면 게임 유지
    if (room.pendingLeaves.has(petId)) return;
    const t = setTimeout(() => handlePlayerLeave(io, roomId, petId), 10000);
    room.pendingLeaves.set(petId, t);
  });
};

// ---------------------------------------------------------------------------
// 게임 진행 로직
// ---------------------------------------------------------------------------
const stopGame = async (io, roomId, reason) => {
  const room = getRoom(roomId);
  if (!room) return;
  if (room.interval) clearInterval(room.interval);
  if (room.aiTimeout) clearTimeout(room.aiTimeout);
  room.pendingLeaves.forEach((t) => clearTimeout(t));
  io.to(roomChannel(roomId)).emit("mafia_game_ended", { reason });
  mafiaRooms.delete(String(roomId));
  try {
    await pool.query("UPDATE mafia_rooms SET status = 'waiting' WHERE id = $1", [roomId]);
  } catch (err) {
    console.error("[mafia] stopGame db error:", err);
  }
};

// 플레이어 이탈 처리 (휴먼만 사망 처리, 펫 AI는 잔류)
const handlePlayerLeave = async (io, roomId, petId) => {
  const room = getRoom(roomId);
  if (!room) return;
  const pending = room.pendingLeaves.get(petId);
  if (pending) {
    clearTimeout(pending);
    room.pendingLeaves.delete(petId);
  }
  const human = room.players.find((p) => p.type === "human" && p.petId === petId);
  if (human && !human.isDead) {
    human.isDead = true;
    sys(io, roomId, `🚪 [${human.anonName}]님이 게임을 떠났습니다.`);
    await emitPlayers(io, room, "mafia_player_dead");
  }
  const aliveHumans = room.players.filter((p) => p.type === "human" && !p.isDead);
  if (aliveHumans.length === 0) {
    return stopGame(io, roomId, "모든 플레이어가 떠나 게임이 종료되었습니다.");
  }
  checkWinCondition(io, roomId);
};

// 승리 조건 확인 (게임 종료 시 truthy 반환)
const checkWinCondition = (io, roomId) => {
  const room = getRoom(roomId);
  if (!room) return;
  const aliveMafia = room.players.filter((p) => !p.isDead && p.role === "mafia");
  const aliveCitizen = room.players.filter((p) => !p.isDead && p.role === "citizen");
  if (aliveMafia.length === 0)
    return stopGame(io, roomId, "모든 마피아가 제거되었습니다. 시민 승리! 🎉");
  if (aliveMafia.length >= aliveCitizen.length)
    return stopGame(io, roomId, "마피아 세력이 마을을 점령했습니다. 마피아 승리! 🔪");
};

const startDay = (io, roomId) => {
  const room = getRoom(roomId);
  if (!room) return;
  if (room.interval) clearInterval(room.interval);
  room.phase = "day";
  room.day += 1;
  room.timer = 120;
  room.votes = {};
  io.to(roomChannel(roomId)).emit("mafia_phase_change", "day");

  // 첫째 날을 제외하고는 지난밤 결과를 알린다
  if (room.day > 1) {
    const v = room.lastNightVictim;
    if (v)
      sys(io, roomId, `🌅 아침이 밝았습니다. 지난 밤 [${v.anonName}]님이 살해당했습니다. (정체: ${roleKo(v.role)})`);
    else sys(io, roomId, "🌅 아침이 밝았습니다. 지난 밤은 평화로웠습니다.");
  }
  room.lastNightVictim = null;

  room.interval = setInterval(() => {
    room.timer--;
    io.to(roomChannel(roomId)).emit("mafia_timer", room.timer);
    if (room.timer <= 0) {
      clearInterval(room.interval);
      startVote(io, roomId);
    }
  }, 1000);
};

const startVote = (io, roomId) => {
  const room = getRoom(roomId);
  if (!room) return;
  if (room.interval) clearInterval(room.interval);
  room.phase = "vote";
  room.timer = 20;
  room.votes = {};
  io.to(roomChannel(roomId)).emit("mafia_phase_change", "vote");
  sys(io, roomId, "🗳️ 투표 시간입니다! 처형할 대상을 클릭하세요.");

  room.interval = setInterval(() => {
    room.timer--;
    io.to(roomChannel(roomId)).emit("mafia_timer", room.timer);
    if (room.timer <= 0) {
      clearInterval(room.interval);
      executePlayer(io, roomId);
    }
  }, 1000);
};

const executePlayer = async (io, roomId) => {
  const room = getRoom(roomId);
  if (!room) return;

  // 펫(AI) 투표 시뮬레이션: 주인(휴먼)과 자기 자신은 제외
  const alivePlayers = room.players.filter((p) => !p.isDead);
  room.players
    .filter((p) => !p.isDead && p.type === "pet")
    .forEach((pet) => {
      const targets = alivePlayers.filter(
        (p) => p.id !== `h_${pet.ownerPetId}` && p.id !== pet.id,
      );
      if (targets.length > 0) {
        const target = targets[Math.floor(Math.random() * targets.length)];
        room.votes[pet.id] = target.id;
      }
    });

  // 집계
  const tally = {};
  const voteDetailsArr = [];
  Object.entries(room.votes).forEach(([voterId, targetId]) => {
    const voter = room.players.find((p) => p.id === voterId);
    const target = room.players.find((p) => p.id === targetId);
    if (voter && target) {
      voteDetailsArr.push(`${voter.anonName} → ${target.anonName}`);
      tally[target.id] = (tally[target.id] || 0) + 1;
    }
  });

  sys(
    io,
    roomId,
    voteDetailsArr.length > 0
      ? "📜 투표 기록: " + voteDetailsArr.join(", ")
      : "📜 투표 기록: (투표 없음)",
  );

  // 최다 득표자 (동점이면 처형 없음)
  let executedId = null;
  let maxVotes = 0;
  let tie = false;
  Object.entries(tally).forEach(([targetId, count]) => {
    if (count > maxVotes) {
      maxVotes = count;
      executedId = targetId;
      tie = false;
    } else if (count === maxVotes) {
      tie = true;
    }
  });

  if (executedId && !tie) {
    const victim = room.players.find((p) => p.id === executedId);
    victim.isDead = true;
    await emitPlayers(io, room, "mafia_player_dead");

    const resultLog = Object.entries(tally)
      .map(([id, count]) => {
        const pl = room.players.find((p) => p.id === id);
        return pl ? `${pl.anonName}(${count}표)` : null;
      })
      .filter(Boolean)
      .join(" ");
    sys(io, roomId, `📊 투표 결과: ${resultLog}`);
    sys(io, roomId, `⚖️ 최다 득표자 [${victim.anonName}]님이 처형되었습니다. 정체는 [${roleKo(victim.role)}]였습니다.`);
  } else {
    sys(io, roomId, "🤝 동점이거나 투표가 없어 아무도 처형되지 않았습니다.");
  }

  if (!checkWinCondition(io, roomId)) startNight(io, roomId);
};

const startNight = async (io, roomId) => {
  const room = getRoom(roomId);
  if (!room) return;
  if (room.interval) clearInterval(room.interval);
  room.phase = "night";
  room.timer = 20;
  room.nightKillTarget = null;
  io.to(roomChannel(roomId)).emit("mafia_phase_change", "night");
  sys(io, roomId, "🌙 밤이 되었습니다. 마피아가 활동합니다...");

  // 살아있는 마피아 휴먼에게 처치 안내
  const sockets = await io.in(roomChannel(roomId)).fetchSockets();
  for (const s of sockets) {
    const human = room.players.find(
      (p) =>
        p.type === "human" &&
        p.petId === s.data.mafiaPetId &&
        !p.isDead &&
        p.role === "mafia",
    );
    if (human)
      s.emit("mafia_message", {
        system: true,
        text: "🔪 처치할 대상을 클릭하세요. (제한시간 20초)",
      });
  }

  room.interval = setInterval(() => {
    room.timer--;
    io.to(roomChannel(roomId)).emit("mafia_timer", room.timer);
    if (room.timer <= 0) {
      clearInterval(room.interval);
      resolveNight(io, roomId);
    }
  }, 1000);
};

const resolveNight = async (io, roomId) => {
  const room = getRoom(roomId);
  if (!room) return;
  const alive = room.players.filter((p) => !p.isDead);
  const validTargets = alive.filter((p) => p.role !== "mafia");

  // 휴먼 마피아 지목이 없으면 AI가 랜덤으로 결정
  let target = validTargets.find((p) => p.id === room.nightKillTarget);
  if (!target && validTargets.length > 0) {
    target = validTargets[Math.floor(Math.random() * validTargets.length)];
  }
  room.nightKillTarget = null;

  if (target) {
    target.isDead = true;
    room.lastNightVictim = target;
    await emitPlayers(io, room, "mafia_player_dead");
  } else {
    room.lastNightVictim = null;
  }

  if (!checkWinCondition(io, roomId)) startDay(io, roomId);
};

// ---------------------------------------------------------------------------
// 펫 AI 채팅 (낮에만 발언)
// ---------------------------------------------------------------------------
const scheduleAiSpeech = (io, roomId) => {
  const room = getRoom(roomId);
  if (!room) return;
  const delay = Math.floor(Math.random() * 5000) + 10000; // 10~15초
  room.aiTimeout = setTimeout(async () => {
    await triggerPetOpinions(io, roomId);
    if (getRoom(roomId)) scheduleAiSpeech(io, roomId);
  }, delay);
};

const triggerPetOpinions = async (io, roomId) => {
  const room = getRoom(roomId);
  if (!room || room.phase !== "day") return;
  const alivePets = room.players.filter((p) => p.type === "pet" && !p.isDead);
  if (alivePets.length === 0) return;
  const pet = alivePets[Math.floor(Math.random() * alivePets.length)];
  try {
    const opinion = await generateMafiaPetOpinion({
      role: pet.role,
      phase: room.phase,
      petName: pet.anonName,
      tendency: "neutral",
      players: room.players,
      recentMessages: room.messages,
    });
    if (!getRoom(roomId) || room.phase !== "day") return; // 응답 도중 단계 변경 방지
    const petMsg = { sender: pet.anonName, text: opinion, isPet: true, timestamp: Date.now() };
    room.messages.push(petMsg);
    if (room.messages.length > 50) room.messages.shift();
    io.to(roomChannel(roomId)).emit("mafia_message", petMsg);
  } catch (err) {
    console.error("[mafia] pet opinion error:", err);
  }
};
