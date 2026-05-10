from __future__ import annotations

import json
import os
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable, Sequence
from urllib.parse import quote_plus, urljoin

from bs4 import BeautifulSoup


SUPPORTED_BROWSER_PAPER_SOURCES = ("arxiv", "semantic_scholar", "openalex")
DEFAULT_BROWSER_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


@dataclass(slots=True)
class BrowserPaperCandidate:
    source: str
    title: str
    authors: list[str] = field(default_factory=list)
    year: int | None = None
    venue: str | None = None
    abstract: str | None = None
    url: str | None = None
    pdf_url: str | None = None
    doi: str | None = None
    snippet: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def resolve_browser_paper_sources(sources: Sequence[str] | None) -> list[str]:
    if not sources:
        return list(SUPPORTED_BROWSER_PAPER_SOURCES)
    seen: set[str] = set()
    ordered: list[str] = []
    for raw in sources:
        value = str(raw or "").strip().lower()
        if not value or value in seen:
            continue
        if value not in SUPPORTED_BROWSER_PAPER_SOURCES:
            raise ValueError(f"unsupported source: {value}")
        seen.add(value)
        ordered.append(value)
    return ordered or list(SUPPORTED_BROWSER_PAPER_SOURCES)


def parse_arxiv_search_html(html: str, *, top_n: int = 10) -> list[BrowserPaperCandidate]:
    soup = BeautifulSoup(html, "html.parser")
    items: list[BrowserPaperCandidate] = []
    for card in soup.select("li.arxiv-result")[: max(1, top_n)]:
        title = _clean_text(_text_of(card.select_one("p.title"), " "))
        title = re.sub(r"^title:\s*", "", title, flags=re.IGNORECASE)
        if not title:
            continue
        authors = _unique_texts(card.select("p.authors a"))
        abstract = _clean_text(_text_of(card.select_one("span.abstract-full, p.abstract"), " "))
        abstract = re.sub(r"^abstract:\s*", "", abstract, flags=re.IGNORECASE)
        items.append(
            BrowserPaperCandidate(
                source="arxiv",
                title=title,
                authors=authors,
                year=_extract_year(_text_of(card.select_one("p.is-size-7, p.has-text-grey"), " ") or _text_of(card, " ")),
                venue="arXiv",
                abstract=_none_if_empty(abstract),
                url=_none_if_empty(_absolute_url("https://arxiv.org", _first_href(card, "a[href*='/abs/'], p.list-title a"))),
                pdf_url=_none_if_empty(_absolute_url("https://arxiv.org", _first_href(card, "a[href*='/pdf/']"))),
                doi=_extract_doi(_text_of(card, " ")),
                snippet=_clip_text(abstract or _text_of(card.select_one("p.comment"), " "), 240),
            )
        )
    return items


def parse_semantic_scholar_search_html(html: str, *, top_n: int = 10) -> list[BrowserPaperCandidate]:
    soup = BeautifulSoup(html, "html.parser")
    items: list[BrowserPaperCandidate] = []
    for card in soup.select("[data-selenium-selector='result-row'], article")[: max(1, top_n)]:
        title_anchor = card.select_one("[data-selenium-selector='title-link'], a[href]")
        title = _clean_text(_text_of(title_anchor, " "))
        if not title:
            continue
        metadata_text = _clean_text(_text_of(card.select_one("[data-selenium-selector='venue-metadata'], .venue"), " "))
        abstract = _clean_text(_text_of(card.select_one("[data-selenium-selector='preview-snippet'], .cl-paper-abstract"), " "))
        card_text = _text_of(card, " ")
        items.append(
            BrowserPaperCandidate(
                source="semantic_scholar",
                title=title,
                authors=_unique_texts(card.select("[data-selenium-selector='author-link'], a.author-list__link")),
                year=_extract_year(" ".join(part for part in (metadata_text, card_text) if part)),
                venue=metadata_text or "Semantic Scholar",
                abstract=_none_if_empty(abstract),
                url=_none_if_empty(_absolute_url("https://www.semanticscholar.org", _first_href(card, "[data-selenium-selector='title-link'], a[href]"))),
                pdf_url=_none_if_empty(_absolute_url("https://www.semanticscholar.org", _first_href(card, "a[href$='.pdf'], a[href*='.pdf?']"))),
                doi=_extract_doi(card_text),
                snippet=_clip_text(abstract, 240),
            )
        )
    return items


