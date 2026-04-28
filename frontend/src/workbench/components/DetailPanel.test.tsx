import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DetailPanel } from "./DetailPanel";

const baseProps = {
  mode: "gpt_step" as const,
  paperDetail: null,
  paperAssets: null,
  roundCandidates: [],
  onUpdateNote: vi.fn(),
  onToggleHidden: vi.fn(),
  onDeleteNode: vi.fn(),
  onOpenPdf: vi.fn(),
  onDownloadPdf: vi.fn(),
  onOpenAsset: vi.fn(),
  onDownloadAsset: vi.fn(),
  onPreviewTextAsset: vi.fn(),
  onSavePaper: vi.fn(),
  onSummarizePaper: vi.fn(),
  onRebuildVisual: vi.fn(),
  onSearchDirection: vi.fn(),
  onStartExplore: vi.fn(),
  onBuildGraph: vi.fn(),
  onProposeCandidates: vi.fn(),
  onSelectCandidate: vi.fn(),
  onNextRound: vi.fn(),
  onAskPreset: vi.fn(),
};

describe("DetailPanel", () => {
  it("shows round candidates as read-only info", () => {
    const onAskPreset = vi.fn();

    render(
      <DetailPanel
        {...baseProps}
        node={{
          id: "round:12",
          position: { x: 0, y: 0 },
          data: { id: "round:12", type: "round", label: "Round 12", depth: 2, status: "done" },
          type: "cardNode",
        } as never}
        roundCandidates={[{ candidate_id: 3, candidate_index: 1, name: "Candidate A", queries: ["graph retrieval"], reason: "Focus on citations." }]}
        onAskPreset={onAskPreset}
      />,
    );

    expect(screen.getByText("节点信息")).toBeInTheDocument();
    expect(screen.getByText("Candidate A")).toBeInTheDocument();
    fireEvent.click(screen.getByText("去聊天里提问"));
    expect(onAskPreset).toHaveBeenCalled();
  });

  it("keeps paper details compact and previews text assets in the center sheet", () => {
    const onPreviewTextAsset = vi.fn();

    render(
      <DetailPanel
        {...baseProps}
        node={{
          id: "paper:demo",
          position: { x: 0, y: 0 },
          data: { id: "paper:demo", type: "paper", label: "Demo paper", abstract: "paper abstract" },
          type: "cardNode",
        } as never}
        paperDetail={{
          task_id: "R-1",
          paper_id: "paper:demo",
          title: "Demo paper",
          authors: ["Alice"],
          year: 2025,
          venue: "ACL",
          doi: "10.000/demo",
          url: "https://example.com",
          abstract: "paper abstract",
          method_summary: "",
          card_summary: "问题：rounded control\n方法：demo model\n结果：stable gains",
          summary_source: "fulltext",
          summary_status: "done",
          source: "semantic_scholar",
          fulltext_status: "parsed",
          saved: false,
          key_points_status: "done",
          key_points: "1. Research problem: compact display\n2. Core method: center preview",
          preview_kind: "overall",
          preview_url: "/overall.png",
          visual_status: "available",
          venue_metrics: { source_type: "journal", ccf: { rank: "A" }, paper_citation_count: 12 },
        }}
        paperAssets={{
          task_id: "R-1",
          paper_id: "paper:demo",
          primary_kind: "overall",
          items: [
            { kind: "overall", status: "available", open_url: "/overall.png" },
            { kind: "pdf", status: "available", open_url: "/pdf-inline", download_url: "/pdf", filename: "demo.pdf" },
            { kind: "txt", status: "available", open_url: "/txt", filename: "demo.txt" },
          ],
        }}
        onPreviewTextAsset={onPreviewTextAsset}
      />,
    );

    expect(screen.getByText("Card Summary")).toBeInTheDocument();
    expect(screen.getByText(/Research problem/)).toBeInTheDocument();
    expect(screen.getByText("文本与引用")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "TXT" }));
    expect(onPreviewTextAsset).toHaveBeenCalledWith(expect.objectContaining({ kind: "txt", open_url: "/txt" }));

    expect(screen.queryByText("Paper Visual")).not.toBeInTheDocument();
    expect(screen.queryByText("完整结构化摘要")).not.toBeInTheDocument();
    expect(screen.queryByText("PDF 快捷入口")).not.toBeInTheDocument();
    expect(screen.queryByText("打开论文原始链接")).not.toBeInTheDocument();
    expect(screen.queryByText("打开 PDF")).not.toBeInTheDocument();
    expect(screen.queryByText(/OpenClaw Auto 模式/)).not.toBeInTheDocument();
  });
});
