import React, { useState } from 'react';
import {
  AnalysisMode,
  AnalyzedClaim,
  CrossExamTag,
  DocumentAnalysisResult,
  EvidenceClassification,
  SourceLocation,
  UserTaggedClaimItem,
} from '../types/analyzer';
import { EvidentiaryStatsBar } from './EvidentiaryStatsBar';
import {
  AlertTriangle,
  Bookmark,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  Eye,
  FileCheck,
  FileSearch,
  FileText,
  HelpCircle,
  Scale,
  Search,
  ShieldAlert,
  Tag,
} from 'lucide-react';

interface AnalysisReportViewProps {
  result: DocumentAnalysisResult;
  onRunOtherMode: (targetMode: AnalysisMode) => void;
  hasCachedOtherMode: boolean;
  isBusy: boolean;
  onJumpToCitation?: (page: string, paragraph: string) => void;
}

function getClassificationLabelColor(classification: EvidenceClassification): string {
  switch (classification) {
    case EvidenceClassification.DIRECT:
    case EvidenceClassification.DOCUMENTARY:
    case EvidenceClassification.CORROBORATED:
      return 'text-[#166534] font-semibold';
    case EvidenceClassification.HEARSAY:
    case EvidenceClassification.INFERENCE:
    case EvidenceClassification.OPINION:
      return 'text-[#9A5B13] font-semibold';
    case EvidenceClassification.UNSUPPORTED:
      return 'text-[#991B1B] font-semibold';
    case EvidenceClassification.UNCLEAR:
    default:
      return 'text-slate-600 font-semibold';
  }
}

function SourceCitationBlock({
  location,
  onJump,
}: {
  location: SourceLocation;
  onJump?: (page: string, paragraph: string) => void;
}) {
  const canJump = Boolean(
    location.page &&
      location.paragraph &&
      location.page !== 'Location not reliably identified.' &&
      location.paragraph !== 'Location not reliably identified.'
  );

  return (
    <div className="mt-3 pt-3 border-t border-slate-200/80 text-xs text-slate-600 space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-slate-500 tabular-nums">
          <span>Page: {location.page}</span>
          <span aria-hidden="true">·</span>
          <span>Paragraph: {location.paragraph}</span>
          <span aria-hidden="true">·</span>
          <span>Section: {location.section}</span>
          {location.heading && location.heading !== 'Location not reliably identified.' && (
            <>
              <span aria-hidden="true">·</span>
              <span>Heading: {location.heading}</span>
            </>
          )}
        </div>

        {canJump && onJump && (
          <button
            type="button"
            onClick={() => onJump(location.page, location.paragraph)}
            className="flex items-center gap-1 text-[11px] font-medium text-[#1E3A5F] hover:underline cursor-pointer"
          >
            <span>View in Document</span>
            <ExternalLink className="w-3 h-3" />
          </button>
        )}
      </div>

      {location.shortExcerpt && location.shortExcerpt !== 'Location not reliably identified.' && (
        <blockquote className="pl-3 border-l-2 border-[#1E3A5F]/40 italic text-slate-700 leading-relaxed">
          "{location.shortExcerpt}"
        </blockquote>
      )}
    </div>
  );
}

