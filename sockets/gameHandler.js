const {
  generateRolePlay,
  scoreChat,
  generatePetReply,
  evaluateFinalRewards,
} = require("../services/rolePlayService");
const feedGameService = require("../services/feedGameService");
const bathGameService = require("../services/bathGameService");

module.exports = (io, socket, state) => {
  const {
    playRoomStartedSet,
    roomParticipantsMap,
    roomChatRoundMap,
    roomScenarioMap,
    feedRoomStartedSet,
    feedGameMap,
    bathRoomStartedSet,
    bathGameMap,
  } = state;

  const CATEGORIES = ["who", "when", "where", "what", "how", "why"];

  // [Role-Play Room]
  socket.on("join_play_room", async ({ childId, petId, petName }) => {
    const roomName = `play_room_${childId}`;
    socket.petId = petId;
    if (!socket.data) socket.data = {};
    socket.data.petId = petId;
    socket.playRoomId = childId;
    socket.join(roomName);

    const normalizedCurrentId = String(petId || "").trim();
    const sockets = await io.in(roomName).fetchSockets();
    const activePetIds = new Set(
      sockets
        .map((s) => String(s.data?.petId || "").trim())
        .filter((id) => id && id !== "undefined" && id !== "null"),
    );
    activePetIds.add(normalizedCurrentId);

    const uniquePetIds = [...activePetIds];

    if (playRoomStartedSet.has(roomName)) {
      const scenario = roomScenarioMap.get(roomName);
      if (scenario) {
        socket.emit("role_play_started", { scenario, roles: {} });
      }
      return;
    }

    if (uniquePetIds.length < 2) {
      socket.emit("play_room_waiting");
      return;
    }

    playRoomStartedSet.add(roomName);
    const participantIds = uniquePetIds;
    roomParticipantsMap.set(roomName, participantIds);
    roomChatRoundMap.set(roomName, new Map());

    try {
      const aiResult = await generateRolePlay(participantIds);
      roomScenarioMap.set(roomName, aiResult.scenario);
      io.in(roomName).emit("role_play_started", {
        scenario: aiResult.scenario,
        roles: aiResult.rolesAssignment,
      });
      io.in(roomName).emit("role_play_message", {
        senderId: "child_pet",
        senderName: "자식 펫 🐾",
        content: aiResult.openingMent,
        role: aiResult.scenario?.childRole || "아기 펫",
        timestamp: new Date(),
      });
    } catch (err) {
      console.error("[PLAY] AI Error:", err.message);
      playRoomStartedSet.delete(roomName);
    }
  });

  socket.on(
    "role_play_chat",
    async ({ childId, senderId, senderName, content, role }) => {
      const roomName = `play_room_${childId}`;
      const round = roomChatRoundMap.get(roomName);
      if (!round) return;
      if (round.has(String(senderId))) {
        socket.emit("play_already_spoke");
        return;
      }

      round.set(String(senderId), { role, name: senderName, content });
      io.in(roomName).emit("role_play_message", {
        senderId,
        senderName,
        content,
        role,
        timestamp: new Date(),
      });
      socket.emit("play_waiting_other");

      try {
        const score = await scoreChat(
          content,
          role,
          senderName,
          roomScenarioMap.get(roomName),
        );
        io.in(roomName).emit("play_round_score", { score });
      } catch (err) {
        console.error("[PLAY] Scoring Error:", err);
      }

      const participants = roomParticipantsMap.get(roomName) || [];
      if (
        participants.length >= 2 &&
        participants.every((pid) => round.has(pid))
      ) {
        const roundMessages = Array.from(round.values());
        roomChatRoundMap.set(roomName, new Map());

        try {
          const petReply = await generatePetReply(
            roundMessages,
            roomScenarioMap.get(roomName),
          );
          io.in(roomName).emit("role_play_message", {
            senderId: "child_pet",
            senderName: "자식 펫 🐾",
            content: petReply,
            role: roomScenarioMap.get(roomName)?.childRole || "아기 펫",
            timestamp: new Date(),
          });
          io.in(roomName).emit("play_round_start");
        } catch (err) {
          io.in(roomName).emit("play_round_start");
        }
      }
    },
  );

  socket.on("leave_play_room", async ({ childId, petName }) => {
    const roomName = `play_room_${childId}`;
    socket.leave(roomName);
    delete socket.playRoomId;

    setTimeout(async () => {
      const sockets = await io.in(roomName).fetchSockets();
      const isPetStillInRoom = sockets.some(
        (s) => String(s.data?.petId) === String(socket.petId),
      );
      if (!isPetStillInRoom) {
        io.in(roomName).emit("play_partner_left", { name: petName || "배우자" });
        playRoomStartedSet.delete(roomName);
        roomParticipantsMap.delete(roomName);
        roomChatRoundMap.delete(roomName);
        roomScenarioMap.delete(roomName);
      }
    }, 500);
  });

  socket.on("finish_play_room", async ({ childId }) => {
    const roomName = `play_room_${childId}`;
    const round = roomChatRoundMap.get(roomName);
    const scenario = roomScenarioMap.get(roomName);

    try {
      const roundMessages = Array.from(round?.values() || []);
      const rewards = await evaluateFinalRewards(roundMessages, 100);
      const { pool } = require("../database/database");
      await pool.query(
        `UPDATE pets SET knowledge = LEAST(knowledge + $2, 100), affection = LEAST(affection + $3, 100), exp = exp + $4, stress = GREATEST(0, LEAST(stress + $5, 100)) WHERE id = $1`,
        [
          childId,
          rewards.knowledge,
          rewards.affection,
          rewards.exp,
          rewards.stress,
        ],
      );
      io.to(roomName).emit("play_game_finished", {
        totalScore: 100,
        statChanges: rewards,
      });
    } catch (err) {
      console.error("[PLAY] AI Reward Finish Error:", err);
    }

    playRoomStartedSet.delete(roomName);
    roomParticipantsMap.delete(roomName);
    roomChatRoundMap.delete(roomName);
    roomScenarioMap.delete(roomName);
  });

  // [Feed Game Room] (5W1H Storytelling)
  socket.on("join_feed_room", async ({ childId, petId, petName }) => {
    const roomName = `feed_room_${childId}`;
    socket.petId = petId;
    if (!socket.data) socket.data = {};
    socket.data.petId = petId;
    socket.feedRoomId = childId;
    socket.join(roomName);

    const normalizedPetId = String(petId || "").trim();
    const sockets = await io.in(roomName).fetchSockets();
    const activePetIds = new Set(
      sockets
        .map((s) => String(s.data?.petId || "").trim())
        .filter((id) => id && id !== "undefined")
    );
    activePetIds.add(normalizedPetId);
    
    const uniqueParticipants = [...activePetIds];
    let game = feedGameMap.get(roomName);

    if (!game) {
      feedRoomStartedSet.add(roomName);
      
      const categories = [...CATEGORIES].sort(() => Math.random() - 0.5);
      const assignments = {};
      
      // 최초 입장자에게 2개 배정
      assignments[normalizedPetId] = [categories[0], categories[1]];
      
      // 나머지 4개는 일단 펫에게 배정 (배우자가 오면 2개 뺏어올 것임)
      assignments["child_pet"] = [categories[2], categories[3], categories[4], categories[5]];

      game = {
        participants: uniqueParticipants,
        assignments,
        words: {},
        petWordsGenerated: false,
      };
      feedGameMap.set(roomName, game);

      // 아기 펫 단어 자동 생성 (4개 모두)
      try {
        const petResult = await feedGameService.generatePetWords(assignments["child_pet"]);
        Object.assign(game.words, petResult);
        game.petWordsGenerated = true;
      } catch (err) {
        console.error("[FEED] Pet word gen error:", err);
      }
    } else {
      // 이미 게임이 진행 중인데 새로운 사람이 들어온 경우 (배우자)
      if (!game.assignments[normalizedPetId] && game.assignments["child_pet"].length > 2) {
        // 펫의 카테고리 중 뒤의 2개를 새 참여자에게 양보
        const petCats = game.assignments["child_pet"];
        const movedCats = petCats.splice(-2); 
        game.assignments[normalizedPetId] = movedCats;
        
        // 펫이 이미 단어를 생성했을 수 있으므로 관리 필요
        // (단어는 그대로 두거나 새로 생성 가능하지만, 일단 참여자가 직접 입력하도록 유지)
        movedCats.forEach(cat => delete game.words[cat]);
        
        console.log(`[FEED] Reassigned ${movedCats} from pet to ${normalizedPetId}`);
      }
      
      if (!game.participants.includes(normalizedPetId)) {
        game.participants.push(normalizedPetId);
      }
    }

    io.to(roomName).emit("feed_game_started", {
      assignments: game.assignments,
      currentWords: game.words,
    });
  });

  socket.on("submit_feed_word", async ({ childId, category, word, petId }) => {
    const roomName = `feed_room_${childId}`;
    const game = feedGameMap.get(roomName);
    if (!game) return;

    game.words[category] = word;
    io.to(roomName).emit("feed_word_submitted", { category, word, petId });

    // 6개 단어 모두 수집되었는지 확인
    const allCollected = CATEGORIES.every(cat => !!game.words[cat]);
    if (allCollected) {
      io.to(roomName).emit("feed_story_creating");

      try {
        const result = await feedGameService.create5W1HStory(game.words);
        
        // 밸런스 조정: 점수(0~100) 기반
        // statChange: -20 ~ +20 (점수 50점 기준 0)
        const statChange = Math.floor((result.score / 2.5) - 20);
        
        const rewards = {
          hunger: Math.max(20, Math.floor(result.score)), // 최소 20은 채워줌, 최대 100
          knowledge: statChange,
          affection: statChange,
          exp: Math.floor(result.score / 2), // 경험치는 최대 50
          stress: -Math.floor(statChange / 2) // 잘하면 스트레스 감소, 못하면 증가
        };

        const { pool } = require("../database/database");
        await pool.query(
          `UPDATE pets SET 
            hunger = LEAST(hunger + $2, 100), 
            knowledge = GREATEST(0, LEAST(knowledge + $3, 100)), 
            affection = GREATEST(0, LEAST(affection + $4, 100)), 
            exp = exp + $5,
            stress = GREATEST(0, LEAST(stress + $6, 100))
           WHERE id = $1`,
          [childId, rewards.hunger, rewards.knowledge, rewards.affection, rewards.exp, rewards.stress]
        );

        io.to(roomName).emit("feed_game_result", { ...result, rewards });
        feedGameMap.delete(roomName);
        feedRoomStartedSet.delete(roomName);
      } catch (err) {
        console.error("[FEED] Story gen error:", err);
        io.to(roomName).emit("feed_game_error", { message: "이야기를 만드는 데 실패했어요." });
      }
    }
  });

  socket.on("leave_feed_room", async ({ childId, petName }) => {
    const roomName = `feed_room_${childId}`;
    socket.leave(roomName);
    delete socket.feedRoomId;

    setTimeout(async () => {
      const sockets = await io.in(roomName).fetchSockets();
      const stillIn = sockets.some(s => String(s.data?.petId) === String(socket.petId));
      if (!stillIn) {
        io.to(roomName).emit("feed_partner_left", petName || "배우자");
        feedGameMap.delete(roomName);
        feedRoomStartedSet.delete(roomName);
      }
    }, 500);
  });

  // [Bath Game Room]
  socket.on("join_bath_room", async ({ childId, petId, petName }) => {
    const roomName = `bath_room_${childId}`;
    socket.petId = petId;
    if (!socket.data) socket.data = {};
    socket.data.petId = petId;
    socket.bathRoomId = childId;
    socket.join(roomName);

    const sockets = await io.in(roomName).fetchSockets();
    const uniquePetIds = [
      ...new Set(
        sockets
          .map((s) => String(s.data?.petId))
          .filter((id) => id && id !== "undefined"),
      ),
    ];

    if (bathRoomStartedSet.has(roomName)) {
      const game = bathGameMap.get(roomName);
      if (game) {
        socket.emit("bath_game_started", {
          category: game.category,
          hint: game.hint1, // 무조건 기본 힌트(hint1)는 보여줌
          extraHint: game.extraHintRevealed ? game.hint2 : null,
          extraHintRevealed: game.extraHintRevealed || false,
          currentTurnPetId: game.participants[0],
        });
      }
      return;
    }

    bathRoomStartedSet.add(roomName);
    try {
      const { word, category, hint1, hint2 } = await bathGameService.initializeGame();
      const pIds = uniquePetIds;
      bathGameMap.set(roomName, {
        word,
        category,
        hint1,
        hint2,
        questions: [],
        turnCount: 0,
        participants: pIds,
        extraHintRevealed: false,
        extraHintProposedBy: null,
        extraHintVotes: new Set(),
        giveupProposedBy: null,
        giveupVotes: new Set(),
      });
      // 시작 시 기본 힌트(hint1)만 전송
      io.in(roomName).emit("bath_game_started", { 
        category, 
        hint: hint1, 
        extraHint: null,
        extraHintRevealed: false, 
        currentTurnPetId: pIds[0] 
      });
    } catch (err) {
      bathRoomStartedSet.delete(roomName);
    }
  });

  socket.on("propose_bath_extra_hint", ({ childId, petName }) => {
    const roomName = `bath_room_${childId}`;
    const game = bathGameMap.get(roomName);
    if (!game || game.extraHintRevealed) return;

    game.extraHintProposedBy = socket.petId;
    game.extraHintVotes.clear();
    game.extraHintVotes.add(socket.petId);

    socket.to(roomName).emit("bath_extra_hint_proposed", { proposerName: petName });
  });

  socket.on("respond_bath_extra_hint", ({ childId, approved }) => {
    const roomName = `bath_room_${childId}`;
    const game = bathGameMap.get(roomName);
    if (!game) return;

    if (approved) {
      game.extraHintVotes.add(socket.petId);
      if (game.extraHintVotes.size >= Math.min(game.participants.length, 2)) {
        game.extraHintRevealed = true;
        io.in(roomName).emit("bath_extra_hint_revealed", { extraHint: game.hint2 });
      }
    } else {
      game.extraHintProposedBy = null;
      game.extraHintVotes.clear();
      io.in(roomName).emit("bath_extra_hint_rejected");
    }
  });

  // 기존 request_bath_hint는 제거하거나 무시
  socket.on("request_bath_hint", () => {});

  socket.on("propose_bath_giveup", ({ childId, petName }) => {
    const roomName = `bath_room_${childId}`;
    const game = bathGameMap.get(roomName);
    if (!game) return;

    game.giveupProposedBy = socket.petId;
    game.giveupVotes.clear();
    game.giveupVotes.add(socket.petId);

    socket.to(roomName).emit("bath_giveup_proposed", { proposerName: petName });
  });

  socket.on("respond_bath_giveup", async ({ childId, approved }) => {
    const roomName = `bath_room_${childId}`;
    const game = bathGameMap.get(roomName);
    if (!game) return;

    if (approved) {
      game.giveupVotes.add(socket.petId);
      if (game.giveupVotes.size >= Math.min(game.participants.length, 2)) {
        // 전원 동의 (또는 최소 2명 동의) 시 포기 처리
        const evaluation = await bathGameService.evaluateResult(false, game.turnCount, game.word, game.questions);
        const changes = {
          cleanliness: evaluation.changes?.cleanliness ?? 30,
          affection: -20, // 포기 페널티 강화
          knowledge: -10,
          exp: 5,
        };
        const { pool } = require("../database/database");
        await pool.query(
          `UPDATE pets SET cleanliness = LEAST(cleanliness + $2, 100), affection = GREATEST(affection + $3, 0), knowledge = GREATEST(knowledge + $4, 0), exp = exp + $5 WHERE id = $1`,
          [childId, changes.cleanliness, changes.affection, changes.knowledge, changes.exp],
        );
        io.in(roomName).emit("bath_game_result", { ...evaluation, word: game.word, changes, isGiveup: true });
        bathGameMap.delete(roomName);
        bathRoomStartedSet.delete(roomName);
      }
    } else {
      game.giveupProposedBy = null;
      game.giveupVotes.clear();
      io.in(roomName).emit("bath_giveup_rejected");
    }
  });

  socket.on("ask_bath_question", async ({ childId, question, petName, petId }) => {
    const roomName = `bath_room_${childId}`;
    const game = bathGameMap.get(roomName);
    if (!game) return;

    if (game.turnCount >= 10) {
      socket.emit("bath_last_chance", { turnCount: game.turnCount });
      return;
    }

    const answer = await bathGameService.answerQuestion(game.word, question);
    const log = { petName, question, answer };
    game.questions.push(log);
    game.turnCount++;
    io.in(roomName).emit("bath_question_answered", log);

    if (game.turnCount >= 10) {
      io.in(roomName).emit("bath_last_chance", { turnCount: game.turnCount });
      return;
    }

    const nextIdx = (game.participants.indexOf(String(petId)) + 1) % game.participants.length;
    io.in(roomName).emit("bath_turn_changed", { currentTurnPetId: game.participants[nextIdx] });
  });

  socket.on("leave_bath_room", async ({ childId, petName }) => {
    const roomName = `bath_room_${childId}`;
    socket.leave(roomName);
    delete socket.bathRoomId;

    setTimeout(async () => {
      const sockets = await io.in(roomName).fetchSockets();
      const isPetStillInRoom = sockets.some((s) => String(s.data?.petId) === String(socket.petId));
      if (!isPetStillInRoom) {
        io.in(roomName).emit("bath_partner_left", petName || "배우자");
        bathRoomStartedSet.delete(roomName);
        bathGameMap.delete(roomName);
      }
    }, 500);
  });

  socket.on("guess_bath_word", async ({ childId, guess, petName }) => {
    const roomName = `bath_room_${childId}`;
    const game = bathGameMap.get(roomName);
    if (!game) return;

    game.turnCount++;
    const isCorrect = guess.replace(/\s/g, "").toLowerCase() === game.word.replace(/\s/g, "").toLowerCase();
    io.in(roomName).emit("bath_guess_attempted", { petName, guess, isCorrect });

    if (isCorrect) {
      const evaluation = await bathGameService.evaluateResult(true, game.turnCount, game.word, game.questions, game.extraHintRevealed);
      const changes = {
        cleanliness: evaluation.changes?.cleanliness ?? 100,
        affection: evaluation.changes?.affection ?? 15,
        knowledge: evaluation.changes?.knowledge ?? 10,
        exp: evaluation.changes?.exp ?? 50,
      };
      const { pool } = require("../database/database");
      await pool.query(
        `UPDATE pets SET cleanliness = LEAST(cleanliness + $2, 100), affection = LEAST(affection + $3, 100), knowledge = LEAST(knowledge + $4, 100), exp = exp + $5 WHERE id = $1`,
        [childId, changes.cleanliness, changes.affection, changes.knowledge, changes.exp],
      );
      io.in(roomName).emit("bath_game_result", { ...evaluation, word: game.word, changes });
      bathGameMap.delete(roomName);
      bathRoomStartedSet.delete(roomName);
    } else if (game.turnCount >= 10) {
      const evaluation = await bathGameService.evaluateResult(false, 10, game.word, game.questions);
      const changes = {
        cleanliness: evaluation.changes?.cleanliness ?? 30,
        affection: evaluation.changes?.affection ?? -10,
        knowledge: evaluation.changes?.knowledge ?? -5,
        exp: evaluation.changes?.exp ?? 10,
      };
      const { pool } = require("../database/database");
      await pool.query(
        `UPDATE pets SET cleanliness = LEAST(cleanliness + $2, 100), affection = GREATEST(affection + $3, 0), knowledge = GREATEST(knowledge + $4, 0), exp = exp + $5 WHERE id = $1`,
        [childId, changes.cleanliness, changes.affection, changes.knowledge, changes.exp],
      );
      io.in(roomName).emit("bath_game_result", { ...evaluation, word: game.word, changes });
      bathGameMap.delete(roomName);
      bathRoomStartedSet.delete(roomName);
    }
  });
};
