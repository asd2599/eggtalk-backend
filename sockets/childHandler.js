// Child (Parenting) 관련 소켓 이벤트 핸들러
module.exports = (io, socket, state) => {
  const { activeUsers, hatchProgressMap, rolePlayReadyMap } = state;

  socket.on("join_child_room", async ({ childId, petId, petName }) => {
    const roomName = `child_room_${childId}`;
    socket.join(roomName);
    socket.childRoomId = childId;
    socket.petId = petId;
    socket.childPetName = petName;

    const sockets = await io.in(roomName).fetchSockets();
    if (!hatchProgressMap.has(roomName)) hatchProgressMap.set(roomName, 0);

    socket.emit("child_room_status", {
      isSpouseInRoom: sockets.length > 1,
      onlineUsers: Array.from(activeUsers.keys()),
      hatchProgress: hatchProgressMap.get(roomName),
    });
    socket.to(roomName).emit("spouse_entered_child_room", petName);
  });

  socket.on("hatch_start_request", ({ childId }) => {
    const roomName = `child_room_${childId}`;
    hatchProgressMap.set(roomName, 0);
    io.in(roomName).emit("hatch_started", { duration: 15 });
  });

  socket.on("hatch_tap", ({ childId }) => {
    const roomName = `child_room_${childId}`;
    let progress = Math.min((hatchProgressMap.get(roomName) || 0) + 2, 100);
    hatchProgressMap.set(roomName, progress);
    io.in(roomName).emit("hatch_progress_updated", { progress });
  });

  socket.on(
    "child_action_request",
    ({ childId, actionType, requesterName }) => {
      socket
        .to(`child_room_${childId}`)
        .emit("child_action_proposed", { actionType, requesterName });
    },
  );

  socket.on("child_action_response", ({ childId, approved, actionType }) => {
    const roomName = `child_room_${childId}`;
    if (approved) io.in(roomName).emit("child_action_sync", { actionType });
    else socket.to(roomName).emit("child_action_rejected", { actionType });
  });

  socket.on("child_pet_farewell_request", ({ childId, requesterName }) => {
    socket
      .to(`child_room_${childId}`)
      .emit("child_pet_farewell_proposed", { requesterName });
  });

  socket.on("child_pet_farewell_response", ({ childId, approved }) => {
    const roomName = `child_room_${childId}`;
    if (approved) io.in(roomName).emit("child_pet_farewell_approved");
    else socket.to(roomName).emit("child_pet_farewell_rejected");
  });

  socket.on(
    "child_pet_rename_request",
    ({ childId, newName, requesterName }) => {
      socket
        .to(`child_room_${childId}`)
        .emit("child_pet_rename_proposed", { newName, requesterName });
    },
  );

  socket.on("child_pet_rename_response", ({ childId, approved, newName }) => {
    const roomName = `child_room_${childId}`;
    if (approved)
      io.in(roomName).emit("child_pet_rename_approved", { newName });
    else socket.to(roomName).emit("child_pet_rename_rejected");
  });
};
