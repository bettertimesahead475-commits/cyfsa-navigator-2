import React, { useState } from 'react';
import { ExtractedDocumentPayload } from '../types/analyzer';
import { Copy, FileText, Hash, Search, ShieldCheck } from 'lucide-react';

interface DocumentViewerPaneProps {
  document: ExtractedDocumentPayload;
  activeCitationTarget: { page: string; paragraph: string } | null;
  onClearCitationTarget: () => void;
}

export const DocumentViewerPane: React.FC<DocumentViewerPaneProps> = ({
  document,
  activeCitationTarget,
  onClearCitationTarget,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const filteredParas = document.structuredParagraphs.filter((p) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      p.text.toLowerCase().includes(term) ||
      p.sectionHeading.toLowerCase().includes(term) ||
      `page ${p.pageNumber}`.includes(term) ||
      `para ${p.paragraphNumber}`.includes(term)
    );
  });

  const handleCopyCitation = (page: number, para: number, text: string, index: number) => {
    const citation = `[CYFSA Record: ${document.fileName}, Page ${page}, Para ${para}]\n"${text}"`;
    navigator.clipboard.writeText(citation);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 1800);
  };

  return (
    <div className="flex flex-col h-full bg-white border border-slate-200/90 rounded-lg overflow-hidden shadow-xs">
      {/* Pane Header */}
      <div className="p-4 border-b border-slate-200/80 bg-[#FAF8F5]/80 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 font-mono">
              <span>{document.fileType}</span>
              <span aria-hidden="true">·</span>
              <span>{document.pageCount} Pages</span>
              <span aria-hidden="true">·</span>
              <span>{document.paragraphCount} Paras</span>
              <span aria-hidden="true">·</span>
              <span>{document.wordCount} Words</span>
            </div>
            <h3 className="text-base font-semibold text-slate-900 truncate" title={document.fileName}>
              {document.fileName}
            </h3>
          </div>

          <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-500 bg-white px-2.5 py-1 rounded border border-slate-200 shrink-0">
            <Hash className="w-3 h-3 text-[#1E3A5F]" />
            <span>{document.sha256Hash.slice(0, 10)}…</span>
          </div>
        </div>

        {/* Search bar & Active Target Indicator */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search indexed text, page, paragraph or section..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded focus:outline-none focus:border-[#1E3A5F]"
            />
          </div>

          {activeCitationTarget && (
            <button
              type="button"
              onClick={onClearCitationTarget}
              className="text-xs text-[#9A5B13] font-mono px-2 py-1 bg-amber-50 rounded border border-amber-200 hover:bg-amber-100 whitespace-nowrap cursor-pointer"
            >
              Target: P.{activeCitationTarget.page}, Para {activeCitationTarget.paragraph} ✕
            </button>
          )}
        </div>
      </div>

      {/* Indexed Paragraphs Scrollable Stream */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5 divide-y divide-slate-100">
        {filteredParas.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500">
            No paragraphs match "{searchTerm}".
          </div>
        ) : (
          filteredParas.map((p, idx) => {
            const isTargeted =
              activeCitationTarget &&
              (String(p.pageNumber) === activeCitationTarget.page ||
                activeCitationTarget.page.includes(String(p.pageNumber))) &&
              (String(p.paragraphNumber) === activeCitationTarget.paragraph ||
                activeCitationTarget.paragraph.includes(String(p.paragraphNumber)));

            return (
              <div
                key={p.paragraphNumber}
                id={`doc-para-${p.pageNumber}-${p.paragraphNumber}`}
                className={`pt-3.5 first:pt-0 rounded p-2.5 transition-all ${
                  isTargeted
                    ? 'bg-amber-50/90 border border-amber-300 ring-2 ring-amber-400/50 glow-citation'
                    : 'hover:bg-slate-50/80 border border-transparent'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-mono text-slate-500 mb-1">
                  <span className="font-semibold text-[#1E3A5F]">
                    [Page {p.pageNumber}, Para {p.paragraphNumber}]
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 truncate max-w-[200px]" title={p.sectionHeading}>
                      {p.sectionHeading}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyCitation(p.pageNumber, p.paragraphNumber, p.text, idx)}
                      className="text-slate-400 hover:text-slate-700 cursor-pointer p-0.5"
                      title="Copy citation reference"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                    {copiedIndex === idx && (
                      <span className="text-[10px] text-[#166534] font-mono">Copied!</span>
                    )}
                  </div>
                </div>

                <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap selection:bg-amber-200">
                  {p.text}
                </p>
              </div>
            );
          })
        )}
      </div>

      {/* Pane Footer */}
      <div className="px-4 py-2 border-t border-slate-200/80 bg-slate-50 text-[11px] text-slate-500 flex items-center justify-between">
        <span>Single-pass extraction stored in memory</span>
        <span>Reused across Quick & Forensic modes</span>
      </div>
    </div>
  );
};
