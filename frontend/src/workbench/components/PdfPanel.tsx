import { useRef } from "react";
import type { FulltextItem, PaperAssetItem, PaperAssetResponse } from "../types";
import { formatDateTime } from "../utils";
import { Badge, SectionTitle, SmallButton } from "./shared";

type Props = {
  taskId: string;
  paperId: string;
  previewUrl: string;
  assets: PaperAssetResponse | null;
  fulltextItem: FulltextItem | null;
  fulltextSummary?: Record<string, number> | null;
  busy?: boolean;
  onClose: () => void;
  onPreviewPdf: (url: string) => void;
  onOpenAsset?: (url: string) => void;
  onDownloadAsset?: (url: string, filename?: string | null) => void;
  onBuildFulltext: () => void;
  onRetryFulltext: () => void;
  onUploadPdf: (file: File) => void;
  onRebuildVisual: () => void;
};

const ASSET_KIND_LABELS: Record<string, string> = {
  overall: "Overall 图",
  figure: "主图",
  visual: "展示图",
  pdf: "PDF",
  txt: "TXT",
  md: "Markdown",
  bib: "BibTeX",
};

const ASSET_STATUS_LABELS: Record<string, string> = {
  available: "可访问",
  not_started: "未处理",
  fetching: "抓取中",
  fetched: "已下载",
  parsing: "解析中",
  parsed: "已解析",
  need_upload: "需上传 PDF",
  failed: "处理失败",
  needs_pdf: "需先获取 PDF",
  not_extracted: "未提取到",
  not_built: "未生成",
  missing: "缺失",
};

function assetByKind(assets: PaperAssetResponse | null, kind: string) {
  return assets?.items.find((item) => item.kind === kind) || null;
}

function assetPreviewUrl(item: PaperAssetItem | null) {
  return item?.open_url || item?.download_url || "";
}

function assetStatusLabel(status?: string | null) {
  return ASSET_STATUS_LABELS[String(status || "")] || String(status || "缺失");
}

