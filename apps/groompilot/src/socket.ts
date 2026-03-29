import { Server } from "socket.io";
import http from "http";

export function initSocket(server: http.Server) {
  const io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
    },
  });

  // Track active sessions: sessionId -> Set<socketId>
  const sessions = new Map<string, Set<string>>();
  // Track user info: socketId -> { username, sessionId }
  const users = new Map<string, { username: string; sessionId: string }>();

  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Join a grooming session
    socket.on("join-session", (data: { sessionId: string; username: string }) => {
      const { sessionId, username } = data;
      socket.join(sessionId);

      if (!sessions.has(sessionId)) sessions.set(sessionId, new Set());
      sessions.get(sessionId)!.add(socket.id);
      users.set(socket.id, { username, sessionId });

      // Broadcast user joined
      io.to(sessionId).emit("session-users", {
        users: Array.from(sessions.get(sessionId)!).map((sid) => ({
          id: sid,
          username: users.get(sid)?.username || "Anonymous",
        })),
      });

      socket.to(sessionId).emit("user-joined", { username, socketId: socket.id });
    });

    // Broadcast grooming updates
    socket.on("grooming-update", (data: { sessionId: string; update: unknown }) => {
      socket.to(data.sessionId).emit("grooming-update", data.update);
    });

    // Real-time cursor/selection sync
    socket.on("cursor-sync", (data: { sessionId: string; cursor: unknown }) => {
      socket.to(data.sessionId).emit("cursor-sync", {
        socketId: socket.id,
        username: users.get(socket.id)?.username,
        cursor: data.cursor,
      });
    });

    // Voting (for estimation)
    socket.on("vote", (data: { sessionId: string; vote: string }) => {
      io.to(data.sessionId).emit("vote-cast", {
        socketId: socket.id,
        username: users.get(socket.id)?.username,
        vote: data.vote,
      });
    });

    socket.on("disconnect", () => {
      const userInfo = users.get(socket.id);
      if (userInfo) {
        const { sessionId, username } = userInfo;
        sessions.get(sessionId)?.delete(socket.id);
        if (sessions.get(sessionId)?.size === 0) sessions.delete(sessionId);
        users.delete(socket.id);

        io.to(sessionId).emit("user-left", { username, socketId: socket.id });
        if (sessions.has(sessionId)) {
          io.to(sessionId).emit("session-users", {
            users: Array.from(sessions.get(sessionId)!).map((sid) => ({
              id: sid,
              username: users.get(sid)?.username || "Anonymous",
            })),
          });
        }
      }
    });
  });

  return io;
}
