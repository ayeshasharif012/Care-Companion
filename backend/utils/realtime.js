/** Emit real-time events to connected mobile clients (Socket.IO). */
export function emitRealtime(app, event, payload) {
  try {
    const io = app?.get?.("io");
    if (io) {
      io.emit(event, payload);
    }
  } catch (err) {
    console.warn(`⚠️ Socket emit ${event} failed:`, err.message);
  }
}
