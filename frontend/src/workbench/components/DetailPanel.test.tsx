import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DetailPanel } from "./DetailPanel";

describe("DetailPanel", () => {
  it("shows round candidates and paper actions", () => {
    const onOpenPdf = vi.fn();

    const { rerender } = render(
      <DetailPanel
        mode="gpt_step"
        node={{
          id: "round:12",
          position: { x: 0, y: 0 },
          data: { id: "round:12", type: "round", label: "Round 12", depth: 2, status: "done" },
          type: "cardNode",
        } as never}
        paperDetail={null}
        paperAssets={null}
        roundCandidates={[{ candidate_id: 3, candidate_index: 1, name: "Candidate A", queries: ["graph retrieval"], reason: "Focus on citations." }]}
        onUpdateNote={vi.fn()}
        onToggleHidden={vi.fn()}
        onDeleteNode={vi.fn()}
        onOpenPdf={onOpenPdf}
        onSavePaper={vi.fn()}
        onSummarizePaper={vi.fn()}
        onRebuildVisual={vi.fn()}
        onSearchDirection={vi.fn()}
        onStartExplore={vi.fn()}
        onBuildGraph={vi.fn()}
        onProposeCandidates={vi.fn()}
        onSelectCandidate={vi.fn()}
        onNextRound={vi.fn()}
        onAskPreset={vi.fn()}
      />,
    );

    expect(screen.getByText("节点信息")).toBeInTheDocument();
    expect(screen.getByText("Candidate A")).toBeInTheDocument();

    rerender(
      <DetailPanel
        mode="gpt_step"
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
          doi: null,
          url: "https://example.com",
          abstract: "paper abstract",
          method_summary: "",
          card_summary: "Problem: grounded control\nMethod: demo model\nResult: stable gains",
          summary_source: "fulltext",
          summary_status: "done",
          source: "semantic_scholar",
          fulltext_status: "parsed",
          saved: false,
          key_points_status: "done",
          key_points: "1. Research problem: ...\n2. Core method: ...",
        }}
        paperAssets={{
          task_id: "R-1",
          paper_id: "paper:demo",
          primary_kind: "pdf",
          items: [{ kind: "pdf", status: "available", open_url: "/pdf-inline", download_url: "/pdf" }],
        }}
        roundCandidates={[]}
        onUpdateNote={vi.fn()}
        onToggleHidden={vi.fn()}
        onDeleteNode={vi.fn()}
        onOpenPdf={onOpenPdf}
        onSavePaper={vi.fn()}
        onSummarizePaper={vi.fn()}
        onRebuildVisual={vi.fn()}
        onSearchDirection={vi.fn()}
        onStartExplore={vi.fn()}
        onBuildGraph={vi.fn()}
        onProposeCandidates={vi.fn()}
        onSelectCandidate={vi.fn()}
        onNextRound={vi.fn()}
        onAskPreset={vi.fn()}
      />,
    );

    expect(screen.getByText("打开 PDF")).toBeInTheDocument();
    fireEvent.click(screen.getByText("打开 PDF"));
    expect(onOpenPdf).toHaveBeenCalled();
    expect(screen.getAllByText("Paper Visual").length).toBeGreaterThan(0);
    expect(screen.getByText("Why It Matters")).toBeInTheDocument();
  });
});
