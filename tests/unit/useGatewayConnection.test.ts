import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const ORIGINAL_ENV = { ...process.env };

const setupAndImportHook = async (gatewayUrl: string | null) => {
  process.env = { ...ORIGINAL_ENV };
  if (gatewayUrl === null) {
    delete process.env.NEXT_PUBLIC_GATEWAY_URL;
  } else {
    process.env.NEXT_PUBLIC_GATEWAY_URL = gatewayUrl;
  }

  vi.resetModules();
  vi.spyOn(console, "info").mockImplementation(() => {});

  const captured: {
    url: string | null;
    token: unknown;
    authScopeKey: unknown;
    startCount: number;
    stopCount: number;
  } = {
    url: null,
    token: null,
    authScopeKey: null,
    startCount: 0,
    stopCount: 0,
  };

  vi.doMock("../../src/lib/gateway/openclaw/GatewayBrowserClient", () => {
    class GatewayBrowserClient {
      connected = false;
      private opts: {
        onHello?: (hello: unknown) => void;
        onEvent?: (event: unknown) => void;
        onClose?: (info: { code: number; reason: string }) => void;
        onGap?: (info: { expected: number; received: number }) => void;
      };

      constructor(opts: Record<string, unknown>) {
        captured.url = typeof opts.url === "string" ? opts.url : null;
        captured.token = "token" in opts ? opts.token : null;
        captured.authScopeKey = "authScopeKey" in opts ? opts.authScopeKey : null;
        this.opts = {
          onHello: typeof opts.onHello === "function" ? (opts.onHello as (hello: unknown) => void) : undefined,
          onEvent: typeof opts.onEvent === "function" ? (opts.onEvent as (event: unknown) => void) : undefined,
          onClose: typeof opts.onClose === "function" ? (opts.onClose as (info: { code: number; reason: string }) => void) : undefined,
          onGap: typeof opts.onGap === "function" ? (opts.onGap as (info: { expected: number; received: number }) => void) : undefined,
        };
      }

      start() {
        captured.startCount += 1;
        this.connected = true;
        this.opts.onHello?.({ type: "hello-ok", protocol: 1 });
      }

      stop() {
        captured.stopCount += 1;
        this.connected = false;
        this.opts.onClose?.({ code: 1000, reason: "stopped" });
      }

      async request<T = unknown>(method: string, params: unknown): Promise<T> {
        void method;
        void params;
        return {} as T;
      }
    }

    return { GatewayBrowserClient };
  });

  const mod = await import("@/lib/gateway/GatewayClient");
  return {
    useGatewayConnection: mod.useGatewayConnection as (settingsCoordinator: {
      loadSettings: () => Promise<unknown>;
      loadSettingsEnvelope?: () => Promise<unknown>;
      schedulePatch: (patch: unknown) => void;
      flushPending: () => Promise<void>;
    }) => {
      gatewayUrl: string;
      token: string;
      localGatewayDefaults: { url: string; token: string } | null;
      domainApiModeEnabled: boolean | null;
      useLocalGatewayDefaults: () => void;
      setGatewayUrl: (value: string) => void;
      setToken: (value: string) => void;
    },
    captured,
  };
};