def parse_openalex_search_html(html: str, *, top_n: int = 10) -> list[BrowserPaperCandidate]:
    soup = BeautifulSoup(html, "html.parser")
    items: list[BrowserPaperCandidate] = []
    selectors = "[data-testid='work-card'], article, .work-card, .result-item"
    for card in soup.select(selectors)[: max(1, top_n)]:
        title_anchor = card.select_one("[data-testid='title-link'], a.work-title, h2 a, h3 a, a.result-title")
        title = _clean_text(_text_of(title_anchor, " "))
        if not title:
            continue
        abstract = _clean_text(_text_of(card.select_one("[data-testid='abstract'], .abstract"), " "))
        meta_text = _clean_text(_text_of(card.select_one(".result-meta, [data-testid='meta'], .meta"), " "))
        items.append(
            BrowserPaperCandidate(
                source="openalex",
                title=title,
                authors=_parse_openalex_authors(card),
                year=_extract_year(_text_of(card.select_one("[data-testid='year'], .year"), " ") or meta_text or _text_of(card, " ")),
                venue=_extract_openalex_venue(card, meta_text),
                abstract=_none_if_empty(abstract),
                url=_none_if_empty(_absolute_url("https://openalex.org", _first_href(card, "[data-testid='title-link'], a.work-title, h2 a, h3 a, a.result-title"))),
                pdf_url=_none_if_empty(_absolute_url("https://openalex.org", _first_href(card, "[data-testid='pdf-link'], a[href$='.pdf'], a[href*='.pdf?']"))),
                doi=_extract_doi(_text_of(card, " ")),
                snippet=_clip_text(abstract or meta_text, 240),
            )
        )
    return items


def dedupe_browser_papers(items: Sequence[BrowserPaperCandidate]) -> list[BrowserPaperCandidate]:
    deduped: list[BrowserPaperCandidate] = []
    seen: set[str] = set()
    for item in items:
        keys = [key for key in (_normalized_doi_key(item.doi), _normalized_url_key(item.url), _normalized_title_key(item.title, item.year)) if key]
        if keys and any(key in seen for key in keys):
            continue
        for key in keys:
            seen.add(key)
        deduped.append(item)
    return deduped