export function PdfPanel(props: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pdfAsset = assetByKind(props.assets, "pdf");
  const txtAsset = assetByKind(props.assets, "txt");
  const mdAsset = assetByKind(props.assets, "md");
  const bibAsset = assetByKind(props.assets, "bib");
  const overallAsset = assetByKind(props.assets, "overall");
  const figureAsset = assetByKind(props.assets, "figure");
  const visualAsset = assetByKind(props.assets, "visual");

  return (
    <div className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <SectionTitle
          eyebrow="PDF / Fulltext"
          title="全文与图片资产"
          description={
            props.fulltextItem
              ? `当前状态：${props.fulltextItem.status}`
              : "这里用于查看 PDF、全文处理状态和论文可视化资产。选中论文节点本身不会自动下载 PDF。"
          }
        />
        <SmallButton onClick={props.onClose}>{props.previewUrl ? "关闭预览" : "收起预览"}</SmallButton>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          {props.previewUrl ? (
            <iframe title="pdf-preview" src={props.previewUrl} className="h-[420px] w-full rounded-2xl border border-slate-200 bg-slate-50" />
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-600">
              {pdfAsset?.status === "available"
                ? "已找到 PDF。点击右侧资产卡片中的“打开”会在新标签页查看；点击“预览”则会在当前面板内展示。"
                : "当前没有可用 PDF。你可以先执行全文处理；如果仍然缺失，再手动上传 PDF。"}
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">状态摘要</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone={props.fulltextItem?.status === "parsed" ? "green" : props.fulltextItem?.status === "need_upload" ? "amber" : "slate"}>
                {props.fulltextItem?.status || "未处理"}
              </Badge>
              {typeof props.fulltextItem?.quality_score === "number" ? <Badge tone="blue">{`质量 ${props.fulltextItem.quality_score.toFixed(2)}`}</Badge> : null}
              {props.fulltextItem?.parser ? <Badge tone="violet">{props.fulltextItem.parser}</Badge> : null}
              {props.fulltextItem?.text_chars ? <Badge tone="slate">{`${props.fulltextItem.text_chars} chars`}</Badge> : null}
            </div>
            {props.fulltextItem?.fail_reason ? <div className="mt-3 text-sm text-rose-600">失败原因：{props.fulltextItem.fail_reason}</div> : null}
            {props.fulltextItem?.parsed_at ? <div className="mt-2 text-xs text-slate-500">最近解析：{formatDateTime(props.fulltextItem.parsed_at)}</div> : null}
            {props.fulltextSummary ? (
              <div className="mt-2 text-xs text-slate-500">
                当前任务全文概况：已解析 {props.fulltextSummary.parsed || 0}，待上传 {props.fulltextSummary.need_upload || 0}，抓取中 {props.fulltextSummary.fetching || 0}
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Paper Visual</div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-3">
                <div className="text-sm font-medium text-slate-900">Overall Figure</div>
                <div className="mt-1 text-xs text-slate-500">{assetStatusLabel(overallAsset?.status || "missing")}</div>
                {overallAsset?.download_url ? (
                  <img src={overallAsset.download_url} alt="overall figure" className="mt-3 h-40 w-full rounded-xl border border-slate-200 bg-slate-50 object-contain" />
                ) : null}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-3">
                <div className="text-sm font-medium text-slate-900">Main Figure</div>
                <div className="mt-1 text-xs text-slate-500">{assetStatusLabel(figureAsset?.status || "missing")}</div>
                {figureAsset?.download_url ? (
                  <img src={figureAsset.download_url} alt="main figure" className="mt-3 h-40 w-full rounded-xl border border-slate-200 bg-slate-50 object-contain" />
                ) : null}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-3">
                <div className="text-sm font-medium text-slate-900">Paper Visual</div>
                <div className="mt-1 text-xs text-slate-500">{assetStatusLabel(visualAsset?.status || "missing")}</div>
                {visualAsset?.download_url ? (
                  <img src={visualAsset.download_url} alt="paper visual" className="mt-3 h-40 w-full rounded-xl border border-slate-200 bg-slate-50 object-contain" />
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">操作</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <SmallButton tone="solid" disabled={props.busy} onClick={props.onBuildFulltext}>
                开始全文处理
              </SmallButton>
              <SmallButton disabled={props.busy} onClick={props.onRetryFulltext}>
                重试全文处理
              </SmallButton>
              <SmallButton disabled={props.busy} onClick={props.onRebuildVisual}>
                重建展示图
              </SmallButton>
              <SmallButton disabled={props.busy} onClick={() => fileInputRef.current?.click()}>
                上传 PDF
              </SmallButton>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) props.onUploadPdf(file);
                event.currentTarget.value = "";
              }}
            />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">资产</div>
            <div className="mt-3 space-y-2">
              {[overallAsset, figureAsset, visualAsset, pdfAsset, txtAsset, mdAsset, bibAsset].filter(Boolean).map((item) => (
                <div key={item?.kind} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900">{ASSET_KIND_LABELS[item?.kind || ""] || item?.kind}</div>
                      <div className="mt-1 text-xs text-slate-500">{assetStatusLabel(item?.status)}</div>
                      {item?.filename ? <div className="mt-1 break-all text-xs text-slate-500">{item.filename}</div> : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {item?.kind === "pdf" && item?.open_url ? (
                        <SmallButton onClick={() => props.onPreviewPdf(item.open_url || "")}>预览</SmallButton>
                      ) : null}
                      {item?.open_url ? <SmallButton onClick={() => props.onOpenAsset?.(item.open_url || "")}>打开</SmallButton> : null}
                      {item?.download_url ? <SmallButton onClick={() => props.onDownloadAsset?.(item.download_url || "", item.filename)}>下载</SmallButton> : null}
                    </div>
                  </div>
                </div>
              ))}
              {!props.assets?.items?.length ? <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">当前还没有可展示资产。</div> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewCard(props: { title: string; item: PaperAssetItem | null }) {
  const previewUrl = assetPreviewUrl(props.item);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="text-sm font-medium text-slate-900">{props.title}</div>
      <div className="mt-1 text-xs text-slate-500">{assetStatusLabel(props.item?.status)}</div>
      {previewUrl ? <img src={previewUrl} alt={props.title} className="mt-3 h-40 w-full rounded-xl border border-slate-200 bg-slate-50 object-contain" /> : null}
    </div>
  );
}
