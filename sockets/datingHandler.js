// Dating 관련 소켓 이벤트 핸들러
module.exports = (io, socket) => {
  // [Dating Room]
  socket.on("join_dating_room", async ({ roomId, petName }, callback) => {
    if (!socket.rooms.has(roomId)) {
      socket.join(roomId);
      socket.roomId = roomId;
      socket.petName = petName;
      socket.to(roomId).emit("receive_dating_message", {
        sender: "System",
        message: `${petName}님이 방에 들어왔습니다!`,
        isSystem: true,
      });
    }
    if (callback) callback({ success: true, roomId });
  });

  socket.on("send_dating_message", (data) => {
    if (data?.roomId) {
      const { roomId, ...msgData } = data;
      socket
        .to(roomId)
        .emit("receive_dating_message", { ...msgData, timestamp: new Date() });
    }
  });
};
