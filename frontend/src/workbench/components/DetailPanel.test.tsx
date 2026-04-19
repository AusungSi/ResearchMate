import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DetailPanel } from "./DetailPanel";

describe("DetailPanel", () => {
  it("shows round candidate actions and paper actions", () => {
    const onSelectCandidate = vi.fn();

    const { rerender } = render(
      <DetailPanel
        mode="gpt_step"
        node={{
          id: "round:12",
          position: { x: 0, y: 0 },
          data: { id: "round:12", type: "round", label: "第 2 轮", depth: 2, status: "done" },
          type: "cardNode",
        } as never}
        paperDetail={null}
        paperAssets={null}
        roundCandidates={[{ candidate_id: 3, candidate_index: 1, name: "Candidate A", queries: ["graph retrieval"], reason: "更聚焦引文网络" }]}
        onUpdateNote={vi.fn()}
        onToggleHidden={vi.fn()}
        onOpenPdf={vi.fn()}
        onSavePaper={vi.fn()}
        onSummarizePaper={vi.fn()}
        onSearchDirection={vi.fn()}
        onStartExplore={vi.fn()}
        onBuildGraph={vi.fn()}
        onProposeCandidates={vi.fn()}
        onSelectCandidate={onSelectCandidate}
        onNextRound={vi.fn()}
        onAskPreset={vi.fn()}
      />,
    );

    expect(screen.getByText("Round Actions")).toBeInTheDocument();
    fireEvent.click(screen.getByText("选择这个候选"));
    expect(onSelectCandidate).toHaveBeenCalledWith(12, 3);

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
          source: "semantic_scholar",
          fulltext_status: "parsed",
          saved: false,
          key_points_status: "none",
        }}
        paperAssets={{
          task_id: "R-1",
          paper_id: "paper:demo",
          primary_kind: "pdf",
          items: [{ kind: "pdf", status: "available", download_url: "/pdf" }],
        }}
        roundCandidates={[]}
        onUpdateNote={vi.fn()}
        onToggleHidden={vi.fn()}
        onOpenPdf={vi.fn()}
        onSavePaper={vi.fn()}
        onSummarizePaper={vi.fn()}
        onSearchDirection={vi.fn()}
        onStartExplore={vi.fn()}
        onBuildGraph={vi.fn()}
        onProposeCandidates={vi.fn()}
        onSelectCandidate={vi.fn()}
        onNextRound={vi.fn()}
        onAskPreset={vi.fn()}
      />,
    );

    expect(screen.getByText("Paper Actions")).toBeInTheDocument();
    expect(screen.getByText("Open PDF")).toBeInTheDocument();
  });
});