class BrowserPaperFetcher:
    def __init__(
        self,
        *,
        browser_path: str | None = None,
        remote_debug_url: str | None = None,
        semantic_scholar_profile_dir: str | None = None,
        headless: bool = True,
        page_timeout_ms: int = 30000,
    ) -> None:
        self.browser_path = browser_path or os.getenv("BROWSER_PATH") or None
        self.remote_debug_url = remote_debug_url or os.getenv("REMOTE_DEBUG_URL") or None
        self.semantic_scholar_profile_dir = (
            semantic_scholar_profile_dir
            or os.getenv("SEMANTIC_SCHOLAR_PROFILE_DIR")
            or None
        )
        self.headless = headless
        self.page_timeout_ms = page_timeout_ms
        self._playwright = None
        self._browser = None
        self._owns_browser = not self.remote_debug_url

    def fetch(self, *, query: str, top_n: int = 10, sources: Sequence[str] | None = None) -> dict:
        resolved_sources = resolve_browser_paper_sources(sources)
        browser = self._ensure_browser()
        context = browser.new_context(
            locale="zh-CN",
            user_agent=DEFAULT_BROWSER_USER_AGENT,
            viewport={"width": 1440, "height": 960},
            extra_http_headers={"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"},
        )
        all_items: list[BrowserPaperCandidate] = []
        errors: list[dict[str, str]] = []
        try:
            for source in resolved_sources:
                source_context = context
                if source == "semantic_scholar":
                    source_context = self._ensure_semantic_scholar_context()
                page = source_context.new_page()
                try:
                    html = self._fetch_source_html(page, source=source, query=query, top_n=top_n)
                    all_items.extend(_SOURCE_PARSERS[source](html, top_n=top_n))
                except Exception as exc:
                    errors.append({"source": source, "error": str(exc)})
                finally:
                    page.close()
                    if source_context is not context:
                        source_context.close()
        finally:
            context.close()
            self.close()
        items = dedupe_browser_papers(all_items)
        return {
            "query": query,
            "sources": resolved_sources,
            "top_n": top_n,
            "items": [item.to_dict() for item in items[: max(1, top_n)]],
            "errors": errors,
        }

    def close(self) -> None:
        if self._browser and self._owns_browser:
            self._browser.close()
        if self._playwright:
            self._playwright.stop()
        self._browser = None
        self._playwright = None

    def _ensure_browser(self):
        if self._browser is not None:
            return self._browser
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "Playwright is not installed. Run `pip install -r requirements-research-local.txt` and `python -m playwright install chromium` first."
            ) from exc
        self._playwright = sync_playwright().start()
        if self.remote_debug_url:
            self._browser = self._playwright.chromium.connect_over_cdp(self.remote_debug_url)
            return self._browser
        launch_kwargs: dict[str, object] = {
            "headless": self.headless,
            "args": [
                "--lang=zh-CN",
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
            ],
        }
        if self.browser_path:
            launch_kwargs["executable_path"] = self.browser_path
        self._browser = self._playwright.chromium.launch(**launch_kwargs)
        return self._browser

    def _ensure_semantic_scholar_context(self):
        if self._playwright is None:
            self._ensure_browser()
        profile_dir = self.semantic_scholar_profile_dir
        if not profile_dir:
            return self._browser.new_context(
                locale="zh-CN",
                user_agent=DEFAULT_BROWSER_USER_AGENT,
                viewport={"width": 1440, "height": 960},
                extra_http_headers={"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"},
            )
        profile_path = Path(profile_dir)
        profile_path.mkdir(parents=True, exist_ok=True)
        launch_kwargs: dict[str, object] = {
            "user_data_dir": str(profile_path),
            "headless": self.headless,
            "locale": "zh-CN",
            "user_agent": DEFAULT_BROWSER_USER_AGENT,
            "viewport": {"width": 1440, "height": 960},
            "args": [
                "--lang=zh-CN",
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
            ],
        }
        if self.browser_path:
            launch_kwargs["executable_path"] = self.browser_path
        return self._playwright.chromium.launch_persistent_context(**launch_kwargs)

    def _fetch_source_html(self, page, *, source: str, query: str, top_n: int) -> str:
        if source == "arxiv":
            return self._fetch_arxiv_html(page, query=query)
        if source == "openalex":
            return self._fetch_openalex_html(page, query=query)
        if source == "semantic_scholar":
            return self._fetch_semantic_scholar_html(page, query=query)
        page.goto(_build_source_search_url(source=source, query=query, top_n=top_n), wait_until="domcontentloaded", timeout=self.page_timeout_ms)
        self._wait_for_source_ready(page, source=source)
        return page.content()

    def _fetch_arxiv_html(self, page, *, query: str) -> str:
        page.goto("https://arxiv.org/search/", wait_until="domcontentloaded", timeout=self.page_timeout_ms)
        main_input = page.locator("#query")
        if not main_input.count():
            main_input = page.locator("input[name='query']").last
        main_input.fill(query)
        search_type = page.locator("form.main-search select[name='searchtype'], select[name='searchtype']").last
        if search_type.count():
            try:
                search_type.select_option("all")
            except Exception:
                pass
        submit = page.locator("form.main-search button:has-text('Search'), button:has-text('Search')").last
        submit.click()
        page.wait_for_load_state("domcontentloaded", timeout=self.page_timeout_ms)
        self._wait_for_source_ready(page, source="arxiv")
        return page.content()

    def _fetch_openalex_html(self, page, *, query: str) -> str:
        page.goto("https://openalex.org/works", wait_until="domcontentloaded", timeout=max(self.page_timeout_ms, 60000))
        page.locator("textarea.search-input").fill(query)
        page.keyboard.press("Enter")
        page.wait_for_load_state("domcontentloaded", timeout=max(self.page_timeout_ms, 60000))
        self._wait_for_source_ready(page, source="openalex")
        return page.content()

    def _fetch_semantic_scholar_html(self, page, *, query: str) -> str:
        page.goto("https://www.semanticscholar.org/", wait_until="domcontentloaded", timeout=max(self.page_timeout_ms, 60000))
        self._dismiss_cookie_overlays(page)
        search_input = page.locator("input[type='search'], input[name='q'], form input").first
        search_input.wait_for(timeout=min(self.page_timeout_ms, 15000))
        search_input.fill(query)
        page.keyboard.press("Enter")
        page.wait_for_load_state("domcontentloaded", timeout=max(self.page_timeout_ms, 60000))
        self._dismiss_cookie_overlays(page)
        self._wait_for_source_ready(page, source="semantic_scholar")
        return page.content()

    def _wait_for_source_ready(self, page, *, source: str) -> None:
        selectors = {
            "arxiv": "li.arxiv-result",
            "openalex": ".result-item, [data-testid='work-card'], .work-card",
            "semantic_scholar": "[data-selenium-selector='result-row'], article",
        }
        try:
            page.wait_for_selector(selectors[source], timeout=min(self.page_timeout_ms, 20000))
            return
        except Exception:
            pass
        try:
            page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            pass
        content = page.content()
        title = page.title()
        if source == "semantic_scholar" and ("Error | Semantic Scholar" in title or "robot" in content.lower()):
            raise RuntimeError("Semantic Scholar blocked or throttled the automated browser session.")
        if source == "arxiv" and "400 Bad Request" in title:
            raise RuntimeError("arXiv rejected the search request.")
        if not _page_contains_selector(content, selectors[source]):
            raise RuntimeError(f"{source} results did not become available in time.")

    def _dismiss_cookie_overlays(self, page) -> None:
        for label in ("全部接受", "Accept All", "I Accept", "Accept all", "同意", "全部拒绝", "Reject all"):
            try:
                button = page.get_by_role("button", name=label)
                if button.count():
                    button.first.click(timeout=1500)
                    return
            except Exception:
                continue


