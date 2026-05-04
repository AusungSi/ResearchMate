import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ContextChatPanel } from "./ContextChatPanel";

beforeAll(() => {
  Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

const baseProps = {
  disabled: false,
  taskTitle: "Embodied AI",
  threads: [
    {
      thread_id: "t-1",
      task_id: "R-1",
      title: "OpenClaw demo",
      message_count: 2,
      latest_preview: "latest preview",
      created_at: "2026-05-04T00:00:00Z",
      updated_at: "2026-05-04T00:00:00Z",
    },
  ],
  activeThreadId: "t-1",
  messages: [
    {
      id: 1,
      task_id: "R-1",
      thread_id: "t-1",
      role: "assistant" as const,
      content: "Current answer",
      context_node_ids: [],
      attachment_ids: [],
      provider: "gpt_api",
      model: "gpt-5.4",
      status: "done",
      created_at: "2026-05-04T00:00:00Z",
      updated_at: "2026-05-04T00:00:00Z",
    },
  ],
  nodeOptions: [
    { id: "paper:1", label: "Paper 1", type: "paper" },
    { id: "direction:1", label: "Direction 1", type: "direction" },
  ],
  contextNodeIds: [],
  attachments: [],
  uploadingNames: [],
  draft: "draft message",
  busy: false,
  streaming: false,
  error: null,
  onDraftChange: vi.fn(),
  onSelectThread: vi.fn(),
  onNewThread: vi.fn(),
  onSend: vi.fn(),
  onUploadFiles: vi.fn(),
  onRemoveAttachment: vi.fn(),
  onAddContextNode: vi.fn(),
  onRemoveContextNode: vi.fn(),
  onUseSuggestion: vi.fn(),
  onSaveAnswer: vi.fn(),
};

describe("ContextChatPanel", () => {
  it("shows history popover, menu actions, and node picker", () => {
    render(<ContextChatPanel {...baseProps} />);

    fireEvent.click(screen.getByTitle("历史对话"));
    const historyPanel = screen.getByPlaceholderText("搜索历史对话").closest("div")?.parentElement;
    expect(screen.getByPlaceholderText("搜索历史对话")).toBeInTheDocument();
    expect(historyPanel).not.toBeNull();
    expect(historyPanel).toHaveTextContent("OpenClaw demo");

    fireEvent.click(screen.getByTitle("更多操作"));
    expect(screen.getByText("上传文件")).toBeInTheDocument();
    expect(screen.getByText("管理上下文节点")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("关联节点上下文"));
    expect(screen.getByPlaceholderText("搜索节点并加入上下文")).toBeInTheDocument();
    expect(screen.getByText("Paper 1")).toBeInTheDocument();
  });

  it("renders single assistant bubble streaming state", () => {
    render(
      <ContextChatPanel
        {...baseProps}
        messages={[
          {
            id: 2,
            task_id: "R-1",
            thread_id: "t-1",
            role: "assistant",
            content: "",
            context_node_ids: [],
            attachment_ids: [],
            provider: null,
            model: null,
            status: "streaming",
            created_at: "2026-05-04T00:00:00Z",
            updated_at: "2026-05-04T00:00:00Z",
          },
        ]}
      />,
    );

    expect(screen.getByText("thinking")).toBeInTheDocument();
    expect(screen.queryByText("Current answer")).not.toBeInTheDocument();
  });
});
