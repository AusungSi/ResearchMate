from __future__ import annotations

from dataclasses import dataclass
from html import escape
from pathlib import Path
import re

from app.core.config import Settings

try:
    import fitz
except Exception:  # pragma: no cover
    fitz = None


@dataclass
class PaperVisualAsset:
    kind: str
    path: str
    mime_type: str
    width: int | None
    height: int | None
    source: str


@dataclass
class _FigureCandidate:
    xref: int
    page_index: int
    width: int
    height: int
    pixel_area: int
    placed_area: float
    rect: tuple[float, float, float, float]
    nearby_text: str
    figure_number: int | None
    overall_keyword_hits: int


OVERALL_FIGURE_KEYWORDS = (
    "overall",
    "overview",
    "framework",
    "architecture",
    "pipeline",
    "workflow",
    "system overview",
    "overall framework",
    "method overview",
    "model overview",
    "teaser",
)


class PaperVisualService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def build_assets(
        self,
        *,
        artifact_root: Path,
        task_id: str,
        paper_token: str,
        pdf_path: str | None,
        title: str,
        authors: list[str],
        year: int | None,
        venue: str | None,
        source: str | None,
        abstract: str | None,
        key_points: str | None,
    ) -> dict[str, PaperVisualAsset]:
        visual_dir = self.ensure_visual_dir(artifact_root=artifact_root, task_id=task_id, paper_token=paper_token)
        assets: dict[str, PaperVisualAsset] = {}

        pdf_assets = self._extract_pdf_figure_assets(
            pdf_path=Path(pdf_path).expanduser().resolve() if pdf_path else None,
            primary_output_path=visual_dir / "figure-primary.png",
            overall_output_path=visual_dir / "figure-overall.png",
        )
        assets.update(pdf_assets)

        visual_asset = self._render_template_visual(
            output_path=visual_dir / "paper-visual.svg",
            title=title,
            authors=authors,
            year=year,
            venue=venue,
            source=source,
            abstract=abstract,
            key_points=key_points,
        )
        assets["visual"] = visual_asset
        return assets

    def inspect_assets(self, *, artifact_root: Path, task_id: str, paper_token: str) -> dict[str, PaperVisualAsset]:
        visual_dir = self.visual_dir(artifact_root=artifact_root, task_id=task_id, paper_token=paper_token)
        assets: dict[str, PaperVisualAsset] = {}
        figure_path = visual_dir / "figure-primary.png"
        overall_path = visual_dir / "figure-overall.png"
        visual_path = visual_dir / "paper-visual.svg"
        if overall_path.exists():
            width, height = self._image_dimensions(overall_path)
            assets["overall"] = PaperVisualAsset(
                kind="overall",
                path=str(overall_path),
                mime_type="image/png",
                width=width,
                height=height,
                source="pdf_extract_overall",
            )
        if figure_path.exists():
            width, height = self._image_dimensions(figure_path)
            assets["figure"] = PaperVisualAsset(
                kind="figure",
                path=str(figure_path),
                mime_type="image/png",
                width=width,
                height=height,
                source="pdf_extract",
            )
        if visual_path.exists():
            assets["visual"] = PaperVisualAsset(
                kind="visual",
                path=str(visual_path),
                mime_type="image/svg+xml",
                width=max(1, int(self.settings.paper_visual_template_width)),
                height=max(1, int(self.settings.paper_visual_template_height)),
                source=self.settings.paper_visual_provider,
            )
        return assets

    def visual_dir(self, *, artifact_root: Path, task_id: str, paper_token: str) -> Path:
        safe_token = re.sub(r"[^a-zA-Z0-9._-]+", "_", paper_token or "paper")[:96] or "paper"
        return artifact_root.expanduser().resolve() / task_id / "visuals" / safe_token

    def ensure_visual_dir(self, *, artifact_root: Path, task_id: str, paper_token: str) -> Path:
        path = self.visual_dir(artifact_root=artifact_root, task_id=task_id, paper_token=paper_token)
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _extract_pdf_figure_assets(
        self,
        *,
        pdf_path: Path | None,
        primary_output_path: Path,
        overall_output_path: Path,
    ) -> dict[str, PaperVisualAsset]:
        if fitz is None or pdf_path is None or not pdf_path.exists():
            return {}
        assets: dict[str, PaperVisualAsset] = {}
        doc = fitz.open(pdf_path)
        try:
            candidates = self._figure_candidates(doc)
            primary_candidate = self._choose_primary_candidate(candidates)
            overall_candidate = self._choose_overall_candidate(candidates)

            primary_asset = self._save_candidate_asset(
                doc=doc,
                candidate=primary_candidate,
                output_path=primary_output_path,
                kind="figure",
                source="pdf_extract",
            )
            if primary_asset:
                assets["figure"] = primary_asset

            overall_asset = self._save_candidate_asset(
                doc=doc,
                candidate=overall_candidate,
                output_path=overall_output_path,
                kind="overall",
                source="pdf_extract_overall",
            )
            if overall_asset:
                assets["overall"] = overall_asset
            return assets
        finally:
            doc.close()

    def _figure_candidates(self, doc) -> list[_FigureCandidate]:
        scan_pages = min(len(doc), max(1, int(self.settings.paper_visual_scan_pages)))
        min_width = max(1, int(self.settings.paper_visual_min_width))
        min_height = max(1, int(self.settings.paper_visual_min_height))
        min_page_area_ratio = max(0.0, float(self.settings.paper_visual_min_page_area_ratio))
        seen: set[tuple[int, int, tuple[int, int, int, int]]] = set()
        candidates: list[_FigureCandidate] = []

        for page_index in range(scan_pages):
            page = doc[page_index]
            page_area = max(float(page.rect.width * page.rect.height), 1.0)
            text_blocks = self._page_text_blocks(page)
            for image in page.get_images(full=True):
                xref = int(image[0])
                width = int(image[2] or 0)
                height = int(image[3] or 0)
                if width < min_width or height < min_height:
                    continue
                aspect = width / max(height, 1)
                if aspect < 0.2 or aspect > 5.0:
                    continue
                rects = page.get_image_rects(xref)
                if not rects:
                    continue
                best_rect = max(rects, key=lambda rect: float(rect.width * rect.height))
                rect_key = (
                    int(round(best_rect.x0)),
                    int(round(best_rect.y0)),
                    int(round(best_rect.x1)),
                    int(round(best_rect.y1)),
                )
                dedupe_key = (page_index, xref, rect_key)
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)

                placed_area = float(best_rect.width * best_rect.height)
                if placed_area / page_area < min_page_area_ratio:
                    continue
                nearby_text = self._nearby_text_for_rect(text_blocks=text_blocks, image_rect=best_rect)
                candidates.append(
                    _FigureCandidate(
                        xref=xref,
                        page_index=page_index,
                        width=width,
                        height=height,
                        pixel_area=width * height,
                        placed_area=placed_area,
                        rect=(float(best_rect.x0), float(best_rect.y0), float(best_rect.x1), float(best_rect.y1)),
                        nearby_text=nearby_text,
                        figure_number=_extract_figure_number(nearby_text),
                        overall_keyword_hits=_count_overall_keyword_hits(nearby_text),
                    )
                )
        return candidates

    def _page_text_blocks(self, page) -> list[tuple[object, str]]:
        blocks = page.get_text("dict").get("blocks") or []
        out: list[tuple[object, str]] = []
        for block in blocks:
            if int(block.get("type") or 0) != 0:
                continue
            bbox = block.get("bbox")
            if not bbox:
                continue
            text = _flatten_text_block(block)
            if text:
                out.append((fitz.Rect(bbox), text))
        return out

    def _nearby_text_for_rect(self, *, text_blocks: list[tuple[object, str]], image_rect) -> str:
        ranked: list[tuple[int, float, str]] = []
        max_gap = max(56.0, float(image_rect.height) * 0.38)
        for block_rect, text in text_blocks:
            horizontal_overlap = min(float(block_rect.x1), float(image_rect.x1)) - max(float(block_rect.x0), float(image_rect.x0))
            min_width = max(1.0, min(float(block_rect.width), float(image_rect.width)))
            aligned = horizontal_overlap >= min_width * 0.2
            if not aligned:
                block_center = float(block_rect.x0 + block_rect.width / 2.0)
                image_center = float(image_rect.x0 + image_rect.width / 2.0)
                aligned = abs(block_center - image_center) <= max(float(image_rect.width) * 0.45, 48.0)
            if not aligned:
                continue

            if float(block_rect.y0) >= float(image_rect.y1):
                gap = float(block_rect.y0) - float(image_rect.y1)
            elif float(image_rect.y0) >= float(block_rect.y1):
                gap = float(image_rect.y0) - float(block_rect.y1)
            elif block_rect.intersects(image_rect):
                gap = 0.0
            else:
                continue

            if gap > max_gap:
                continue
            caption_bonus = 1 if re.search(r"\bfig(?:ure)?\.?\s*\d+\b", text, flags=re.IGNORECASE) else 0
            ranked.append((caption_bonus, -gap, text))

        ranked.sort(reverse=True)
        return " ".join(item[2] for item in ranked[:3])

    def _choose_primary_candidate(self, candidates: list[_FigureCandidate]) -> _FigureCandidate | None:
        if not candidates:
            return None
        return max(
            candidates,
            key=lambda item: (
                item.placed_area,
                -item.page_index,
                item.pixel_area,
                item.xref,
            ),
        )

    def _choose_overall_candidate(self, candidates: list[_FigureCandidate]) -> _FigureCandidate | None:
        qualified = [
            item
            for item in candidates
            if item.overall_keyword_hits > 0 or (item.figure_number == 1 and item.page_index <= 2)
        ]
        if not qualified:
            return None
        return max(
            qualified,
            key=lambda item: (
                item.overall_keyword_hits,
                1 if item.figure_number == 1 else 0,
                -item.page_index,
                item.placed_area,
                item.pixel_area,
                item.xref,
            ),
        )

    def _save_candidate_asset(
        self,
        *,
        doc,
        candidate: _FigureCandidate | None,
        output_path: Path,
        kind: str,
        source: str,
    ) -> PaperVisualAsset | None:
        if candidate is None:
            if output_path.exists():
                output_path.unlink()
            return None
        pix = fitz.Pixmap(doc, candidate.xref)
        if pix.alpha or pix.n > 4:
            pix = fitz.Pixmap(fitz.csRGB, pix)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        pix.save(output_path)
        return PaperVisualAsset(
            kind=kind,
            path=str(output_path),
            mime_type="image/png",
            width=int(pix.width),
            height=int(pix.height),
            source=source,
        )

    def _render_template_visual(
        self,
        *,
        output_path: Path,
        title: str,
        authors: list[str],
        year: int | None,
        venue: str | None,
        source: str | None,
        abstract: str | None,
        key_points: str | None,
    ) -> PaperVisualAsset:
        width = max(1, int(self.settings.paper_visual_template_width))
        height = max(1, int(self.settings.paper_visual_template_height))
        summary_lines = self._summary_lines(key_points=key_points, abstract=abstract)
        title_lines = _wrap_text(title.strip() or "Untitled paper", max_chars=30, max_lines=3)
        author_line = _author_line(authors)
        venue_line = " · ".join([item for item in [venue or None, str(year) if year else None, source or None] if item]) or "Research paper"

        svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="Paper visual">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#e2e8f0"/>
    </linearGradient>
    <linearGradient id="panel" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#f8fafc" stop-opacity="0.95"/>
    </linearGradient>
  </defs>
  <rect width="{width}" height="{height}" rx="36" fill="url(#bg)"/>
  <circle cx="{width - 150}" cy="110" r="88" fill="#dbeafe"/>
  <circle cx="{width - 90}" cy="160" r="58" fill="#bfdbfe"/>
  <rect x="44" y="42" width="{width - 88}" height="{height - 84}" rx="28" fill="url(#panel)" stroke="#cbd5e1"/>
  <text x="76" y="96" fill="#2563eb" font-size="20" font-family="Arial, sans-serif" font-weight="700">Paper Visual</text>
  <text x="76" y="132" fill="#0f172a" font-size="30" font-family="Arial, sans-serif" font-weight="700">{_tspan_block(title_lines, x=76)}</text>
  <text x="76" y="248" fill="#475569" font-size="18" font-family="Arial, sans-serif">{escape(author_line)}</text>
  <rect x="76" y="274" width="{min(440, width - 152)}" height="38" rx="19" fill="#eff6ff" stroke="#bfdbfe"/>
  <text x="96" y="299" fill="#1d4ed8" font-size="17" font-family="Arial, sans-serif">{escape(venue_line)}</text>
  <text x="76" y="352" fill="#64748b" font-size="18" font-family="Arial, sans-serif" font-weight="700">TL;DR</text>
  <text x="76" y="388" fill="#334155" font-size="19" font-family="Arial, sans-serif">{_tspan_block(summary_lines, x=76, line_height=30)}</text>
  <rect x="{width - 290}" y="{height - 170}" width="214" height="92" rx="22" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="{width - 264}" y="{height - 122}" fill="#475569" font-size="18" font-family="Arial, sans-serif">Unified template</text>
  <text x="{width - 264}" y="{height - 92}" fill="#0f172a" font-size="18" font-family="Arial, sans-serif" font-weight="700">{escape((source or "paper").upper()[:18])}</text>
