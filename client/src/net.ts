import type { ClientMessage, ServerMessage, Snapshot, ChatMessage } from "@onevonejev/shared";

export type NetHandlers = {
  onWelcome: (id: string, name: string) => void;
  onSnapshot: (snap: Snapshot) => void;
  onChat: (msg: ChatMessage) => void;
  onClose: () => void;
};

export class Net {
  private ws: WebSocket | null = null;
  private handlers: NetHandlers;

  constructor(handlers: NetHandlers) {
    this.handlers = handlers;
  }

  connect(): void {
    const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
    const url =
      envUrl && envUrl.length > 0
        ? envUrl
        : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    this.ws = new WebSocket(url);
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as ServerMessage;
      if (msg.type === "welcome") this.handlers.onWelcome(msg.id, msg.name);
      else if (msg.type === "snapshot") this.handlers.onSnapshot(msg.snap);
      else if (msg.type === "chat") this.handlers.onChat(msg.msg);
    };
    this.ws.onclose = () => this.handlers.onClose();
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