export const AnalysisReportView: React.FC<AnalysisReportViewProps> = ({
  result,
  onRunOtherMode,
  hasCachedOtherMode,
  isBusy,
  onJumpToCitation,
}) => {
  const [claimFilter, setClaimFilter] = useState<string>('ALL');
  const [activeTab, setActiveTab] = useState<'overview' | 'claims' | 'evidence' | 'preparation' | 'forensic'>('overview');
  const [expandedClaimId, setExpandedClaimId] = useState<string | null>(
    result.claims[0]?.id || null
  );

  // Hearing Prep / Cross-Examination User Tagging Store
  const [taggedClaims, setTaggedClaims] = useState<Record<string, UserTaggedClaimItem>>({});

  const handleToggleTag = (claimId: string, tag: CrossExamTag) => {
    setTaggedClaims((prev) => {
      const existing = prev[claimId] || {
        claimId,
        tags: [],
        crossExamNotes: '',
        crossExamQuestions: [],
      };
      const hasTag = existing.tags.includes(tag);
      const newTags = hasTag ? existing.tags.filter((t) => t !== tag) : [...existing.tags, tag];
      return {
        ...prev,
        [claimId]: {
          ...existing,
          tags: newTags,
        },
      };
    });
  };

  const handleUpdateNotes = (claimId: string, notes: string) => {
    setTaggedClaims((prev) => {
      const existing = prev[claimId] || {
        claimId,
        tags: [],
        crossExamNotes: '',
        crossExamQuestions: [],
      };
      return {
        ...prev,
        [claimId]: {
          ...existing,
          crossExamNotes: notes,
        },
      };
    });
  };

  const filteredClaims = result.claims.filter((c) => {
    if (claimFilter === 'ALL') return true;
    if (claimFilter === 'HEARSAY') return c.evidenceClassification === EvidenceClassification.HEARSAY;
    if (claimFilter === 'INFERENCE_OPINION') {
      return (
        c.evidenceClassification === EvidenceClassification.INFERENCE ||
        c.evidenceClassification === EvidenceClassification.OPINION
      );
    }
    if (claimFilter === 'UNSUPPORTED') {
      return (
        c.evidenceClassification === EvidenceClassification.UNSUPPORTED ||
        c.evidenceClassification === EvidenceClassification.UNCLEAR
      );
    }
    if (claimFilter === 'SUPPORTED') {
      return (
        c.evidenceClassification === EvidenceClassification.DIRECT ||
        c.evidenceClassification === EvidenceClassification.DOCUMENTARY ||
        c.evidenceClassification === EvidenceClassification.CORROBORATED
      );
    }
    if (claimFilter === 'TAGGED') {
      return (taggedClaims[c.id]?.tags.length || 0) > 0;
    }
    return true;
  });

  const handleExportReportJson = () => {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CYFSA_Analysis_${result.mode}_${result.metadata.documentId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportHearingBinder = () => {
    let md = `# CYFSA NAVIGATOR — HEARING PREPARATION BINDER\n`;
    md += `Document: ${result.documentOverview.documentTitle}\n`;
    md += `Type: ${result.documentOverview.documentType}\n`;
    md += `Mode: ${result.mode.toUpperCase()}\n`;
    md += `Analyzed At: ${result.metadata.analyzedAt}\n`;
    md += `Document SHA-256: ${result.metadata.documentHash}\n\n`;

    md += `## 1. EXECUTIVE SUMMARY\n${result.executiveSummary}\n\n`;

    md += `## 2. TAGGED CLAIMS FOR CROSS-EXAMINATION / DISCLOSURE\n`;
    const taggedList = Object.values(taggedClaims).filter((t) => t.tags.length > 0);
    if (taggedList.length === 0) {
      md += `No claims specifically tagged in this session.\n\n`;
    } else {
      taggedList.forEach((t, i) => {
        const claim = result.claims.find((c) => c.id === t.claimId);
        if (claim) {
          md += `### ${i + 1}. [${t.tags.join(' | ')}] ${claim.claim}\n`;
          md += `- Made By: ${claim.madeBy}\n`;
          md += `- Classification: ${claim.evidenceClassification}\n`;
          md += `- Location: Page ${claim.sourceLocation.page}, Para ${claim.sourceLocation.paragraph}\n`;
          md += `- Verbatim Excerpt: "${claim.sourceLocation.shortExcerpt}"\n`;
          md += `- User Cross-Exam Notes: ${t.crossExamNotes || 'None'}\n\n`;
        }
      });
    }

    md += `## 3. CONTRADICTIONS & DISCREPANCIES\n`;
    result.contradictions.forEach((c, i) => {
      md += `### ${i + 1}. ${c.topic}\n`;
      md += `- Statement A (${c.locationA}): ${c.statementA}\n`;
      md += `- Statement B (${c.locationB}): ${c.statementB}\n`;
      md += `- Significance: ${c.whyItMatters}\n\n`;
    });

    md += `## 4. MISSING SUPPORT (IN SUPPLIED TEXT)\n`;
    result.missingSupport.forEach((ms, i) => {
      md += `### ${i + 1}. ${ms.assertion}\n`;
      md += `- Missing: ${ms.whatIsMissingInSuppliedDocument}\n`;
      md += `- Note: ${ms.distinctionNote}\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Hearing_Prep_Binder_${result.metadata.documentId}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const AVAILABLE_TAGS: CrossExamTag[] = [
    'Contested',
    'Hearsay to Strike',
    'Request Disclosure',
    'Key Weakness',
    'Admitted',
  ];

  return (
    <div className="space-y-6">
      {/* Top Dossier Header & Instant Mode Switch */}
      <div className="bg-white border border-slate-200/90 rounded-lg p-6 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6 pb-6 border-b border-slate-200/80">
          <div className="space-y-2 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
              <span>
                {result.mode === 'forensic'
                  ? 'Mode 2: Forensic In-Depth Analysis'
                  : 'Mode 1: Quick Document Review'}
              </span>
              <span aria-hidden="true">·</span>
              <span>Model: {result.metadata.modelUsed}</span>
              <span aria-hidden="true">·</span>
              <span>{(result.metadata.processingTimeMs / 1000).toFixed(2)}s</span>
              <span aria-hidden="true">·</span>
              <span>Access: {result.metadata.accessSource.toUpperCase()}</span>
              <span aria-hidden="true">·</span>
              <span>
                {result.metadata.idempotentReplay
                  ? 'Idempotent Replay (0 Credits Deducted)'
                  : result.metadata.creditCharged
                  ? '1 Allowance Credit Finalized'
                  : 'Admin Exempt'}
              </span>
            </div>

            <h2 className="text-2xl sm:text-3xl font-normal text-slate-900 tracking-tight font-editorial">
              {result.documentOverview.documentTitle}
            </h2>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
              <span>Type: {result.documentOverview.documentType}</span>
              <span aria-hidden="true">·</span>
              <span>Date: {result.documentOverview.documentDate}</span>
              <span aria-hidden="true">·</span>
              <span>Author / Agency: {result.documentOverview.authorOrAgency}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">SHA-256: {result.metadata.documentHash.slice(0, 12)}…</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {result.mode === 'quick' ? (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => onRunOtherMode('forensic')}
                className="px-4 py-2 bg-[#1E3A5F] hover:bg-[#162C49] disabled:opacity-50 text-white text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer shadow-xs"
              >
                {hasCachedOtherMode
                  ? 'Switch to Forensic In-Depth Report (Cached)'
                  : 'Run Forensic In-Depth Analysis (Reuse Extraction)'}
              </button>
            ) : (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => onRunOtherMode('quick')}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-800 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer"
              >
                {hasCachedOtherMode
                  ? 'Switch to Quick Document Review (Cached)'
                  : 'Run Quick Document Review (Reuse Extraction)'}
              </button>
            )}

            <button
              type="button"
              onClick={handleExportHearingBinder}
              className="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5"
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span>Export Hearing Prep Binder</span>
            </button>

            <button
              type="button"
              onClick={handleExportReportJson}
              className="px-3 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer"
            >
              Export JSON
            </button>
          </div>
        </div>

        {/* Mandatory Evidentiary Scope Notice */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-700">
          <div className="pl-3 border-l-2 border-[#9A5B13]">
            <p className="font-semibold text-slate-900">Evidentiary Scope Distinction</p>
            <p className="mt-0.5 text-slate-600 leading-relaxed">
              "No support is identified in this supplied document" is <strong>not</strong> equivalent to "No evidence exists." This analysis evaluates only what is stated and supported within the supplied text.
            </p>
          </div>
          <div className="pl-3 border-l-2 border-[#1E3A5F]">
            <p className="font-semibold text-slate-900">Ontario CYFSA Educational Scope</p>
            <p className="mt-0.5 text-slate-600 leading-relaxed">
              {result.metadata.forensicDisclaimer}
            </p>
          </div>
        </div>

        {/* Section Navigation Tabs */}
        <div className="mt-5 pt-4 border-t border-slate-200/80 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'overview'
                ? 'bg-[#1E3A5F] text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            01. Overview, Dates & Parties
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('claims')}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'claims'
                ? 'bg-[#1E3A5F] text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            02. Claims & Traceability ({result.claims.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('evidence')}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'evidence'
                ? 'bg-[#1E3A5F] text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            03. Evidentiary Assessment
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('preparation')}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'preparation'
                ? 'bg-[#1E3A5F] text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            04. Action & Preparation Steps
          </button>
          {result.mode === 'forensic' && result.forensicSections && (
            <button
              type="button"
              onClick={() => setActiveTab('forensic')}
              className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'forensic'
                  ? 'bg-[#1E3A5F] text-white'
                  : 'text-[#1E3A5F] bg-slate-100 hover:bg-slate-200 font-semibold'
              }`}
            >
              05. Forensic In-Depth Dossier (11 Sections)
            </button>
          )}
        </div>
      </div>

      {/* Visual Evidentiary Radar */}
      <EvidentiaryStatsBar
        result={result}
        onFilterClaims={(filt) => {
          setClaimFilter(filt);
          setActiveTab('claims');
        }}
      />

      {/* TAB 1: OVERVIEW, EXECUTIVE SUMMARY, IMPORTANT DATES, PARTIES */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200/90 rounded-lg p-6 space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 font-editorial">Executive Summary</h3>
              <p className="mt-2 text-[15px] text-slate-700 leading-relaxed max-w-[75ch]">
                {result.executiveSummary}
              </p>
            </div>

            <div className="pt-6 border-t border-slate-200/80 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">CYFSA Procedural Context</h4>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  {result.documentOverview.cyfsaContext}
                </p>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Document Overview Summary</h4>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  {result.documentOverview.overviewSummary}
                </p>
              </div>
            </div>
          </div>

          {/* Parties Identified */}
          <div className="bg-white border border-slate-200/90 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-slate-900 font-editorial">
              Parties & Referenced Individuals ({result.parties.length})
            </h3>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2.5 pr-4 font-medium">Name / Identifier</th>
                    <th className="py-2.5 px-4 font-medium">Role in Document</th>
                    <th className="py-2.5 px-4 font-medium">Relationship to Child / Matter</th>
                    <th className="py-2.5 pl-4 font-medium">Evidentiary Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/70">
                  {result.parties.map((party, idx) => (
                    <tr key={idx} className="align-top">
                      <td className="py-3 pr-4 font-medium text-slate-900">{party.nameOrIdentifier}</td>
                      <td className="py-3 px-4 text-slate-700">{party.role}</td>
                      <td className="py-3 px-4 text-slate-600">{party.relationshipToChildOrMatter}</td>
                      <td className="py-3 pl-4 text-slate-600">{party.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Important Dates & Chronology */}
          <div className="bg-white border border-slate-200/90 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-slate-900 font-editorial">
              Important Dates & Traceable Chronology ({result.importantDates.length})
            </h3>
            <div className="mt-4 divide-y divide-slate-200/80">
              {result.importantDates.map((item, idx) => (
                <div key={idx} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-sm font-semibold text-[#1E3A5F] tabular-nums">
                      {item.date}
                    </span>
                    <span className="text-xs text-slate-500 font-mono">
                      Page {item.sourceLocation.page} · Para {item.sourceLocation.paragraph}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-slate-900">{item.event}</p>
                  <p className="mt-1 text-xs text-slate-600">{item.significance}</p>
                  <SourceCitationBlock location={item.sourceLocation} onJump={onJumpToCitation} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: CLAIMS / ALLEGATIONS & EVIDENCE CLASSIFICATION */}
      {activeTab === 'claims' && (
        <div className="bg-white border border-slate-200/90 rounded-lg p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200/80">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 font-editorial">
                Claims, Allegations & Evidentiary Classification
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Analyzes what the document states, who made each assertion, and how it is supported without adjudicating ultimate truth.
              </p>
            </div>

            {/* Filter Controls */}
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md">
              {[
                { id: 'ALL', label: `All (${result.claims.length})` },
                { id: 'HEARSAY', label: 'Hearsay' },
                { id: 'INFERENCE_OPINION', label: 'Inference / Opinion' },
                { id: 'UNSUPPORTED', label: 'Unsupported' },
                { id: 'SUPPORTED', label: 'Direct / Corroborated' },
                { id: 'TAGGED', label: 'My Binder Tags' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setClaimFilter(tab.id)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                    claimFilter === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-slate-200">
            {filteredClaims.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">
                No claims match the active filter "{claimFilter}".
              </div>
            ) : (
              filteredClaims.map((claim: AnalyzedClaim, index: number) => {
                const isExpanded = expandedClaimId === claim.id;
                const userTagData = taggedClaims[claim.id];
                const activeTags = userTagData?.tags || [];

                return (
                  <div key={claim.id || index} className="py-5 first:pt-0 last:pb-0 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1.5 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono text-slate-500">
                            Claim #{index + 1}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className={getClassificationLabelColor(claim.evidenceClassification)}>
                            Classification: {claim.evidenceClassification}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-600">Made By: {claim.madeBy}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-slate-500">
                            Page {claim.sourceLocation.page}, Para {claim.sourceLocation.paragraph}
                          </span>
                        </div>

                        <h4 className="text-base font-semibold text-slate-900 leading-snug">
                          {claim.claim}
                        </h4>

                        <p className="text-sm text-slate-600">
                          <strong className="font-medium text-slate-800">Why Classification Applies:</strong>{' '}
                          {claim.classificationReasoning}
                        </p>

                        {/* Interactive Tagging Pills */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <span className="text-[11px] text-slate-400 flex items-center gap-1">
                            <Tag className="w-3 h-3" />
                            <span>Binder Tag:</span>
                          </span>
                          {AVAILABLE_TAGS.map((tag) => {
                            const isSelected = activeTags.includes(tag);
                            return (
                              <button
                                key={tag}
                                type="button"
                                onClick={() => handleToggleTag(claim.id, tag)}
                                className={`text-[11px] px-2 py-0.5 rounded transition-colors cursor-pointer border ${
                                  isSelected
                                    ? 'bg-[#1E3A5F] text-white border-[#1E3A5F]'
                                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                                }`}
                              >
                                {tag}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setExpandedClaimId(isExpanded ? null : claim.id)}
                        className="px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-md flex items-center gap-1 shrink-0 cursor-pointer"
                      >
                        <span>{isExpanded ? 'Hide Trace' : 'Inspect'}</span>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="pt-3 border-t border-slate-100 space-y-4 text-sm bg-slate-50/50 p-4 rounded-md">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div>
                            <p className="text-xs font-semibold text-slate-900">
                              Evidentiary Concerns
                            </p>
                            <p className="mt-1 text-slate-700 text-xs leading-relaxed">
                              {claim.concerns}
                            </p>

                            <p className="mt-3 text-xs font-semibold text-slate-900">
                              Support Identified in Supplied Document
                            </p>
                            <ul className="mt-1 space-y-1 text-xs text-slate-700 list-disc pl-4">
                              {claim.supportIdentified.map((s, i) => (
                                <li key={i}>{s}</li>
                              ))}
                            </ul>
                          </div>

                          <div>
                            {claim.contradictions.length > 0 && (
                              <div className="mb-3">
                                <p className="text-xs font-semibold text-[#991B1B]">
                                  Internal Contradictions / Tensions
                                </p>
                                <ul className="mt-1 space-y-1 text-xs text-slate-700 list-disc pl-4">
                                  {claim.contradictions.map((c, i) => (
                                    <li key={i}>{c}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {claim.missingInformation.length > 0 && (
                              <div className="mb-3">
                                <p className="text-xs font-semibold text-[#9A5B13]">
                                  Missing Information in Supplied Text
                                </p>
                                <ul className="mt-1 space-y-1 text-xs text-slate-700 list-disc pl-4">
                                  {claim.missingInformation.map((m, i) => (
                                    <li key={i}>{m}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {claim.verificationQuestions.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-[#1E3A5F]">
                                  Verification Questions to Ask
                                </p>
                                <ul className="mt-1 space-y-1 text-xs text-slate-700 list-disc pl-4">
                                  {claim.verificationQuestions.map((q, i) => (
                                    <li key={i}>{q}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* User Cross-Exam Notes Area */}
                        <div className="pt-3 border-t border-slate-200/80">
                          <label className="text-xs font-semibold text-slate-900 block mb-1">
                            Hearing / Cross-Examination Strategy Notes for this Claim:
                          </label>
                          <textarea
                            value={userTagData?.crossExamNotes || ''}
                            onChange={(e) => handleUpdateNotes(claim.id, e.target.value)}
                            placeholder="Add targeted questions, subpoena requests, or cross-examination objectives..."
                            rows={2}
                            className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded focus:outline-none focus:border-[#1E3A5F]"
                          />
                        </div>

                        <SourceCitationBlock location={claim.sourceLocation} onJump={onJumpToCitation} />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 3: STRENGTHS, WEAKNESSES, IMMEDIATE CONCERNS, MISSING SUPPORT, CONTRADICTIONS */}
      {activeTab === 'evidence' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200/90 rounded-lg p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <h3 className="text-base font-semibold text-[#166534]">Evidence Strengths</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-700 list-disc pl-4">
                {result.evidenceStrengths.map((item, idx) => (
                  <li key={idx} className="leading-relaxed">{item}</li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-base font-semibold text-[#9A5B13]">Evidence Weaknesses</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-700 list-disc pl-4">
                {result.evidenceWeaknesses.map((item, idx) => (
                  <li key={idx} className="leading-relaxed">{item}</li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-base font-semibold text-[#991B1B]">Immediate Concerns</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-700 list-disc pl-4">
                {result.immediateConcerns.map((item, idx) => (
                  <li key={idx} className="leading-relaxed">{item}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Contradictions */}
          <div className="bg-white border border-slate-200/90 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-slate-900 font-editorial">
              Internal Contradictions & Discrepancies ({result.contradictions.length})
            </h3>
            <div className="mt-4 divide-y divide-slate-200">
              {result.contradictions.map((c, idx) => (
                <div key={idx} className="py-4 first:pt-0 last:pb-0 space-y-2">
                  <p className="text-sm font-semibold text-slate-900">{c.topic}</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div className="p-3 bg-slate-50 rounded border border-slate-200/70">
                      <p className="font-mono text-slate-500">Statement A ({c.locationA})</p>
                      <p className="mt-1 text-slate-800">{c.statementA}</p>
                    </div>
                    <div className="p-3 bg-slate-50 rounded border border-slate-200/70">
                      <p className="font-mono text-slate-500">Statement B ({c.locationB})</p>
                      <p className="mt-1 text-slate-800">{c.statementB}</p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-600">
                    <strong className="text-slate-800">Evidentiary Significance:</strong> {c.whyItMatters}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Missing Support */}
          <div className="bg-white border border-slate-200/90 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-slate-900 font-editorial">
              Assertions With Missing Support in Supplied Document ({result.missingSupport.length})
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Critical Distinction: "No support is identified in this supplied document" does not mean "No evidence exists."
            </p>
            <div className="mt-4 divide-y divide-slate-200">
              {result.missingSupport.map((ms, idx) => (
                <div key={idx} className="py-4 first:pt-0 last:pb-0">
                  <p className="text-sm font-semibold text-slate-900">{ms.assertion}</p>
                  <p className="mt-1 text-sm text-slate-700">
                    <strong className="font-medium text-slate-900">Not Identified in Supplied Text:</strong>{' '}
                    {ms.whatIsMissingInSuppliedDocument}
                  </p>
                  <p className="mt-1 text-xs text-[#9A5B13]">{ms.distinctionNote}</p>
                  <SourceCitationBlock location={ms.sourceLocation} onJump={onJumpToCitation} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: VERIFICATION, QUESTIONS, DOCUMENTS TO GATHER, PREPARATION STEPS */}
      {activeTab === 'preparation' && (
        <div className="bg-white border border-slate-200/90 rounded-lg p-6 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <h3 className="text-base font-semibold text-slate-900 font-editorial">Items to Verify</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-700 list-decimal pl-5">
                {result.itemsToVerify.map((item, idx) => (
                  <li key={idx} className="leading-relaxed">{item}</li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-base font-semibold text-slate-900 font-editorial">Questions to Consider</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-700 list-decimal pl-5">
                {result.questionsToConsider.map((item, idx) => (
                  <li key={idx} className="leading-relaxed">{item}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="pt-6 border-t border-slate-200/80 grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <h3 className="text-base font-semibold text-slate-900 font-editorial">Documents & Evidence to Gather</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-700 list-disc pl-5">
                {result.documentsToGather.map((item, idx) => (
                  <li key={idx} className="leading-relaxed">{item}</li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-base font-semibold text-slate-900 font-editorial">Recommended Preparation Steps</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-700 list-decimal pl-5">
                {result.preparationSteps.map((item, idx) => (
                  <li key={idx} className="leading-relaxed">{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: FORENSIC IN-DEPTH SECTIONS (MODE 2) */}
      {activeTab === 'forensic' && result.forensicSections && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200/90 rounded-lg p-6 space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 font-editorial">
                Forensic Document Structure & Execution Audit
              </h3>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-xs text-slate-500 block">Identified Structure Type</span>
                  <span className="font-medium text-slate-900">
                    {result.forensicSections.documentStructure.documentTypeIdentified}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block">Sworn / Unsworn Status</span>
                  <span className="font-medium text-slate-900">
                    {result.forensicSections.documentStructure.swornOrUnswornStatus}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block">Structural Completeness</span>
                  <span className="font-medium text-slate-900">
                    {result.forensicSections.documentStructure.structuralCompleteness}
                  </span>
                </div>
              </div>

              {result.forensicSections.documentStructure.structuralAnomalies.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-200/80">
                  <p className="text-xs font-semibold text-[#9A5B13]">
                    Structural & Recording Anomalies Observed
                  </p>
                  <ul className="mt-1.5 space-y-1 text-xs text-slate-700 list-disc pl-4">
                    {result.forensicSections.documentStructure.structuralAnomalies.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Sources Analysis */}
            <div className="pt-6 border-t border-slate-200/80">
              <h4 className="text-base font-semibold text-slate-900 font-editorial">
                Source Attribution & Reliability Breakdown
              </h4>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500">
                      <th className="py-2 pr-4 font-medium">Source Name / Role</th>
                      <th className="py-2 px-4 font-medium">Source Category</th>
                      <th className="py-2 px-4 font-medium">Claims Count</th>
                      <th className="py-2 pl-4 font-medium">Reliability & First-Hand Basis Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/70">
                    {result.forensicSections.sourcesAnalysis.map((src, idx) => (
                      <tr key={idx} className="align-top">
                        <td className="py-2.5 pr-4 font-medium text-slate-900">{src.sourceNameOrRole}</td>
                        <td className="py-2.5 px-4 text-xs text-slate-700">{src.sourceType}</td>
                        <td className="py-2.5 px-4 font-mono text-xs tabular-nums">
                          {src.attributableClaimsCount}
                        </td>
                        <td className="py-2.5 pl-4 text-xs text-slate-600">{src.reliabilityNotes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Corroboration & Hearsay Audit */}
          <div className="bg-white border border-slate-200/90 rounded-lg p-6 space-y-6">
            <h3 className="text-lg font-semibold text-slate-900 font-editorial">
              Corroboration vs. Self-Referential Repetition
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
              <div>
                <h4 className="text-xs font-semibold text-[#166534]">
                  Independently Corroborated in Text
                </h4>
                <ul className="mt-2 space-y-1.5 text-xs text-slate-700 list-disc pl-4">
                  {result.forensicSections.corroborationAnalysis.independentlyCorroborated.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-semibold text-[#9A5B13]">
                  Self-Referential or Repeated Without Independent Source
                </h4>
                <ul className="mt-2 space-y-1.5 text-xs text-slate-700 list-disc pl-4">
                  {result.forensicSections.corroborationAnalysis.selfReferentialOrRepeatedOnly.map(
                    (item, i) => (
                      <li key={i}>{item}</li>
                    )
                  )}
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-semibold text-[#991B1B]">
                  Key Corroboration Gaps
                </h4>
                <ul className="mt-2 space-y-1.5 text-xs text-slate-700 list-disc pl-4">
                  {result.forensicSections.corroborationAnalysis.corroborationGaps.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-200/80">
              <h3 className="text-lg font-semibold text-slate-900 font-editorial">
                Hearsay, Inference, Opinion & Unsupported Assertions Audit
              </h3>
              <div className="mt-4 divide-y divide-slate-200">
                {result.forensicSections.hearsayAndInference.map((item, idx) => (
                  <div key={idx} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold text-[#9A5B13]">{item.classification}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-600">Original Declarant: {item.originalDeclarant}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-600">Layer: {item.reportingLayer}</span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-slate-900">{item.statement}</p>
                    <p className="mt-1 text-xs text-slate-600">{item.concernExplanation}</p>
                    <SourceCitationBlock location={item.sourceLocation} onJump={onJumpToCitation} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Legal Issues for Review */}
          <div className="bg-white border border-slate-200/90 rounded-lg p-6 space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 font-editorial">
                Ontario CYFSA Procedural & Legal Issues for Review
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Educational issue spotting only. Does not fabricate statutory wording, deadlines, or legal conclusions.
              </p>
              <div className="mt-4 divide-y divide-slate-200">
                {result.forensicSections.legalIssuesForReview.map((issue, idx) => (
                  <div key={idx} className="py-4 first:pt-0 last:pb-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold text-[#1E3A5F]">{issue.cyfsaTopicCategory}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-[#9A5B13] font-medium">{issue.uncertaintyFraming}</span>
                    </div>
                    <h4 className="text-sm font-semibold text-slate-900">{issue.issueTitle}</h4>
                    <p className="text-xs text-slate-700">
                      <strong>Document Basis:</strong> {issue.documentBasis}
                    </p>
                    <p className="text-xs text-slate-600">
                      <strong>Review Guidance:</strong> {issue.reviewGuidance}
                    </p>
                    <SourceCitationBlock location={issue.sourceLocation} onJump={onJumpToCitation} />
                  </div>
                ))}
              </div>
            </div>

            {/* Evidence Preparation Matrix */}
            {result.forensicSections.evidencePreparationMatrix.length > 0 && (
              <div className="pt-6 border-t border-slate-200/80">
                <h4 className="text-base font-semibold text-slate-900 font-editorial">Forensic Evidence Preparation Matrix</h4>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs text-slate-500">
                        <th className="py-2 pr-4 font-medium">Priority</th>
                        <th className="py-2 px-4 font-medium">Claim or Issue Targeted</th>
                        <th className="py-2 px-4 font-medium">Record / Evidence to Gather</th>
                        <th className="py-2 pl-4 font-medium">Evidentiary Purpose</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70">
                      {result.forensicSections.evidencePreparationMatrix.map((row, idx) => (
                        <tr key={idx} className="align-top">
                          <td className="py-2.5 pr-4 font-mono text-xs font-semibold text-[#1E3A5F]">
                            {row.priority}
                          </td>
                          <td className="py-2.5 px-4 text-xs font-medium text-slate-900">
                            {row.claimOrIssue}
                          </td>
                          <td className="py-2.5 px-4 text-xs text-slate-700">
                            {row.documentToRequestOrGather}
                          </td>
                          <td className="py-2.5 pl-4 text-xs text-slate-600">{row.purposeOfEvidence}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
