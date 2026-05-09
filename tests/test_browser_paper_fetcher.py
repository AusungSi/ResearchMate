from pathlib import Path

from app.services.browser_paper_fetcher import (
    BrowserPaperCandidate,
    dedupe_browser_papers,
    parse_arxiv_search_html,
    parse_openalex_search_html,
    parse_semantic_scholar_search_html,
    resolve_browser_paper_sources,
)


FIXTURE_DIR = Path(__file__).parent / "fixtures" / "browser_paper_fetcher"


def _read_fixture(name: str) -> str:
    return (FIXTURE_DIR / name).read_text(encoding="utf-8")


def test_parse_arxiv_search_html_extracts_core_fields():
    items = parse_arxiv_search_html(_read_fixture("arxiv_search.html"))

    assert len(items) == 1
    item = items[0]
    assert item.source == "arxiv"
    assert item.title == "Diffusion Models for Robotic Manipulation"
    assert item.authors == ["Alice Chen", "Bob Li"]
    assert item.year == 2025
    assert item.url == "https://arxiv.org/abs/2501.00001"
    assert item.pdf_url == "https://arxiv.org/pdf/2501.00001.pdf"
    assert item.doi == "10.1000/robotics.2025.1"


def test_parse_semantic_scholar_search_html_extracts_core_fields():
    items = parse_semantic_scholar_search_html(_read_fixture("semantic_scholar_search.html"))

    assert len(items) == 1
    item = items[0]
    assert item.source == "semantic_scholar"
    assert item.title == "A Better Diffusion Policy for Manipulation"
    assert item.authors == ["Alice Chen", "Bob Li"]
    assert item.year == 2025
    assert item.venue == "NeurIPS 2025"
    assert item.url == "https://www.semanticscholar.org/paper/abc123"
    assert item.pdf_url == "https://example.org/paper.pdf"


def test_parse_openalex_search_html_extracts_core_fields():
    items = parse_openalex_search_html(_read_fixture("openalex_search.html"))

    assert len(items) == 1
    item = items[0]
    assert item.source == "openalex"
    assert item.title == "Diffusion for Embodied Manipulation"
    assert item.authors == ["Carol Wang", "David Xu"]
    assert item.year == 2024
    assert item.venue == "ICRA"
    assert item.url == "https://openalex.org/W1234567890"
    assert item.pdf_url == "https://openalex.org/files/paper.pdf"


def test_dedupe_browser_papers_prefers_first_seen_candidate():
    items = dedupe_browser_papers(
        [
            BrowserPaperCandidate(
                source="semantic_scholar",
                title="Diffusion Models for Robotic Manipulation",
                authors=["Alice Chen"],
                year=2025,
                url="https://example.org/paper-a",
                doi="10.1000/robotics.2025.1",
            ),
            BrowserPaperCandidate(
                source="arxiv",
                title="Diffusion Models for Robotic Manipulation",
                authors=["Alice Chen", "Bob Li"],
                year=2025,
                url="https://arxiv.org/abs/2501.00001",
                doi="10.1000/robotics.2025.1",
            ),
            BrowserPaperCandidate(
                source="openalex",
                title="Another Paper",
                authors=["Carol Wang"],
                year=2024,
                url="https://openalex.org/W123",
            ),
        ]
    )

    assert [item.source for item in items] == ["semantic_scholar", "openalex"]


def test_resolve_browser_paper_sources_rejects_unknown_source():
    try:
        resolve_browser_paper_sources(["arxiv", "unknown"])
    except ValueError as exc:
        assert "unsupported source" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("expected ValueError for unsupported source")