describe("useGatewayConnection", () => {
  afterEach(() => {
    cleanup();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("defaults_to_env_url_when_set", async () => {
    const { useGatewayConnection } = await setupAndImportHook("ws://example.test:1234");
    const coordinator = {
      loadSettings: async () => null,
      schedulePatch: () => {},
      flushPending: async () => {},
    };

    const Probe = () =>
      createElement(
        "div",
        { "data-testid": "gatewayUrl" },
        useGatewayConnection(coordinator).gatewayUrl
      );

    render(createElement(Probe));

    await waitFor(() => {
      expect(screen.getByTestId("gatewayUrl")).toHaveTextContent("ws://example.test:1234");
    });
  });

  it("falls_back_to_local_default_when_env_unset", async () => {
    const { useGatewayConnection } = await setupAndImportHook(null);
    const coordinator = {
      loadSettings: async () => null,
      schedulePatch: () => {},
      flushPending: async () => {},
    };

    const Probe = () =>
      createElement(
        "div",
        { "data-testid": "gatewayUrl" },
        useGatewayConnection(coordinator).gatewayUrl
      );

    render(createElement(Probe));

    await waitFor(() => {
      expect(screen.getByTestId("gatewayUrl")).toHaveTextContent("ws://localhost:18789");
    });
  });

  it("connects_via_studio_proxy_ws_and_does_not_pass_token", async () => {
    const { useGatewayConnection, captured } = await setupAndImportHook(null);
    const coordinator = {
      loadSettings: async () => null,
      schedulePatch: () => {},
      flushPending: async () => {},
    };

    const Probe = () => {
      useGatewayConnection(coordinator);
      return createElement("div", null, "ok");
    };

    render(createElement(Probe));

    await waitFor(() => {
      expect(captured.url).toBe("ws://localhost:3000/api/gateway/ws");
    });
    expect(captured.token).toBe("");
    expect(captured.authScopeKey).toBe("ws://localhost:18789");
  });

  it("applies_local_defaults_from_settings_envelope", async () => {
    const { useGatewayConnection } = await setupAndImportHook(null);
    const coordinator = {
      loadSettings: async () => ({
        version: 1,
        gateway: null,
        focused: {},
        avatars: {},
      }),
      loadSettingsEnvelope: async () => ({
        settings: {
          version: 1,
          gateway: { url: "wss://remote.example", token: "" },
          focused: {},
          avatars: {},
        },
        localGatewayDefaults: { url: "ws://localhost:18789", token: "" },
        domainApiModeEnabled: true,
      }),
      schedulePatch: () => {},
      flushPending: async () => {},
    };

    const Probe = () => {
      const state = useGatewayConnection(coordinator);
      return createElement(
        "div",
        null,
        createElement("div", { "data-testid": "gatewayUrl" }, state.gatewayUrl),
        createElement("div", { "data-testid": "token" }, state.token),
        createElement(
          "div",
          { "data-testid": "localDefaultsUrl" },
          state.localGatewayDefaults?.url ?? ""
        ),
        createElement(
          "div",
          { "data-testid": "domainApiModeEnabled" },
          state.domainApiModeEnabled === null ? "null" : String(state.domainApiModeEnabled)
        ),
        createElement(
          "button",
          {
            type: "button",
            onClick: state.useLocalGatewayDefaults,
            "data-testid": "useLocalDefaults",
          },
          "use"
        )
      );
    };

    render(createElement(Probe));

    await waitFor(() => {
      expect(screen.getByTestId("gatewayUrl")).toHaveTextContent("wss://remote.example");
    });
    expect(screen.getByTestId("token")).toHaveTextContent("");
    expect(screen.getByTestId("localDefaultsUrl")).toHaveTextContent("ws://localhost:18789");
    expect(screen.getByTestId("domainApiModeEnabled")).toHaveTextContent("true");

    fireEvent.click(screen.getByTestId("useLocalDefaults"));

    await waitFor(() => {
      expect(screen.getByTestId("gatewayUrl")).toHaveTextContent("ws://localhost:18789");
    });
    expect(screen.getByTestId("token")).toHaveTextContent("");
  });

  it("does_not_auto_connect_when_domain_mode_is_enabled", async () => {
    const { useGatewayConnection, captured } = await setupAndImportHook(null);
    const coordinator = {
      loadSettings: async () => null,
      loadSettingsEnvelope: async () => ({
        settings: {
          version: 1,
          gateway: { url: "wss://remote.example", token: "" },
          focused: {},
          avatars: {},
        },
        localGatewayDefaults: null,
        domainApiModeEnabled: true,
      }),
      schedulePatch: () => {},
      flushPending: async () => {},
    };

    const Probe = () => {
      const state = useGatewayConnection(coordinator);
      return createElement(
        "div",
        { "data-testid": "domainApiModeEnabled" },
        state.domainApiModeEnabled === null ? "null" : String(state.domainApiModeEnabled)
      );
    };

    render(createElement(Probe));

    await waitFor(() => {
      expect(screen.getByTestId("domainApiModeEnabled")).toHaveTextContent("true");
    });
    expect(captured.url).toBeNull();
    expect(captured.startCount).toBe(0);
    expect(captured.stopCount).toBe(0);
  });

  it("disconnects legacy websocket when domain mode flips to enabled", async () => {
    const { useGatewayConnection, captured } = await setupAndImportHook(null);
    const legacyCoordinator = {
      loadSettings: async () => null,
      loadSettingsEnvelope: async () => ({
        settings: {
          version: 1,
          gateway: { url: "wss://legacy.example", token: "" },
          focused: {},
          avatars: {},
        },
        localGatewayDefaults: null,
        domainApiModeEnabled: false,
      }),
      schedulePatch: () => {},
      flushPending: async () => {},
    };
    const domainCoordinator = {
      ...legacyCoordinator,
      loadSettingsEnvelope: async () => ({
        settings: {
          version: 1,
          gateway: { url: "wss://legacy.example", token: "" },
          focused: {},
          avatars: {},
        },
        localGatewayDefaults: null,
        domainApiModeEnabled: true,
      }),
    };

    const Probe = ({ coordinator }: { coordinator: typeof legacyCoordinator }) => {
      const state = useGatewayConnection(coordinator);
      return createElement(
        "div",
        { "data-testid": "domainApiModeEnabled" },
        state.domainApiModeEnabled === null ? "null" : String(state.domainApiModeEnabled)
      );
    };

    const view = render(createElement(Probe, { coordinator: legacyCoordinator }));

    await waitFor(() => {
      expect(captured.startCount).toBe(1);
    });
    expect(captured.stopCount).toBe(0);

    view.rerender(createElement(Probe, { coordinator: domainCoordinator }));

    await waitFor(() => {
      expect(screen.getByTestId("domainApiModeEnabled")).toHaveTextContent("true");
    });
    await waitFor(() => {
      expect(captured.stopCount).toBeGreaterThanOrEqual(1);
    });
  });

  it("persists gateway url changes without sending token", async () => {
    const { useGatewayConnection } = await setupAndImportHook(null);
    const schedulePatch = vi.fn();
    const coordinator = {
      loadSettings: async () => null,
      loadSettingsEnvelope: async () => ({
        settings: {
          version: 1,
          gateway: { url: "wss://remote.example", token: "" },
          focused: {},
          avatars: {},
        },
        localGatewayDefaults: null,
      }),
      schedulePatch,
      flushPending: async () => {},
    };

    const Probe = () => {
      const state = useGatewayConnection(coordinator);
      return createElement(
        "div",
        null,
        createElement("div", { "data-testid": "gatewayUrl" }, state.gatewayUrl),
        createElement(
          "button",
          {
            type: "button",
            onClick: () => state.setGatewayUrl("wss://remote-next.example"),
            "data-testid": "changeUrl",
          },
          "change"
        )
      );
    };

    render(createElement(Probe));

    await waitFor(() => {
      expect(screen.getByTestId("gatewayUrl")).toHaveTextContent("wss://remote.example");
    });
    expect(schedulePatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("changeUrl"));

    await waitFor(() => {
      expect(schedulePatch).toHaveBeenCalled();
    });
    expect(schedulePatch).toHaveBeenLastCalledWith(
      { gateway: { url: "wss://remote-next.example" } },
      400
    );
  });

  it("persists token only after explicit token edit", async () => {
    const { useGatewayConnection } = await setupAndImportHook(null);
    const schedulePatch = vi.fn();
    const coordinator = {
      loadSettings: async () => null,
      loadSettingsEnvelope: async () => ({
        settings: {
          version: 1,
          gateway: { url: "wss://remote.example", token: "" },
          focused: {},
          avatars: {},
        },
        localGatewayDefaults: null,
      }),
      schedulePatch,
      flushPending: async () => {},
    };

    const Probe = () => {
      const state = useGatewayConnection(coordinator);
      return createElement(
        "div",
        null,
        createElement("div", { "data-testid": "gatewayUrl" }, state.gatewayUrl),
        createElement(
          "button",
          {
            type: "button",
            onClick: () => state.setToken("manual-token"),
            "data-testid": "setToken",
          },
          "token"
        )
      );
    };

    render(createElement(Probe));

    await waitFor(() => {
      expect(screen.getByTestId("gatewayUrl")).toHaveTextContent("wss://remote.example");
    });
    expect(schedulePatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("setToken"));

    await waitFor(() => {
      expect(schedulePatch).toHaveBeenCalled();
    });
    expect(schedulePatch).toHaveBeenLastCalledWith(
      { gateway: { url: "wss://remote.example", token: "manual-token" } },
      400
    );
  });
});
