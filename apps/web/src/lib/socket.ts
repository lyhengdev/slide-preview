import { io, type Socket } from "socket.io-client";
import { API_ORIGIN } from "./api";

let adminSocket: Socket | null = null;
let judgeSocket: Socket | null = null;

/**
 * Cross-origin deployments (static site + API service) need credentials on the
 * handshake, otherwise the httpOnly session cookie is never sent and the server
 * rejects the connection. In development API_ORIGIN is empty, which keeps the
 * Socket.IO handshake on the Vite proxy.
 */
const socketUrl = API_ORIGIN || undefined;
const baseOptions = { path: "/socket.io", withCredentials: true } as const;

export function connectAdminSocket(): Socket {
  adminSocket?.disconnect();
  adminSocket = io(socketUrl, { ...baseOptions });
  return adminSocket;
}

export function getAdminSocket(): Socket | null {
  return adminSocket;
}

export function disconnectAdminSocket(): void {
  adminSocket?.disconnect();
  adminSocket = null;
}

export function connectJudgeSocket(opts: {
  token: string;
  sessionId: string;
  judgeCode: string;
  deviceId: string;
}): Socket {
  judgeSocket?.disconnect();
  judgeSocket = io(socketUrl, {
    ...baseOptions,
    auth: {
      judgeToken: opts.token,
      sessionId: opts.sessionId,
      judgeCode: opts.judgeCode,
      deviceId: opts.deviceId,
    },
  });
  return judgeSocket;
}

export function getJudgeSocket(): Socket | null {
  return judgeSocket;
}

export function disconnectJudgeSocket(): void {
  judgeSocket?.disconnect();
  judgeSocket = null;
}