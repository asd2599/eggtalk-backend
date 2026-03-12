// Social 관련 소켓 이벤트 핸들러 (로그인, 친구, 교배)
module.exports = (io, socket, state) => {
  const { activeUsers, socketToPetName } = state;

  socket.on("user_login", (petName) => {
    socketToPetName.set(socket.id, petName);
    if (!activeUsers.has(petName)) activeUsers.set(petName, new Set());
    activeUsers.get(petName).add(socket.id);
    io.emit("online_users_list", Array.from(activeUsers.keys()));
  });

  // [Friend/Breeding Requests]
  socket.on(
    "send_friend_request",
    ({ roomId, requesterPetName, receiverPetName, requestId }) => {
      socket.to(roomId).emit("receive_friend_request", {
        requesterPetName,
        receiverPetName,
        requestId,
      });
    },
  );

  socket.on(
    "send_breeding_request",
    ({ roomId, requesterPetName, receiverPetName }) => {
      socket.to(roomId).emit("receive_breeding_request", {
        requesterPetName,
        receiverPetName,
      });
    },
  );

  socket.on(
    "accept_breeding_request",
    ({ roomId, requesterPetName, receiverPetName }) => {
      io.to(roomId).emit("breeding_accepted", {
        roomId,
        requesterPetName,
        receiverPetName,
      });
    },
  );
};
