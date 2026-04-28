from __future__ import annotations

from pathlib import Path

from app.core.config import get_settings
from app.services.venue_metrics_service import VenueMetricsService


def test_venue_metrics_service_merges_local_catalog_and_openalex(tmp_path):
    rankings_dir = tmp_path / "rankings"
    rankings_dir.mkdir(parents=True, exist_ok=True)
    (rankings_dir / "venue_catalog.csv").write_text(
        "venue,aliases,source_type,ccf_rank,ccf_category,sci_indexed,ei_indexed,jcr_quartile,jcr_year,cas_quartile,cas_top,impact_factor,impact_factor_year\n"
        "Annual Meeting of the Association for Computational Linguistics,ACL,conference,A,NLP,false,true,,,,,,\n"
        "Science Robotics,,journal,,,true,false,Q1,2024,1区,Top,25.0,2024\n",
        encoding="utf-8",
    )
    settings = get_settings()
    original_rankings_dir = settings.research_venue_rankings_dir
    original_cache_dir = settings.research_venue_metrics_cache_dir
    try:
        settings.research_venue_rankings_dir = str(rankings_dir)
        settings.research_venue_metrics_cache_dir = str(tmp_path / "cache")
        service = VenueMetricsService(settings=settings)
        service._lookup_openalex_work = lambda **_: {  # type: ignore[method-assign]
            "paper_citation_count": 52,
            "source_display_name": "Annual Meeting of the Association for Computational Linguistics",
            "source": {
                "id": "https://openalex.org/S1",
                "display_name": "Annual Meeting of the Association for Computational Linguistics",
                "type": "conference",
                "issn_l": None,
                "issn": [],
                "works_count": 2400,
                "cited_by_count": 88000,
                "h_index": 220,
                "i10_index": 1300,
                "homepage_url": "https://aclweb.org",
                "host_organization_name": "ACL",
            },
        }
        service._search_openalex_source = lambda _venue: {}  # type: ignore[method-assign]

        metrics = service.lookup_for_paper(
            venue="ACL",
            doi="10.1000/demo",
            title="Demo paper",
            year=2025,
        )
        assert metrics["source_type"] == "conference"
        assert metrics["ccf"]["rank"] == "A"
        assert metrics["ccf"]["category"] == "NLP"
        assert metrics["ei"]["indexed"] is True
        assert metrics["venue_citation_count"] == 88000
        assert metrics["paper_citation_count"] == 52
        assert metrics["matched_venue"] == "Annual Meeting of the Association for Computational Linguistics"
        assert Path(settings.research_venue_metrics_cache_dir, f"{metrics['venue_key']}.json").exists()
    finally:
        settings.research_venue_rankings_dir = original_rankings_dir
        settings.research_venue_metrics_cache_dir = original_cache_dir
