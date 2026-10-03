import React from 'react';
import { DocumentAnalysisResult, EvidenceClassification } from '../types/analyzer';
import { AlertCircle, AlertTriangle, CheckCircle, FileQuestion, Scale, ShieldAlert } from 'lucide-react';

interface EvidentiaryStatsBarProps {
  result: DocumentAnalysisResult;
  onFilterClaims: (classification: string) => void;
}

export const EvidentiaryStatsBar: React.FC<EvidentiaryStatsBarProps> = ({
  result,
  onFilterClaims,
}) => {
  const totalClaims = result.claims.length;
  const hearsayClaims = result.claims.filter(
    (c) => c.evidenceClassification === EvidenceClassification.HEARSAY
  ).length;
  const inferenceOpinionClaims = result.claims.filter(
    (c) =>
      c.evidenceClassification === EvidenceClassification.INFERENCE ||
      c.evidenceClassification === EvidenceClassification.OPINION
  ).length;
  const unsupportedClaims = result.claims.filter(
    (c) =>
      c.evidenceClassification === EvidenceClassification.UNSUPPORTED ||
      c.evidenceClassification === EvidenceClassification.UNCLEAR
  ).length;
  const supportedClaims = result.claims.filter(
    (c) =>
      c.evidenceClassification === EvidenceClassification.DIRECT ||
      c.evidenceClassification === EvidenceClassification.DOCUMENTARY ||
      c.evidenceClassification === EvidenceClassification.CORROBORATED
  ).length;

  const hearsayPercentage = totalClaims > 0 ? Math.round((hearsayClaims / totalClaims) * 100) : 0;
  const supportedPercentage = totalClaims > 0 ? Math.round((supportedClaims / totalClaims) * 100) : 0;
  const unsupportedPercentage = totalClaims > 0 ? Math.round((unsupportedClaims / totalClaims) * 100) : 0;

  return (
    <div className="bg-white border border-slate-200/90 rounded-lg p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-200/80">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Scale className="w-4 h-4 text-[#1E3A5F]" />
            <span>Evidentiary Classification Radar</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Breakdown of claims identified in this supplied document across 8 statutory and evidentiary classifications.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-slate-600">
          <span>Total Claims: {totalClaims}</span>
          <span aria-hidden="true">·</span>
          <span>Contradictions: {result.contradictions.length}</span>
          <span aria-hidden="true">·</span>
          <span>Missing Support: {result.missingSupport.length}</span>
        </div>
      </div>

      {/* Proportional Segmented Bar */}
      <div className="space-y-1.5">
        <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden flex">
          <div
            style={{ width: `${supportedPercentage}%` }}
            className="bg-[#166534] transition-all"
            title={`Direct / Corroborated: ${supportedPercentage}%`}
          />
          <div
            style={{ width: `${hearsayPercentage}%` }}
            className="bg-[#9A5B13] transition-all"
            title={`Hearsay: ${hearsayPercentage}%`}
          />
          <div
            style={{ width: `${unsupportedPercentage}%` }}
            className="bg-[#991B1B] transition-all"
            title={`Unsupported / Unclear: ${unsupportedPercentage}%`}
          />
        </div>

        {/* Legend buttons with interactive filter triggering */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <button
            type="button"
            onClick={() => onFilterClaims('SUPPORTED')}
            className="flex items-center gap-1.5 text-slate-700 hover:text-slate-900 cursor-pointer"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-[#166534] shrink-0" />
            <span>Direct / Corroborated: {supportedClaims} ({supportedPercentage}%)</span>
          </button>

          <button
            type="button"
            onClick={() => onFilterClaims('HEARSAY')}
            className="flex items-center gap-1.5 text-slate-700 hover:text-slate-900 cursor-pointer"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-[#9A5B13] shrink-0" />
            <span>Hearsay: {hearsayClaims} ({hearsayPercentage}%)</span>
          </button>

          <button
            type="button"
            onClick={() => onFilterClaims('INFERENCE_OPINION')}
            className="flex items-center gap-1.5 text-slate-700 hover:text-slate-900 cursor-pointer"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-amber-600 shrink-0" />
            <span>Inference / Opinion: {inferenceOpinionClaims}</span>
          </button>

          <button
            type="button"
            onClick={() => onFilterClaims('UNSUPPORTED')}
            className="flex items-center gap-1.5 text-slate-700 hover:text-slate-900 cursor-pointer"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-[#991B1B] shrink-0" />
            <span>Unsupported in Text: {unsupportedClaims} ({unsupportedPercentage}%)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
