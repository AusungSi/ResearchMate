import type { PaperAssetResponse } from "../types";
import { SectionTitle, SmallButton } from "./shared";

export function PdfPanel(props: {
  pdfUrl: string;
  assets: PaperAssetResponse | null;
  onClose: () => void;
}) {
  const pdfAsset = props.assets?.items.find((item) => item.kind === "pdf");
  const txtAsset = props.assets?.items.find((item) => item.kind === "txt");

  return (
    <div className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <SectionTitle
          eyebrow="PDF / Fulltext"
          title="PDF 与全文"
          description={pdfAsset?.status === "available" ? "已找到 PDF，可以直接预览。" : "当前没有可用 PDF。"}
        />
        <SmallButton onClick={props.onClose}>关闭</SmallButton>
      </div>
      {props.pdfUrl ? (
        <iframe title="pdf-preview" src={props.pdfUrl} className="h-[420px] w-full border-0" />
      ) : (
        <div className="space-y-3 p-4 text-sm text-slate-600">
          <div className="rounded-2xl bg-slate-50 p-3">
            {pdfAsset?.status === "available" ? "可以点击 Open PDF 打开。" : "Need upload：还没有可用 PDF。可以先执行全文处理，或者稍后手动上传。"}
          </div>
          {txtAsset?.status === "available" && txtAsset.download_url ? (
            <a className="inline-flex rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700" href={txtAsset.download_url} rel="noreferrer" target="_blank">
              打开全文文本
            </a>
          ) : null}
        </div>
      )}
    </div>
  );
}
