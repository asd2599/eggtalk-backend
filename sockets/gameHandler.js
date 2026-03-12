const {
  generateRolePlay,
  scoreChat,
  generatePetReply,
  evaluateFinalRewards,
} = require("../services/rolePlayService");
const dreamGameService = require("../services/dreamGameService");
const bathGameService = require("../services/bathGameService");

module.exports = (io, socket, state) => {
  const {
    playRoomStartedSet,
    roomParticipantsMap,
    roomChatRoundMap,
    roomScenarioMap,
    dreamRoomStartedSet,
    dreamGameMap,
    bathRoomStartedSet,
    bathGameMap,
  } = state;

  // [Role-Play Room]
  socket.on("join_play_room", async ({ childId, petId, petName }) => {
    const roomName = `play_room_${childId}`;
    socket.petId = petId;
    if (!socket.data) socket.data = {};
    socket.data.petId = petId;
    socket.playRoomId = childId;
    socket.join(roomName);

    const sockets = await io.in(roomName).fetchSockets();
    const uniquePetIds = [
      ...new Set(
        sockets
          .map((s) => String(s.data?.petId))
          .filter((id) => id && id !== "undefined"),
      ),
    ];

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

  // [Dream Game Room] (Replacing Feed Game)
  socket.on("join_dream_room", async ({ childId, petId, petName }) => {
    const roomName = `dream_room_${childId}`;
    socket.petId = petId;
    if (!socket.data) socket.data = {};
    socket.data.petId = petId;
    socket.dreamRoomId = childId;
    socket.join(roomName);

    const normalizedPetId = String(petId || "").trim();
    if (!normalizedPetId || normalizedPetId === "undefined" || normalizedPetId === "null") {
      console.warn("[DREAM] Invalid petId during join:", petId);
      return;
    }

    const sockets = await io.in(roomName).fetchSockets();
    const activePetIds = new Set(
      sockets
        .map((s) => String(s.data?.petId || "").trim())
        .filter((id) => id && id !== "undefined" && id !== "null")
    );
    activePetIds.add(normalizedPetId);
    
    const uniquePetIdsList = [...activePetIds];
    console.log(`[DREAM] Room: ${roomName}, Participants:`, uniquePetIdsList);

    let game = dreamGameMap.get(roomName);

    if (!game) {
      dreamRoomStartedSet.add(roomName);
      try {
        const hint = await dreamGameService.generateDreamHint();
        game = { 
          hint, 
          choices: {}, 
          participants: uniquePetIdsList 
        };
        dreamGameMap.set(roomName, game);
        console.log(`[DREAM] New game created for ${roomName}`);
      } catch (err) {
        console.error("[DREAM] hint error:", err);
        return;
      }
    } else {
      uniquePetIdsList.forEach(id => {
        if (!game.participants.includes(id)) {
          game.participants.push(id);
        }
      });
    }

    // 역할 고정 (Array Index 0 = Architect, Index 1 = Guide)
    const architectId = game.participants[0];
    const guideId = game.participants.length > 1 ? game.participants[1] : null;

    const rolesMap = {
      architect: String(architectId || "").trim(),
      guide: guideId ? String(guideId).trim() : null
    };

    io.to(roomName).emit("dream_game_started", {
      hint: game.hint,
      rolesMap,
      currentChoices: game.choices,
    });
  });

  socket.on("select_dream_element", async ({ childId, role, elementId, petName, petId }) => {
    const roomName = `dream_room_${childId}`;
    const game = dreamGameMap.get(roomName);
    if (!game) return;

    const normalizedPetId = String(petId || "").trim().toLowerCase();
    game.choices[role] = elementId;

    console.log(`[DREAM] ${petName} [${role}] -> ${elementId}`);

    io.to(roomName).emit("dream_element_selected", {
      role,
      elementId,
      petId: normalizedPetId,
    });

    if (game.choices.architect && game.choices.guide) {
      io.to(roomName).emit("dream_evaluating");

      try {
        const result = await dreamGameService.createDreamStory(game.hint, {
          place: game.choices.architect,
          guide: game.choices.guide,
        });

        const changes = {
          healthHp: result.changes?.healthHp ?? 10,
          affection: result.changes?.affection ?? 10,
          exp: result.changes?.exp ?? 10,
        };

        const { pool } = require("../database/database");
        await pool.query(
          `UPDATE pets SET health_hp = LEAST(health_hp + $2, 100), affection = LEAST(affection + $3, 100), exp = exp + $4 WHERE id = $1`,
          [childId, changes.healthHp, changes.affection, changes.exp]
        );

        io.to(roomName).emit("dream_game_result", { ...result, changes });
        dreamGameMap.delete(roomName);
        dreamRoomStartedSet.delete(roomName);
      } catch (err) {
        console.error("[DREAM] Result error:", err);
        io.to(roomName).emit("dream_game_error", { message: "꿈의 연결이 끊어졌어요." });
      }
    }
  });

  socket.on("leave_dream_room", async ({ childId, petName }) => {
    const roomName = `dream_room_${childId}`;
    socket.leave(roomName);
    delete socket.dreamRoomId;

    setTimeout(async () => {
      const sockets = await io.in(roomName).fetchSockets();
      const stillIn = sockets.some(s => String(s.data?.petId) === String(socket.petId));
      if (!stillIn) {
        io.to(roomName).emit("dream_partner_left", petName || "배우자");
        dreamGameMap.delete(roomName);
        dreamRoomStartedSet.delete(roomName);
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
          hint: game.hint,
          currentTurnPetId: game.participants[0],
        });
      }
      return;
    }

    bathRoomStartedSet.add(roomName);
    try {
      const { word, hint } = await bathGameService.initializeGame();
      const pIds = uniquePetIds;
      bathGameMap.set(roomName, {
        word,
        hint,
        questions: [],
        turnCount: 0,
        participants: pIds,
      });
      io.in(roomName).emit("bath_game_started", { hint, currentTurnPetId: pIds[0] });
    } catch (err) {
      bathRoomStartedSet.delete(roomName);
    }
  });

  socket.on("ask_bath_question", async ({ childId, question, petName, petId }) => {
    const roomName = `bath_room_${childId}`;
    const game = bathGameMap.get(roomName);
    if (!game) return;

    const answer = await bathGameService.answerQuestion(game.word, question);
    const log = { petName, question, answer };
    game.questions.push(log);
    game.turnCount++;
    io.in(roomName).emit("bath_question_answered", log);

    if (game.turnCount >= 20) {
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
      const evaluation = await bathGameService.evaluateResult(true, game.turnCount, game.word, game.questions);
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
    } else if (game.turnCount >= 20) {
      const evaluation = await bathGameService.evaluateResult(false, 20, game.word, game.questions);
      const changes = {
        cleanliness: evaluation.changes?.cleanliness ?? 30,
        affection: evaluation.changes?.affection ?? -5,
        knowledge: evaluation.changes?.knowledge ?? 0,
        exp: evaluation.changes?.exp ?? 10,
      };
      const { pool } = require("../database/database");
      await pool.query(
        `UPDATE pets SET cleanliness = LEAST(cleanliness + $2, 100), affection = GREATEST(affection + $3, 0), knowledge = LEAST(knowledge + $4, 100), exp = exp + $5 WHERE id = $1`,
        [childId, changes.cleanliness, changes.affection, changes.knowledge, changes.exp],
      );
      io.in(roomName).emit("bath_game_result", { ...evaluation, word: game.word, changes });
      bathGameMap.delete(roomName);
      bathRoomStartedSet.delete(roomName);
    }
  });
};
