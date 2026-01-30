import { logger } from "@/lib/logger";
import { EventFrame, GatewayFrame, ReqFrame, ResFrame } from "./frames";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

type StatusHandler = (status: GatewayStatus) => void;

type EventHandler = (event: EventFrame) => void;

export type GatewayStatus = "disconnected" | "connecting" | "connected";

export type GatewayConnectOptions = {
  gatewayUrl: string;
  token?: string;
};

export type GatewayErrorPayload = {
  code: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
  retryAfterMs?: number;
};

export class GatewayResponseError extends Error {
  code: string;
  details?: unknown;
  retryable?: boolean;
  retryAfterMs?: number;

  constructor(payload: GatewayErrorPayload) {
    super(payload.message || "Gateway request failed");
    this.name = "GatewayResponseError";
    this.code = payload.code;
    this.details = payload.details;
    this.retryable = payload.retryable;
    this.retryAfterMs = payload.retryAfterMs;
  }
}

export class GatewayClient {
  private socket: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private statusHandlers = new Set<StatusHandler>();
  private eventHandlers = new Set<EventHandler>();
  private status: GatewayStatus = "disconnected";
  private lastChallenge: unknown = null;

  onStatus(handler: StatusHandler) {
    this.statusHandlers.add(handler);
    handler(this.status);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  onEvent(handler: EventHandler) {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  async connect(options: GatewayConnectOptions) {
    if (!options.gatewayUrl.trim()) {
      throw new Error("Gateway URL is required.");
    }
    if (this.socket) {
      throw new Error("Gateway is already connected or connecting.");
    }

    this.lastChallenge = null;
    this.updateStatus("connecting");

    const socket = new WebSocket(options.gatewayUrl);
    this.socket = socket;

    socket.addEventListener("message", (event) => {
      this.handleMessage(event.data);
    });

    socket.addEventListener("close", () => {
      this.handleClose();
    });

    socket.addEventListener("error", () => {
      logger.error("Gateway socket error.");
    });

    try {
      await this.waitForOpen(socket);

      const connectParams: Record<string, unknown> = {
        minProtocol: 3,
        maxProtocol: 3,
        role: "operator",
        scopes: ["operator.admin", "operator.approvals", "operator.pairing"],
        client: {
          id: "openclaw-control-ui",
          version: "0.1.0",
          platform: navigator.platform ?? "web",
          mode: "ui",
        },
        caps: [],
        userAgent: navigator.userAgent,
        locale: navigator.language,
      };

      if (options.token) {
        connectParams.auth = { token: options.token };
      }

      await this.sendRequest("connect", connectParams);

      this.updateStatus("connected");
      logger.info("Gateway connected.");
    } catch (error) {
      const reason =
        error instanceof Error ? error : new Error("Gateway connect failed.");
      this.socket?.close();
      this.socket = null;
      this.clearPending(reason);
      this.updateStatus("disconnected");
      throw error;
    }
  }

  disconnect() {
    if (!this.socket) {
      return;
    }

    this.socket.close();
    this.socket = null;
    this.lastChallenge = null;
    this.clearPending(new Error("Gateway disconnected."));
    this.updateStatus("disconnected");
    logger.info("Gateway disconnected.");
  }

  async call<T = unknown>(method: string, params: unknown): Promise<T> {
    if (!method.trim()) {
      throw new Error("Gateway method is required.");
    }
    if (!this.socket || this.status !== "connected") {
      throw new Error("Gateway is not connected.");
    }

    const payload = await this.sendRequest(method, params);
    return payload as T;
  }

  getLastChallenge() {
    return this.lastChallenge;
  }

  private updateStatus(status: GatewayStatus) {
    this.status = status;
    this.statusHandlers.forEach((handler) => handler(status));
  }

  private async waitForOpen(socket: WebSocket) {
    if (socket.readyState === WebSocket.OPEN) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const handleOpen = () => {
        cleanup();
        resolve();
      };

      const handleError = () => {
        cleanup();
        reject(new Error("Gateway connection failed."));
      };

      const handleClose = () => {
        cleanup();
        reject(new Error("Gateway closed before handshake."));
      };

      const cleanup = () => {
        socket.removeEventListener("open", handleOpen);
        socket.removeEventListener("error", handleError);
        socket.removeEventListener("close", handleClose);
      };

      socket.addEventListener("open", handleOpen);
      socket.addEventListener("error", handleError);
      socket.addEventListener("close", handleClose);
    });
  }

  private async waitForChallenge(timeoutMs: number) {
    if (this.lastChallenge !== null) {
      return this.lastChallenge;
    }
    return await new Promise<unknown | null>((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve(null);
      }, timeoutMs);

      const unsubscribe = this.onEvent((event) => {
        if (event.event !== "connect.challenge") {
          return;
        }
        clearTimeout(timeoutId);
        unsubscribe();
        resolve(event.payload ?? null);
      });
    });
  }

  private async sendRequest(method: string, params: unknown) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Gateway socket is not open.");
    }

    const id = crypto.randomUUID();
    const frame: ReqFrame = { type: "req", id, method, params };

    const payload = await new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Gateway request timed out: ${method}`));
      }, 20000);

      this.pending.set(id, { resolve, reject, timeoutId });

      this.socket?.send(JSON.stringify(frame));
    });

    return payload;
  }

  private handleMessage(data: unknown) {
    if (typeof data !== "string") {
      return;
    }

    let parsed: GatewayFrame | null = null;

    try {
      parsed = JSON.parse(data) as GatewayFrame;
    } catch {
      logger.error("Failed to parse gateway frame.");
      return;
    }

    if (parsed.type === "event") {
      if (parsed.event === "connect.challenge") {
        this.lastChallenge = parsed.payload ?? null;
      }
      this.eventHandlers.forEach((handler) => handler(parsed));
      return;
    }

    if (parsed.type === "res") {
      this.handleResponse(parsed);
      return;
    }
  }

  private handleResponse(frame: ResFrame) {
    const pending = this.pending.get(frame.id);
    if (!pending) {
      return;
    }

    this.pending.delete(frame.id);
    clearTimeout(pending.timeoutId);

    if (frame.ok) {
      pending.resolve(frame.payload);
      return;
    }

    if (frame.error) {
      pending.reject(new GatewayResponseError(frame.error));
      return;
    }

    pending.reject(new Error("Gateway request failed."));
  }

  private handleClose() {
    if (!this.socket) {
      return;
    }

    this.socket = null;
    this.lastChallenge = null;
    this.clearPending(new Error("Gateway disconnected."));
    this.updateStatus("disconnected");
    logger.info("Gateway socket closed.");
  }

  private clearPending(error: Error) {
    this.pending.forEach((pending) => {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
    });
    this.pending.clear();
  }
}
