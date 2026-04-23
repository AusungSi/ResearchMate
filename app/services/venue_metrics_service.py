from __future__ import annotations

from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from pathlib import Path
import csv
import re

import httpx
import orjson

from app.core.config import Settings
from app.core.logging import get_logger


logger = get_logger("venue_metrics")


class VenueMetricsService:
    def __init__(self, *, settings: Settings) -> None:
        self.settings = settings
        self._catalog_stamp: tuple[tuple[str, int], ...] | None = None
        self._catalog_index: dict[str, dict] = {}

    def lookup_for_paper(
        self,
        *,
        venue: str | None,
        doi: str | None = None,
        title: str | None = None,
        year: int | None = None,
    ) -> dict:
        venue_text = str(venue or "").strip()
        if not self.settings.research_venue_metrics_enabled or not venue_text:
            return {}

        local_entry = self._lookup_local_catalog(venue_text)
        if local_entry:
            venue_key = _normalize_venue_key(venue_text)
            cached = self._read_cache(venue_key)
            if cached:
                return dict(cached)
            metrics = self._build_metrics(
                venue=venue_text,
                resolved_venue=venue_text,
                venue_key=venue_key,
                local_entry=local_entry,
                source_meta={},
            )
            self._write_cache(venue_key, metrics)
            return metrics

        work_meta = self._lookup_openalex_work(doi=doi, title=title, year=year)
        resolved_venue = str(
            work_meta.get("source_display_name")
            or work_meta.get("source", {}).get("display_name")
            or venue_text
        ).strip() or venue_text
        venue_key = _normalize_venue_key(resolved_venue)
        cached = self._read_cache(venue_key)
        if cached:
            metrics = dict(cached)
        else:
            local_entry = self._lookup_local_catalog(resolved_venue) or self._lookup_local_catalog(venue_text)
            work_source = dict(work_meta.get("source") or {})
            source_meta = work_source
            if not self._has_rich_source_metrics(source_meta):
                searched_source = self._search_openalex_source(resolved_venue) or self._search_openalex_source(venue_text)
                source_meta = {
                    **searched_source,
                    **{k: v for k, v in work_source.items() if v not in (None, "", [], {})},
                }
            metrics = self._build_metrics(
                venue=venue_text,
                resolved_venue=resolved_venue,
                venue_key=venue_key,
                local_entry=local_entry,
                source_meta=source_meta,
            )
            self._write_cache(venue_key, metrics)

        paper_citation_count = work_meta.get("paper_citation_count")
        if isinstance(paper_citation_count, int):
            metrics = {**metrics, "paper_citation_count": paper_citation_count}
            data_sources = list(metrics.get("data_sources") or [])
            if "openalex_work" not in data_sources:
                metrics["data_sources"] = [*data_sources, "openalex_work"]
        return metrics

    def _cache_dir(self) -> Path:
        path = Path(self.settings.research_venue_metrics_cache_dir).expanduser().resolve()
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _cache_path(self, venue_key: str) -> Path:
        return self._cache_dir() / f"{venue_key}.json"

    def _read_cache(self, venue_key: str) -> dict | None:
        path = self._cache_path(venue_key)
        if not path.exists():
            return None
        try:
            payload = orjson.loads(path.read_bytes())
        except Exception:
            logger.warning("venue_metrics_cache_read_failed path=%s", path)
            return None
        fetched_at = _parse_iso_datetime(payload.get("fetched_at"))
        ttl_seconds = max(60, int(self.settings.research_venue_metrics_cache_ttl_seconds))
        if not fetched_at or datetime.now(timezone.utc) - fetched_at > timedelta(seconds=ttl_seconds):
            return None
        metrics = payload.get("metrics")
        return dict(metrics) if isinstance(metrics, dict) else None

    def _write_cache(self, venue_key: str, metrics: dict) -> None:
        path = self._cache_path(venue_key)
        tmp_path = path.with_suffix(".tmp")
        payload = {
            "venue_key": venue_key,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "metrics": metrics,
        }
        try:
            tmp_path.write_bytes(orjson.dumps(payload))
            tmp_path.replace(path)
        except Exception:
            logger.warning("venue_metrics_cache_write_failed path=%s", path)

    def _catalog_files(self) -> list[Path]:
        base = Path(self.settings.research_venue_rankings_dir).expanduser().resolve()
        return [base / "venue_catalog.csv", base / "venue_catalog.json"]

    def _load_local_catalog(self) -> dict[str, dict]:
        files = [path for path in self._catalog_files() if path.exists()]
        stamp = tuple(sorted((str(path), path.stat().st_mtime_ns) for path in files))
        if self._catalog_stamp == stamp:
            return self._catalog_index

        alias_index: dict[str, dict] = {}
        for path in files:
            if path.suffix.lower() == ".csv":
                entries = self._load_catalog_csv(path)
            elif path.suffix.lower() == ".json":
                entries = self._load_catalog_json(path)
            else:
                entries = []
            for entry in entries:
                aliases = [entry.get("venue")] + _split_aliases(entry.get("aliases"))
                for alias in aliases:
                    alias_key = _normalize_venue_key(alias)
                    if alias_key:
                        alias_index[alias_key] = entry
        self._catalog_stamp = stamp
        self._catalog_index = alias_index
        return alias_index

    def _load_catalog_csv(self, path: Path) -> list[dict]:
        rows: list[dict] = []
        try:
            with path.open("r", encoding="utf-8-sig", newline="") as handle:
                reader = csv.DictReader(handle)
                for row in reader:
                    rows.append(
                        {
                            "venue": str(row.get("venue") or "").strip(),
                            "aliases": str(row.get("aliases") or "").strip(),
                            "source_type": str(row.get("source_type") or "").strip() or None,
                            "ccf_rank": str(row.get("ccf_rank") or "").strip() or None,
                            "ccf_category": str(row.get("ccf_category") or "").strip() or None,
                            "sci_indexed": _parse_bool(row.get("sci_indexed")),
                            "ei_indexed": _parse_bool(row.get("ei_indexed")),
                            "jcr_quartile": str(row.get("jcr_quartile") or "").strip() or None,
                            "jcr_year": _parse_int(row.get("jcr_year")),
                            "cas_quartile": str(row.get("cas_quartile") or "").strip() or None,
                            "cas_top": str(row.get("cas_top") or "").strip() or None,
                            "impact_factor": _parse_float(row.get("impact_factor")),
                            "impact_factor_year": _parse_int(row.get("impact_factor_year")),
                            "source": f"local_catalog:{path.name}",
                        }
                    )
        except Exception:
            logger.exception("venue_metrics_catalog_csv_failed path=%s", path)
        return [row for row in rows if row.get("venue")]

    def _load_catalog_json(self, path: Path) -> list[dict]:
        try:
            payload = orjson.loads(path.read_bytes())
        except Exception:
            logger.exception("venue_metrics_catalog_json_failed path=%s", path)
            return []
        if not isinstance(payload, list):
            return []
        rows: list[dict] = []
        for raw in payload:
            if not isinstance(raw, dict):
                continue
            entry = dict(raw)
            entry["venue"] = str(entry.get("venue") or "").strip()
            entry["source"] = str(entry.get("source") or f"local_catalog:{path.name}")
            if entry["venue"]:
                rows.append(entry)
        return rows

    def _lookup_local_catalog(self, venue: str) -> dict | None:
        return self._load_local_catalog().get(_normalize_venue_key(venue))

    def _openalex_client(self) -> httpx.Client:
        return httpx.Client(
            timeout=8.0,
            follow_redirects=True,
            headers={"User-Agent": "MemoMate/0.1 (venue-metrics)"},
        )

    def _has_rich_source_metrics(self, source_meta: dict | None) -> bool:
        if not isinstance(source_meta, dict):
            return False
        return any(
            source_meta.get(key) is not None
            for key in ("cited_by_count", "works_count", "h_index", "i10_index")
        )

    def _lookup_openalex_work(self, *, doi: str | None, title: str | None, year: int | None) -> dict:
        if not self.settings.research_venue_openalex_enabled:
            return {}

        if doi:
            try:
                with self._openalex_client() as client:
                    resp = client.get(
                        "https://api.openalex.org/works",
                        params={"filter": f"doi:https://doi.org/{str(doi).strip().lower()}", "per-page": "1"},
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    results = data.get("results") if isinstance(data, dict) else []
                    if isinstance(results, list) and results:
                        item = self._extract_openalex_work(results[0])
                        if item:
                            return item
            except Exception:
                logger.warning("venue_metrics_openalex_work_by_doi_failed doi=%s", doi)

        title_text = str(title or "").strip()
        if not title_text:
            return {}
        try:
            with self._openalex_client() as client:
                resp = client.get(
                    "https://api.openalex.org/works",
                    params={"search": title_text[:220], "per-page": "5"},
                )
                resp.raise_for_status()
                data = resp.json()
        except Exception:
            logger.warning("venue_metrics_openalex_work_by_title_failed title=%s", title_text[:120])
            return {}

        results = data.get("results") if isinstance(data, dict) else []
        if not isinstance(results, list):
            return {}
        best_score = 0.0
        best_item: dict | None = None
        title_key = _normalize_venue_key(title_text)
        for raw in results[:5]:
            item = self._extract_openalex_work(raw)
            candidate_title = _normalize_venue_key(str(raw.get("display_name") or ""))
            if not item or not candidate_title:
                continue
            score = SequenceMatcher(None, title_key, candidate_title).ratio()
            candidate_year = _parse_int(raw.get("publication_year"))
            if year and candidate_year and year == candidate_year:
                score += 0.08
            if score > best_score:
                best_score = score
                best_item = item
        return best_item or {}

    def _extract_openalex_work(self, raw: object) -> dict:
        if not isinstance(raw, dict):
            return {}
        source = None
        primary_location = raw.get("primary_location")
        if isinstance(primary_location, dict):
            source = primary_location.get("source")
        if not source:
            for location in raw.get("locations") or []:
                if isinstance(location, dict) and isinstance(location.get("source"), dict):
                    source = location["source"]
                    break
        if not isinstance(source, dict):
            source = {}
        return {
            "paper_citation_count": _parse_int(raw.get("cited_by_count")),
            "source_display_name": str(source.get("display_name") or "").strip() or None,
            "source": self._extract_openalex_source(source),
        }

    def _search_openalex_source(self, venue: str) -> dict:
        if not self.settings.research_venue_openalex_enabled or not str(venue or "").strip():
            return {}
        try:
            with self._openalex_client() as client:
                resp = client.get(
                    "https://api.openalex.org/sources",
                    params={"search": str(venue).strip()[:180], "per-page": "5"},
                )
                resp.raise_for_status()
                data = resp.json()
        except Exception:
            logger.warning("venue_metrics_openalex_source_failed venue=%s", venue[:120] if venue else "")
            return {}

        results = data.get("results") if isinstance(data, dict) else []
        if not isinstance(results, list):
            return {}
        venue_key = _normalize_venue_key(venue)
        best_score = 0.0
        best_source: dict | None = None
        for raw in results[:5]:
            if not isinstance(raw, dict):
                continue
            display_name = str(raw.get("display_name") or "").strip()
            if not display_name:
                continue
            candidate_key = _normalize_venue_key(display_name)
            score = SequenceMatcher(None, venue_key, candidate_key).ratio()
            if score > best_score:
                best_score = score
                best_source = self._extract_openalex_source(raw)
        return best_source or {}

    def _extract_openalex_source(self, raw: object) -> dict:
        if not isinstance(raw, dict):
            return {}
        summary_stats = raw.get("summary_stats") if isinstance(raw.get("summary_stats"), dict) else {}
        return {
            "id": str(raw.get("id") or "").strip() or None,
            "display_name": str(raw.get("display_name") or "").strip() or None,
            "type": str(raw.get("type") or "").strip() or None,
            "issn_l": str(raw.get("issn_l") or "").strip() or None,
            "issn": list(raw.get("issn") or []) if isinstance(raw.get("issn"), list) else [],
            "works_count": _parse_int(raw.get("works_count")),
            "cited_by_count": _parse_int(raw.get("cited_by_count")),
            "h_index": _parse_int(summary_stats.get("h_index")),
            "i10_index": _parse_int(summary_stats.get("i10_index")),
            "homepage_url": str(raw.get("homepage_url") or "").strip() or None,
            "host_organization_name": str(raw.get("host_organization_name") or "").strip() or None,
            "is_in_doaj": raw.get("is_in_doaj") if isinstance(raw.get("is_in_doaj"), bool) else None,
        }

    def _build_metrics(
        self,
        *,
        venue: str,
        resolved_venue: str,
        venue_key: str,
        local_entry: dict | None,
        source_meta: dict | None,
    ) -> dict:
        local_entry = dict(local_entry or {})
        source_meta = dict(source_meta or {})
        source_type = (
            str(local_entry.get("source_type") or "").strip()
            or str(source_meta.get("type") or "").strip()
            or _infer_source_type(venue)
        ) or None
        data_sources: list[str] = []
        if local_entry:
            data_sources.append(str(local_entry.get("source") or "local_catalog"))
        if source_meta:
            data_sources.append("openalex_source")
        metrics = {
            "venue": venue,
            "venue_key": venue_key,
            "matched_venue": str(source_meta.get("display_name") or local_entry.get("venue") or resolved_venue or venue).strip() or venue,
            "source_type": source_type,
            "ccf": {
                "rank": local_entry.get("ccf_rank"),
                "category": local_entry.get("ccf_category"),
                "source": local_entry.get("source") if local_entry.get("ccf_rank") else None,
            },
            "jcr": {
                "quartile": local_entry.get("jcr_quartile"),
                "year": local_entry.get("jcr_year"),
                "source": local_entry.get("source") if local_entry.get("jcr_quartile") else None,
            },
            "cas": {
                "quartile": local_entry.get("cas_quartile"),
                "top": local_entry.get("cas_top"),
                "source": local_entry.get("source") if local_entry.get("cas_quartile") else None,
            },
            "ei": {
                "indexed": local_entry.get("ei_indexed"),
                "source": local_entry.get("source") if local_entry.get("ei_indexed") is not None else None,
            },
            "sci": {
                "indexed": local_entry.get("sci_indexed"),
                "source": local_entry.get("source") if local_entry.get("sci_indexed") is not None else None,
            },
            "impact_factor": {
                "value": local_entry.get("impact_factor"),
                "year": local_entry.get("impact_factor_year"),
                "source": local_entry.get("source") if local_entry.get("impact_factor") is not None else None,
            },
            "venue_citation_count": source_meta.get("cited_by_count"),
            "venue_works_count": source_meta.get("works_count"),
            "h_index": source_meta.get("h_index"),
            "i10_index": source_meta.get("i10_index"),
            "issn_l": source_meta.get("issn_l"),
            "issn": source_meta.get("issn") or [],
            "openalex_id": source_meta.get("id"),
            "homepage_url": source_meta.get("homepage_url"),
            "host_organization_name": source_meta.get("host_organization_name"),
            "data_sources": data_sources,
        }
        return metrics


def _normalize_venue_key(value: object) -> str:
    text = str(value or "").strip().lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _split_aliases(value: object) -> list[str]:
    text = str(value or "").strip()
    if not text:
        return []
    return [part.strip() for part in text.split("|") if part.strip()]


def _parse_bool(value: object) -> bool | None:
    text = str(value or "").strip().lower()
    if text in {"1", "true", "yes", "y"}:
        return True
    if text in {"0", "false", "no", "n"}:
        return False
    return None


def _parse_int(value: object) -> int | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return int(float(text))
    except Exception:
        return None


def _parse_float(value: object) -> float | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return float(text)
    except Exception:
        return None


def _parse_iso_datetime(value: object) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except Exception:
        return None


def _infer_source_type(venue: str) -> str | None:
    text = str(venue or "").strip().lower()
    if not text:
        return None
    conference_markers = ("conference", "proceedings", "symposium", "workshop", "neurips", "iclr", "acl", "icml", "miccai")
    if any(marker in text for marker in conference_markers):
        return "conference"
    journal_markers = ("journal", "transactions", "letters", "review", "science", "nature")
    if any(marker in text for marker in journal_markers):
        return "journal"
    return None