def save_browser_paper_fetch_report(report: dict, output_path: str | Path) -> Path:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def _build_source_search_url(*, source: str, query: str, top_n: int) -> str:
    encoded = quote_plus(query.strip())
    size = max(1, min(50, top_n))
    if source == "arxiv":
        return f"https://arxiv.org/search/?query={encoded}&searchtype=all&source=header"
    if source == "semantic_scholar":
        return f"https://www.semanticscholar.org/search?q={encoded}&sort=relevance"
    if source == "openalex":
        return f"https://openalex.org/works?search={encoded}"
    raise ValueError(f"unsupported source: {source}")


def _clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _text_of(node, separator: str = " ") -> str:
    if not node:
        return ""
    return node.get_text(separator, strip=True)


def _first_href(node, selector: str) -> str:
    anchor = node.select_one(selector) if node else None
    if not anchor:
        return ""
    return str(anchor.get("href") or "").strip()


def _absolute_url(base: str, value: str) -> str:
    value = str(value or "").strip()
    if not value:
        return ""
    return urljoin(base, value)


def _unique_texts(nodes: Iterable) -> list[str]:
    seen: set[str] = set()
    values: list[str] = []
    for node in nodes:
        value = _clean_text(_text_of(node, " "))
        if not value or value in seen:
            continue
        seen.add(value)
        values.append(value)
    return values


def _none_if_empty(value: str) -> str | None:
    value = _clean_text(value)
    return value or None


def _clip_text(value: str, limit: int) -> str | None:
    text = _clean_text(value)
    if not text:
        return None
    if len(text) <= limit:
        return text
    return f"{text[: limit - 1]}…"


def _extract_year(text: str) -> int | None:
    match = re.search(r"(19|20)\d{2}", text or "")
    if not match:
        return None
    return int(match.group(0))


def _extract_doi(text: str) -> str | None:
    match = re.search(r"(10\.\d{4,9}/[-._;()/:A-Z0-9]+)", text or "", flags=re.IGNORECASE)
    if not match:
        return None
    return match.group(1).rstrip(".,);]").strip()


def _normalized_doi_key(doi: str | None) -> str:
    value = _clean_text(doi or "")
    return f"doi:{value.lower()}" if value else ""


def _normalized_url_key(url: str | None) -> str:
    value = _clean_text(url or "")
    if not value:
        return ""
    normalized = re.sub(r"^https?://", "", value, flags=re.IGNORECASE).rstrip("/").lower()
    return f"url:{normalized}"


def _normalized_title_key(title: str | None, year: int | None) -> str:
    normalized = re.sub(r"[^a-z0-9]+", " ", (title or "").lower()).strip()
    if not normalized:
        return ""
    return f"title:{normalized}:{year or 0}"


def _parse_openalex_authors(card) -> list[str]:
    linked_authors = _unique_texts(card.select("[data-testid='author-link'], .authors a"))
    if linked_authors:
        return linked_authors
    meta = card.select_one(".result-meta")
    if not meta:
        return []
    parts = [_clean_text(_text_of(span, " ")) for span in meta.select("span")]
    filtered = [part for part in parts if part and part != "·" and not re.fullmatch(r"(19|20)\d{2}", part) and "," not in part and "cited" not in part.lower()]
    authors: list[str] = []
    for part in filtered:
        if part.lower() == "et al.":
            continue
        if part.startswith("http"):
            continue
        if part not in authors:
            authors.append(part)
        if authors:
            break
    return authors


def _extract_openalex_venue(card, meta_text: str) -> str:
    explicit = _clean_text(_text_of(card.select_one("[data-testid='venue'], .venue, .font-italic"), " "))
    if explicit:
        return explicit
    meta = card.select_one(".result-meta")
    if meta:
        parts = [_clean_text(_text_of(span, " ")) for span in meta.select("span")]
        filtered = [
            part
            for part in parts
            if part
            and part != "·"
            and not re.fullmatch(r"(19|20)\d{2}", part)
            and "et al" not in part.lower()
            and "cited" not in part.lower()
            and "," not in part
        ]
        if len(filtered) >= 2:
            return filtered[1]
    return _none_if_empty(meta_text) or "OpenAlex"


def _page_contains_selector(html: str, selector: str) -> bool:
    soup = BeautifulSoup(html, "html.parser")
    return soup.select_one(selector) is not None


_SOURCE_PARSERS = {
    "arxiv": parse_arxiv_search_html,
    "semantic_scholar": parse_semantic_scholar_search_html,
    "openalex": parse_openalex_search_html,
}
