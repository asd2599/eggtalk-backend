// Social 관련 소켓 이벤트 핸들러 (로그인, 친구, 교배)
module.exports = (io, socket, state) => {
  const { activeUsers, socketToPetName } = state;

  const getSanitizedName = (data) => {
    if (!data) return "";
    if (typeof data === "string") return data.trim();
    if (typeof data === "object") {
      return (data.petName || data.name || String(data)).trim();
    }
    return String(data).trim();
  };

  socket.on("user_login", (data) => {
    const petName = getSanitizedName(data);
    if (!petName) return;

    socketToPetName.set(socket.id, petName);
    if (!activeUsers.has(petName)) activeUsers.set(petName, new Set());
    activeUsers.get(petName).add(socket.id);
    const onlineNames = Array.from(activeUsers.keys()).map(k => 
      typeof k === "object" ? k.petName : String(k)
    );
    const uniqueNames = Array.from(new Set(onlineNames));

    io.emit("online_users_list", uniqueNames);
    io.emit("update_user_count", io.engine.clientsCount);
  });

  socket.on("user_logout", (data) => {
    /* 클라이언트가 강제 로그아웃 버튼을 눌렀을 경우 연결을 자발적으로 청소 */
    const petName = getSanitizedName(data) || socketToPetName.get(socket.id);
    if (!petName) return;

    const userSockets = activeUsers.get(petName);
    if (userSockets) {
      userSockets.delete(socket.id);
      if (userSockets.size === 0) activeUsers.delete(petName);
    }
    socketToPetName.delete(socket.id);

    const onlineNames = Array.from(activeUsers.keys()).map(k => 
      typeof k === "object" ? k.petName : String(k)
    );
    const uniqueNames = Array.from(new Set(onlineNames));
    
    io.emit("online_users_list", uniqueNames);
    io.emit("update_user_count", io.engine.clientsCount); // disconnect는 index에서 커버되지만 예방적 브로드캐스트 추가
  });

  socket.on("get_online_users", (callback) => {
    if (typeof callback === "function") {
      const onlineNames = Array.from(activeUsers.keys()).map(k => 
        typeof k === "object" ? k.petName : String(k)
      );
      callback(Array.from(new Set(onlineNames)));
    }
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

  socket.on("send_direct_message", (data) => {
    const { receiverPetName } = data;
    const receiverSockets = activeUsers.get(receiverPetName);
    if (receiverSockets) {
      receiverSockets.forEach((socketId) => {
        io.to(socketId).emit("receive_direct_message", data);
      });
    }
  });

  socket.on("invite_to_dating", (data) => {
    console.log("[DEBUG-BACK] invite_to_dating raw data:", data);
    const receiverPetName = getSanitizedName(data.receiverPetName);
    const requesterPetName = getSanitizedName(data.requesterPetName);
    const roomId = data.roomId;
    const roomName = data.roomName;

    console.log(
      `[DEBUG-BACK] BROADCASTING: ${requesterPetName} -> ${receiverPetName} (Room: ${roomName})`,
    );

    io.emit("dating_invitation", {
      receiverPetName: receiverPetName,
      requesterPetName: requesterPetName,
      roomId: roomId,
      roomName: roomName,
    });
  });

  socket.on("invite_to_child_room", (data) => {
    console.log("[DEBUG-BACK] invite_to_child_room raw data:", data);
    const receiverPetName = getSanitizedName(data.receiverPetName);
    const requesterPetName = getSanitizedName(data.requesterPetName);
    const { childId, childPetName } = data;

    io.emit("child_room_invitation", {
      receiverPetName: receiverPetName,
      requesterPetName: requesterPetName,
      childId: childId,
      childPetName: childPetName,
    });
  });
};
