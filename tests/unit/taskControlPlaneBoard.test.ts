import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskBoard } from "@/features/task-control-plane/components/TaskBoard";
import type { TaskControlPlaneSnapshot } from "@/lib/task-control-plane/read-model";

const snapshot: TaskControlPlaneSnapshot = {
  generatedAt: "2026-02-05T00:00:00.000Z",
  scopePath: "/tmp/.beads",
  columns: {
    ready: [
      {
        id: "bd-1",
        title: "Ready task",
        description: "Preview line\n\nDetails here.",
        column: "ready",
        status: "open",
        priority: 2,
        updatedAt: "2026-02-05T00:00:00.000Z",
        assignee: null,
        labels: ["decision-needed"],
        decisionNeeded: true,
        blockedBy: [],
      },
    ],
    inProgress: [],
    blocked: [],
    done: [],
  },
  warnings: [],
};

describe("TaskBoard", () => {
  beforeEach(() => {
    const mockedFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url.includes("/api/task-control-plane/show")) {
        return new Response(
          JSON.stringify({
            bead: {
              id: "bd-1",
              title: "Ready task",
              description: "Preview line\n\nDetails here.",
              status: "open",
              priority: 2,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.includes("/api/task-control-plane/priority")) {
        if (init?.method !== "POST") {
          return new Response(JSON.stringify({ error: "Expected POST" }), { status: 400 });
        }
        return new Response(JSON.stringify({ bead: { id: "bd-1", priority: 1 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: `Unexpected fetch: ${url}` }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });

    vi.stubGlobal(
      "fetch",
      mockedFetch
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders columns and decision badge", () => {
    render(createElement(TaskBoard, { snapshot }));

    expect(screen.getByTestId("task-control-column-ready")).toBeInTheDocument();
    expect(screen.getByTestId("task-control-column-in-progress")).toBeInTheDocument();
    expect(screen.getByTestId("task-control-column-blocked")).toBeInTheDocument();
    expect(screen.getByTestId("task-control-column-done")).toBeInTheDocument();
    expect(screen.getByText("Decision Needed")).toBeInTheDocument();
  });

  it("toggles description previews on cards", () => {
    render(createElement(TaskBoard, { snapshot }));

    expect(screen.queryByText("Preview line")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("task-control-description-toggle"));
    expect(screen.getByText("Preview line")).toBeInTheDocument();
  });

  it("opens a description modal when description is present", () => {
    render(createElement(TaskBoard, { snapshot }));

    const button = screen.getByTestId("task-control-card-description-bd-1");
    fireEvent.click(button);

    expect(screen.getByTestId("task-control-description-modal")).toBeInTheDocument();
    expect(screen.getByText("Details here.")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("task-control-description-modal-close"));
    expect(screen.queryByTestId("task-control-description-modal")).not.toBeInTheDocument();
  });

  it("updates priority through a dropdown", async () => {
    const onRequestRefresh = vi.fn(async () => {});
    render(createElement(TaskBoard, { snapshot, onRequestRefresh }));

    fireEvent.click(screen.getByTestId("task-control-card-priority-bd-1"));
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("Backlog")).toBeInTheDocument();

    fireEvent.click(screen.getByText("High"));

    await waitFor(() => {
      expect(onRequestRefresh).toHaveBeenCalled();
    });
  });

  it("renders Unknown update time when updatedAt is null", () => {
    const snapshotWithUnknownUpdate: TaskControlPlaneSnapshot = {
      ...snapshot,
      columns: {
        ...snapshot.columns,
        ready: [
          {
            ...snapshot.columns.ready[0],
            updatedAt: null,
            decisionNeeded: false,
            labels: [],
          },
        ],
      },
    };

    render(createElement(TaskBoard, { snapshot: snapshotWithUnknownUpdate }));

    expect(screen.getByText("Updated: Unknown update time")).toBeInTheDocument();
  });
});
