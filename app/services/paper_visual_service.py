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

        figure_asset = self._extract_primary_figure(
            pdf_path=Path(pdf_path).expanduser().resolve() if pdf_path else None,
            output_path=visual_dir / "figure-primary.png",
        )
        if figure_asset:
            assets["figure"] = figure_asset

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
        visual_path = visual_dir / "paper-visual.svg"
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

    def _extract_primary_figure(self, *, pdf_path: Path | None, output_path: Path) -> PaperVisualAsset | None:
        if fitz is None or pdf_path is None or not pdf_path.exists():
            return None
        best: tuple[float, int, int, int] | None = None
        doc = fitz.open(pdf_path)
        try:
            scan_pages = min(len(doc), max(1, int(self.settings.paper_visual_scan_pages)))
            min_width = max(1, int(self.settings.paper_visual_min_width))
            min_height = max(1, int(self.settings.paper_visual_min_height))
            min_page_area_ratio = max(0.0, float(self.settings.paper_visual_min_page_area_ratio))
            for page_index in range(scan_pages):
                page = doc[page_index]
                page_area = max(float(page.rect.width * page.rect.height), 1.0)
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
                    placed_area = max((float(rect.width * rect.height) for rect in rects), default=0.0)
                    if placed_area / page_area < min_page_area_ratio:
                        continue
                    pixel_area = width * height
                    score = (placed_area, -page_index, pixel_area, xref)
                    if best is None or score > best:
                        best = score
            if best is None:
                if output_path.exists():
                    output_path.unlink()
                return None
            xref = best[3]
            pix = fitz.Pixmap(doc, xref)
            if pix.alpha or pix.n > 4:
                pix = fitz.Pixmap(fitz.csRGB, pix)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            pix.save(output_path)
            return PaperVisualAsset(
                kind="figure",
                path=str(output_path),
                mime_type="image/png",
                width=int(pix.width),
                height=int(pix.height),
                source="pdf_extract",
            )
        finally:
            doc.close()

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
