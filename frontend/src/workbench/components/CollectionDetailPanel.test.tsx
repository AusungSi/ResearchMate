import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CollectionDetailPanel } from "./CollectionDetailPanel";

const props = {
  collection: null,
  exportHistory: [],
  searchText: "",
  selectedItemIds: [],
  onSearchTextChange: vi.fn(),
  onToggleItem: vi.fn(),
  onToggleAllVisible: vi.fn(),
  onSummarize: vi.fn(),
  onCreateStudy: vi.fn(),
  onBuildGraph: vi.fn(),
  onCompare: vi.fn(),
  onRemoveSelected: vi.fn(),
  onExportBib: vi.fn(),
  onExportCslJson: vi.fn(),
  onLoadMore: vi.fn(),
};

describe("CollectionDetailPanel", () => {
  it("does not render an empty card when no collection is selected", () => {
    render(<CollectionDetailPanel {...props} />);

    expect(screen.queryByText("Collection")).not.toBeInTheDocument();
    expect(screen.queryByText(/还没有摘要/)).not.toBeInTheDocument();
  });
});
