import { io, Socket } from "socket.io-client";
import { SOCKET_URL } from "../config";

const RECONNECT_INTERVAL_MS = 5000;

let globalSocket: Socket | null = null;
let reconnectTimer: ReturnType<typeof setInterval> | null = null;

function startReconnectLoop(socket: Socket) {
  if (reconnectTimer) return;

  reconnectTimer = setInterval(() => {
    if (!socket.connected) {
      console.log(`Retrying socket connection to ${SOCKET_URL}...`);
      socket.connect();
    }
  }, RECONNECT_INTERVAL_MS);
}

export function getSocket(): Socket {
  if (!globalSocket) {
    console.log("Creating socket connection to:", SOCKET_URL);

    globalSocket = io(SOCKET_URL, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: RECONNECT_INTERVAL_MS,
      reconnectionDelayMax: RECONNECT_INTERVAL_MS,
      reconnectionAttempts: Infinity,
      autoConnect: false,
    });

    globalSocket.on("connect_error", (error) => {
      console.log(
        `Socket connection failed, retrying every ${RECONNECT_INTERVAL_MS / 1000}s:`,
        error.message
      );
    });

    startReconnectLoop(globalSocket);
  }

  return globalSocket;
}

export function connectSocket(): void {
  const socket = getSocket();
  if (!socket.connected) {
    socket.connect();
  }
}