</svg>
"""
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(svg, encoding="utf-8")
        return PaperVisualAsset(
            kind="visual",
            path=str(output_path),
            mime_type="image/svg+xml",
            width=width,
            height=height,
            source=self.settings.paper_visual_provider,
        )

    def _image_dimensions(self, path: Path) -> tuple[int | None, int | None]:
        if fitz is None:
            return None, None
        try:
            pix = fitz.Pixmap(str(path))
            return int(pix.width), int(pix.height)
        except Exception:  # pragma: no cover
            return None, None

    def _summary_lines(self, *, key_points: str | None, abstract: str | None) -> list[str]:
        base = (key_points or abstract or "No abstract yet. Build fulltext or summarize this paper to generate a richer preview.").strip()
        pieces = [re.sub(r"^\s*[-*\d.]+\s*", "", line).strip() for line in re.split(r"[\n\r]+", base) if line.strip()]
        if not pieces:
            pieces = [base]
        lines: list[str] = []
        for piece in pieces[:4]:
            for wrapped in _wrap_text(piece, max_chars=42, max_lines=2):
                if len(lines) >= 6:
                    break
                lines.append(wrapped)
            if len(lines) >= 6:
                break
        return lines[:6] or ["No summary available."]


def _author_line(authors: list[str]) -> str:
    cleaned = [item.strip() for item in authors if item and item.strip()]
    if not cleaned:
        return "Authors unavailable"
    if len(cleaned) <= 3:
        return ", ".join(cleaned)
    return f"{', '.join(cleaned[:3])}, et al."


def _flatten_text_block(block: dict) -> str:
    lines = block.get("lines") or []
    parts: list[str] = []
    for line in lines:
        for span in line.get("spans") or []:
            text = str(span.get("text") or "").strip()
            if text:
                parts.append(text)
    return " ".join(parts).strip()


def _extract_figure_number(text: str) -> int | None:
    if not text:
        return None
    match = re.search(r"\bfig(?:ure)?\.?\s*(\d+)\b", text, flags=re.IGNORECASE)
    if not match:
        return None
    try:
        return int(match.group(1))
    except Exception:
        return None


def _count_overall_keyword_hits(text: str) -> int:
    lowered = (text or "").lower()
    return sum(1 for keyword in OVERALL_FIGURE_KEYWORDS if keyword in lowered)


def _wrap_text(text: str, *, max_chars: int, max_lines: int) -> list[str]:
    words = re.split(r"\s+", text.strip())
    if not words:
        return [""]
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if len(candidate) <= max_chars:
            current = candidate
            continue
        if current:
            lines.append(current)
        current = word
        if len(lines) >= max_lines:
            break
    if current and len(lines) < max_lines:
        lines.append(current)
    if not lines:
        lines = [text[:max_chars]]
    if len(lines) == max_lines and words:
        original_joined = " ".join(words)
        if len(" ".join(lines)) < len(original_joined):
            lines[-1] = lines[-1][: max(0, max_chars - 3)].rstrip() + "..."
    return [escape(line) for line in lines[:max_lines]]


def _tspan_block(lines: list[str], *, x: int, line_height: int = 36) -> str:
    if not lines:
        return ""
    first, *rest = lines
    out = [first]
    for line in rest:
        out.append(f'<tspan x="{x}" dy="{line_height}">{line}</tspan>')
    return "".join(out)
