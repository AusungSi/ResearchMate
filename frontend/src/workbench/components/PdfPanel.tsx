import { useRef } from "react";
import { assetKindLabel } from "../display";
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
  onBuildFulltext: () => void;
  onRetryFulltext: () => void;
  onUploadPdf: (file: File) => void;
  onRebuildVisual: () => void;
};

function assetByKind(assets: PaperAssetResponse | null, kind: string) {
  return assets?.items.find((item) => item.kind === kind) || null;
}

function assetPreviewUrl(item: PaperAssetItem | null) {
  return item?.open_url || item?.download_url || "";
}

export function PdfPanel(props: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pdfAsset = assetByKind(props.assets, "pdf");
  const txtAsset = assetByKind(props.assets, "txt");
  const mdAsset = assetByKind(props.assets, "md");
  const bibAsset = assetByKind(props.assets, "bib");
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
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <PreviewCard title="Main Figure" item={figureAsset} />
              <PreviewCard title="Paper Visual" item={visualAsset} />
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
              {[figureAsset, visualAsset, pdfAsset, txtAsset, mdAsset, bibAsset].filter(Boolean).map((item) => (
                <div key={item?.kind} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900">{assetKindLabel(item?.kind || "")}</div>
                      <div className="mt-1 text-xs text-slate-500">{item?.status === "available" ? "可访问" : item?.status || "缺失"}</div>
                      {item?.filename ? <div className="mt-1 break-all text-xs text-slate-500">{item.filename}</div> : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {item?.kind === "pdf" && item?.open_url ? (
                        <button
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700"
                          onClick={() => props.onPreviewPdf(item.open_url || "")}
                        >
                          预览
                        </button>
                      ) : null}
                      {item?.open_url ? (
                        <a className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700" href={item.open_url} rel="noreferrer" target="_blank">
                          打开
                        </a>
                      ) : null}
                      {item?.download_url ? (
                        <a className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700" href={item.download_url} rel="noreferrer" target="_blank">
                          下载
                        </a>
                      ) : null}
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
      <div className="mt-1 text-xs text-slate-500">{props.item?.status === "available" ? "可用" : "暂无"}</div>
      {previewUrl ? <img src={previewUrl} alt={props.title} className="mt-3 h-40 w-full rounded-xl border border-slate-200 bg-slate-50 object-contain" /> : null}
    </div>
  );
}
