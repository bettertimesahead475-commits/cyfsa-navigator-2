import React, { useEffect, useRef, useState } from 'react';
import {
  AccessCheckResult,
  AnalysisMode,
  AnalyzerErrorPayload,
  AnalyzerStage,
  AuthenticatedUser,
  DocumentAnalysisResult,
  ExtractedDocumentPayload,
} from './types/analyzer';
import { SAMPLE_CYFSA_DOCUMENTS, SampleCyfsaDocument } from './data/migrationAuditData';
import { AnalysisReportView } from './components/AnalysisReportView';
import { DocumentViewerPane } from './components/DocumentViewerPane';
import { MigrationAuditView } from './components/MigrationAuditView';
import { auth, signInWithGoogle, signOutFirebase } from './lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Columns,
  FileSearch,
  FileText,
  Lock,
  LogOut,
  Play,
  RefreshCw,
  Scale,
  ShieldCheck,
  Split,
  Upload,
  UserCheck,
} from 'lucide-react';

const PIPELINE_STAGES_ORDER: AnalyzerStage[] = [
  AnalyzerStage.IDLE,
  AnalyzerStage.UPLOADING,
  AnalyzerStage.AUTHENTICATING,
  AnalyzerStage.EXTRACTING,
  AnalyzerStage.VERIFYING_ACCESS,
  AnalyzerStage.ANALYZING,
  AnalyzerStage.VALIDATING,
  AnalyzerStage.SAVING,
  AnalyzerStage.COMPLETE,
];

export default function App() {
  const [activeNav, setActiveNav] = useState<'analyzer' | 'split' | 'audit' | 'config'>('analyzer');

  // Authentication state
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);

  // Analyzer Pipeline State Machine
  const [stage, setStage] = useState<AnalyzerStage>(AnalyzerStage.IDLE);
  const [selectedMode, setSelectedMode] = useState<AnalysisMode>('quick');
  const [errorPayload, setErrorPayload] = useState<AnalyzerErrorPayload | null>(null);

  // Single-Pass Extracted Document Payload
  const [extractedDoc, setExtractedDoc] = useState<ExtractedDocumentPayload | null>(null);
  const [selectedSampleId, setSelectedSampleId] = useState<string>(SAMPLE_CYFSA_DOCUMENTS[0].id);

  // Cached results per (documentHash + mode)
  const [analysisCache, setAnalysisCache] = useState<Record<string, DocumentAnalysisResult>>({});
  const [currentResult, setCurrentResult] = useState<DocumentAnalysisResult | null>(null);

  // Interactive Citation Target for Split-Screen inspection
  const [activeCitationTarget, setActiveCitationTarget] = useState<{ page: string; paragraph: string } | null>(null);

  // Supabase Access & Diagnostics
  const [accessStatus, setAccessStatus] = useState<AccessCheckResult | null>(null);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [ledgerSummary, setLedgerSummary] = useState<any>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Initialize authenticated Firebase session on mount
  const establishFirebaseSession = async (tierOverride: 'free' | 'paid' | 'admin' = 'free') => {
    setAuthLoading(true);
    try {
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: 'usr_cyfsa_89204',
          email: 'elena.rostova@cyfsanavigator.com',
          displayName: 'Elena Rostova',
          tier: tierOverride,
        }),
      });
      const data = await res.json();
      if (data.user) {
        setCurrentUser(data.user);
        setLedgerSummary(data.usageSummary);
        await refreshAccessCheck(data.user.idToken, extractedDoc?.sha256Hash, selectedMode);

        // Auto-extract default sample document on initial load if none exists
        if (!extractedDoc) {
          const defaultSample = SAMPLE_CYFSA_DOCUMENTS[0];
          const extRes = await fetch('/api/analyzer/extract', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${data.user.idToken}`,
            },
            body: JSON.stringify({
              fileName: defaultSample.fileName,
              mimeType: 'text/plain',
              rawTextContent: defaultSample.content,
            }),
          });
          const extData = await extRes.json();
          if (extRes.ok && extData.extractedDocument) {
            setExtractedDoc(extData.extractedDocument);
          }
        }
      }
    } catch (e) {
      console.error('Failed to establish session:', e);
    } finally {
      setAuthLoading(false);
    }
  };

  const fetchServerDiagnostics = async () => {
    try {
      const res = await fetch('/api/analyzer/diagnostics');
      const data = await res.json();
      setDiagnostics(data);
    } catch {
      // ignore
    }
  };

  const refreshAccessCheck = async (
    token?: string,
    documentHash?: string,
    mode?: AnalysisMode
  ): Promise<AccessCheckResult | null> => {
    const activeToken = token ?? currentUser?.idToken;
    if (!activeToken) {
      setAccessStatus(null);
      return null;
    }

    try {
      const res = await fetch('/api/analyzer/access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${activeToken}`,
        },
        body: JSON.stringify({
          documentHash,
          mode,
        }),
      });
      const data = await res.json();
      if (res.ok && data.access) {
        setAccessStatus(data.access);
        return data.access;
      }
      if (data.error) {
        setErrorPayload(data.error);
      }
      return null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    // Listen for genuine Firebase Authentication state changes
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        try {
          const token = await fbUser.getIdToken();
          const userObj: AuthenticatedUser = {
            uid: fbUser.uid,
            email: fbUser.email || 'user@cyfsanavigator.com',
            displayName: fbUser.displayName || 'Authenticated User',
            photoURL: fbUser.photoURL || undefined,
            tier: 'free',
            idToken: token,
            tokenIssuedAt: new Date().toISOString(),
            firebaseProjectId: 'gen-lang-client-0105737183',
          };
          setCurrentUser(userObj);
          await refreshAccessCheck(token, extractedDoc?.sha256Hash, selectedMode);
        } catch (err) {
          console.error('Failed to get Firebase ID token:', err);
        }
      } else {
        // If no user signed in via Firebase, initialize session
        establishFirebaseSession('free');
      }
      setAuthLoading(false);
    });

    fetchServerDiagnostics();
    return () => unsubscribe();
  }, []);

  const handleGoogleSignIn = async () => {
    setAuthLoading(true);
    try {
      const { user, token, error } = await signInWithGoogle();
      if (user && token) {
        const userObj: AuthenticatedUser = {
          uid: user.uid,
          email: user.email || 'user@cyfsanavigator.com',
          displayName: user.displayName || 'Google User',
          photoURL: user.photoURL || undefined,
          tier: 'free',
          idToken: token,
          tokenIssuedAt: new Date().toISOString(),
          firebaseProjectId: 'gen-lang-client-0105737183',
        };
        setCurrentUser(userObj);
        await refreshAccessCheck(token, extractedDoc?.sha256Hash, selectedMode);
      } else if (error) {
        // Fall back seamlessly to demo session if popup was blocked in iframe
        await establishFirebaseSession('free');
      }
    } catch {
      await establishFirebaseSession('free');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutFirebase();
    } catch (e) {
      console.warn('Sign out error:', e);
    }
    setCurrentUser(null);
    setAccessStatus(null);
  };

  // Single-pass extraction for sample documents
  const handleExtractSampleDocument = async (sample: SampleCyfsaDocument) => {
    setErrorPayload(null);
    setSelectedSampleId(sample.id);
    setActiveCitationTarget(null);
    setStage(AnalyzerStage.UPLOADING);

    await new Promise((r) => setTimeout(r, 100));
    setStage(AnalyzerStage.AUTHENTICATING);

    if (!currentUser?.idToken) {
      setStage(AnalyzerStage.ERROR);
      setErrorPayload({
        code: 'SIGN_IN_REQUIRED',
        stage: AnalyzerStage.AUTHENTICATING,
        message: 'SIGN_IN_REQUIRED: Please sign in before extracting and analyzing documents.',
        remediation: 'Click "Sign In with Google" in the top bar to authenticate your session.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    setStage(AnalyzerStage.EXTRACTING);
    try {
      const res = await fetch('/api/analyzer/extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentUser.idToken}`,
        },
        body: JSON.stringify({
          fileName: sample.fileName,
          mimeType: 'text/plain',
          rawTextContent: sample.content,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setStage(AnalyzerStage.ERROR);
        setErrorPayload(data.error);
        return;
      }

      const payload: ExtractedDocumentPayload = data.extractedDocument;
      setExtractedDoc(payload);

      const cacheKey = `${payload.sha256Hash}:${selectedMode}`;
      if (analysisCache[cacheKey]) {
        setCurrentResult(analysisCache[cacheKey]);
        setStage(AnalyzerStage.COMPLETE);
      } else {
        setCurrentResult(null);
        setStage(AnalyzerStage.IDLE);
      }

      await refreshAccessCheck(currentUser.idToken, payload.sha256Hash, selectedMode);
    } catch (err: any) {
      setStage(AnalyzerStage.ERROR);
      setErrorPayload({
        code: 'EXTRACTION_FAILED',
        stage: AnalyzerStage.EXTRACTING,
        message: err?.message || 'Network error during extraction.',
        remediation: 'Check your connection and retry.',
        timestamp: new Date().toISOString(),
      });
    }
  };

  // Upload handler for PDF, DOCX, TXT, and Images
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorPayload(null);
    setActiveCitationTarget(null);
    setStage(AnalyzerStage.UPLOADING);

    if (!currentUser?.idToken) {
      setStage(AnalyzerStage.ERROR);
      setErrorPayload({
        code: 'SIGN_IN_REQUIRED',
        stage: AnalyzerStage.AUTHENTICATING,
        message: 'SIGN_IN_REQUIRED: Please sign in before uploading a document.',
        remediation: 'Click "Sign In with Google" in the top bar.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    setStage(AnalyzerStage.AUTHENTICATING);
    await new Promise((r) => setTimeout(r, 100));
    setStage(AnalyzerStage.EXTRACTING);

    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const resultStr = String(reader.result || '');
          const commaIdx = resultStr.indexOf(',');
          resolve(commaIdx >= 0 ? resultStr.slice(commaIdx + 1) : resultStr);
        };
        reader.onerror = () => reject(new Error('Failed to read file from disk.'));
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/analyzer/extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentUser.idToken}`,
        },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          base64Data,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setStage(AnalyzerStage.ERROR);
        setErrorPayload(data.error);
        return;
      }

      const payload: ExtractedDocumentPayload = data.extractedDocument;
      setExtractedDoc(payload);
      setSelectedSampleId('');

      const cacheKey = `${payload.sha256Hash}:${selectedMode}`;
      if (analysisCache[cacheKey]) {
        setCurrentResult(analysisCache[cacheKey]);
        setStage(AnalyzerStage.COMPLETE);
      } else {
        setCurrentResult(null);
        setStage(AnalyzerStage.IDLE);
      }

      await refreshAccessCheck(currentUser.idToken, payload.sha256Hash, selectedMode);
    } catch (err: any) {
      setStage(AnalyzerStage.ERROR);
      setErrorPayload({
        code: 'EXTRACTION_FAILED',
        stage: AnalyzerStage.EXTRACTING,
        message: err?.message || 'Failed to upload and extract file.',
        remediation: 'Ensure the file is a valid PDF, DOCX, or TXT document.',
        timestamp: new Date().toISOString(),
      });
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Run full Gemini analysis (reusing extracted document without re-uploading)
  const handleRunAnalysis = async (modeOverride?: AnalysisMode) => {
    const targetMode: AnalysisMode = modeOverride || selectedMode;
    setSelectedMode(targetMode);
    setErrorPayload(null);

    setStage(AnalyzerStage.AUTHENTICATING);
    if (!currentUser?.idToken) {
      setStage(AnalyzerStage.ERROR);
      setErrorPayload({
        code: 'SIGN_IN_REQUIRED',
        stage: AnalyzerStage.AUTHENTICATING,
        message: 'SIGN_IN_REQUIRED: Unauthenticated analysis request rejected (HTTP 401).',
        remediation: 'Sign in with your CYFSA Navigator account in the top navigation bar.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    let activeExtracted = extractedDoc;
    if (!activeExtracted) {
      setStage(AnalyzerStage.EXTRACTING);
      const defaultSample =
        SAMPLE_CYFSA_DOCUMENTS.find((s) => s.id === selectedSampleId) || SAMPLE_CYFSA_DOCUMENTS[0];
      const extRes = await fetch('/api/analyzer/extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentUser.idToken}`,
        },
        body: JSON.stringify({
          fileName: defaultSample.fileName,
          mimeType: 'text/plain',
          rawTextContent: defaultSample.content,
        }),
      });
      const extData = await extRes.json();
      if (!extRes.ok || extData.error) {
        setStage(AnalyzerStage.ERROR);
        setErrorPayload(extData.error);
        return;
      }
      activeExtracted = extData.extractedDocument;
      setExtractedDoc(activeExtracted);
    }

    if (!activeExtracted) return;

    // Check memory cache for instant display
    const cacheKey = `${activeExtracted.sha256Hash}:${targetMode}`;
    if (modeOverride && analysisCache[cacheKey]) {
      setCurrentResult(analysisCache[cacheKey]);
      setStage(AnalyzerStage.COMPLETE);
      return;
    }

    setStage(AnalyzerStage.VERIFYING_ACCESS);
    const accessRes = await fetch('/api/analyzer/access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentUser.idToken}`,
      },
      body: JSON.stringify({
        documentHash: activeExtracted.sha256Hash,
        mode: targetMode,
      }),
    });
    const accessData = await accessRes.json();

    if (!accessRes.ok || accessData.error) {
      setStage(AnalyzerStage.ERROR);
      setErrorPayload(accessData.error);
      return;
    }

    setAccessStatus(accessData.access);
    if (!accessData.access?.allowed) {
      setStage(AnalyzerStage.ERROR);
      setErrorPayload({
        code: 'ACCESS_DENIED_NO_CREDITS',
        stage: AnalyzerStage.VERIFYING_ACCESS,
        message: accessData.access?.reason || 'No remaining analysis credits.',
        remediation:
          'Open "Config & Ledger" or click "Activate Paid Session" below to add analysis credits.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    setStage(AnalyzerStage.ANALYZING);
    try {
      const analyzeRes = await fetch('/api/analyzer/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentUser.idToken}`,
        },
        body: JSON.stringify({
          extractedDocument: activeExtracted,
          mode: targetMode,
          requestId: `req_${activeExtracted.sha256Hash.slice(0, 8)}_${targetMode}`,
        }),
      });

      setStage(AnalyzerStage.VALIDATING);
      const analyzeData = await analyzeRes.json();

      if (!analyzeRes.ok || analyzeData.error) {
        setStage(AnalyzerStage.ERROR);
        setErrorPayload(analyzeData.error);
        return;
      }

      setStage(AnalyzerStage.SAVING);
      await new Promise((r) => setTimeout(r, 150));

      const validatedResult: DocumentAnalysisResult = analyzeData.analysis;
      if (analyzeData.access) {
        setAccessStatus(analyzeData.access);
      }

      setAnalysisCache((prev) => ({
        ...prev,
        [cacheKey]: validatedResult,
      }));
      setCurrentResult(validatedResult);
      setStage(AnalyzerStage.COMPLETE);
    } catch (err: any) {
      setStage(AnalyzerStage.ERROR);
      setErrorPayload({
        code: 'GEMINI_ANALYSIS_FAILED',
        stage: AnalyzerStage.ANALYZING,
        message: err?.message || 'Unexpected network failure during Gemini analysis.',
        remediation: 'Retry the analysis. No usage credit was deducted.',
        timestamp: new Date().toISOString(),
      });
    }
  };

  const handleLedgerControl = async (
    action:
      | 'toggle_supabase_outage'
      | 'exhaust_free_allowance'
      | 'reset_free_allowance'
      | 'activate_paid_session'
  ) => {
    if (!currentUser?.idToken) return;
    const res = await fetch('/api/analyzer/ledger-control', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentUser.idToken}`,
      },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (data.accessCheck) {
      setAccessStatus(data.accessCheck);
      setErrorPayload(null);
    } else if (data.accessError) {
      setAccessStatus(null);
      setErrorPayload(data.accessError);
    }
    if (data.ledger) {
      setLedgerSummary({
        freeRemaining: Math.max(0, data.ledger.freeAllowanceTotal - data.ledger.freeAllowanceUsed),
        freeTotal: data.ledger.freeAllowanceTotal,
        paidRemaining: data.ledger.paidRemaining,
      });
    }
    await fetchServerDiagnostics();
  };

  // Jump to specific citation in document viewer
  const handleJumpToCitation = (page: string, paragraph: string) => {
    setActiveCitationTarget({ page, paragraph });
    // If not in split view, switch to split view so the user sees the side-by-side text
    if (activeNav !== 'split') {
      setActiveNav('split');
    }
    // Smooth scroll to the target element if in DOM
    setTimeout(() => {
      const el = document.getElementById(`doc-para-${page}-${paragraph}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150);
  };

  const isBusy =
    stage === AnalyzerStage.UPLOADING ||
    stage === AnalyzerStage.AUTHENTICATING ||
    stage === AnalyzerStage.EXTRACTING ||
    stage === AnalyzerStage.VERIFYING_ACCESS ||
    stage === AnalyzerStage.ANALYZING ||
    stage === AnalyzerStage.VALIDATING ||
    stage === AnalyzerStage.SAVING;

  const otherMode: AnalysisMode = selectedMode === 'quick' ? 'forensic' : 'quick';
  const hasCachedOtherMode = Boolean(
    extractedDoc && analysisCache[`${extractedDoc.sha256Hash}:${otherMode}`]
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF8F5] text-[#14181F]">
      {/* 1-ROW, 3-ZONE TOP BAR CONTRACT */}
      <header className="bg-white border-b border-slate-200/90 px-6 py-4 sticky top-0 z-30 shadow-xs">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between gap-6">
          {/* Zone 1: Single text element wordmark */}
          <a
            href="#analyzer"
            onClick={(e) => {
              e.preventDefault();
              setActiveNav('analyzer');
            }}
            className="text-2xl font-normal tracking-tight text-slate-900 font-editorial whitespace-nowrap shrink-0"
          >
            CYFSA Navigator
          </a>

          {/* Zone 2: 4 Single-line Nav Links */}
          <nav className="flex items-center gap-6 text-sm">
            <button
              type="button"
              onClick={() => setActiveNav('analyzer')}
              className={`py-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                activeNav === 'analyzer'
                  ? 'text-slate-900 font-semibold border-b-2 border-[#1E3A5F]'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Document Analyzer
            </button>
            <button
              type="button"
              onClick={() => setActiveNav('split')}
              className={`py-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeNav === 'split'
                  ? 'text-slate-900 font-semibold border-b-2 border-[#1E3A5F]'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Split className="w-3.5 h-3.5" />
              <span>Split Forensics Workspace</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveNav('audit')}
              className={`py-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                activeNav === 'audit'
                  ? 'text-slate-900 font-semibold border-b-2 border-[#1E3A5F]'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Migration Audit
            </button>
            <button
              type="button"
              onClick={() => setActiveNav('config')}
              className={`py-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                activeNav === 'config'
                  ? 'text-slate-900 font-semibold border-b-2 border-[#1E3A5F]'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Config & Ledger
            </button>
          </nav>

          {/* Zone 3: 1-2 Primary Actions */}
          <div className="flex items-center gap-3 shrink-0">
            {currentUser ? (
              <>
                <span className="hidden sm:inline text-xs text-slate-600 font-mono truncate max-w-[200px]">
                  {currentUser.email} · {accessStatus?.source ? accessStatus.source.toUpperCase() : currentUser.tier.toUpperCase()}
                </span>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Sign Out
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={authLoading}
                onClick={handleGoogleSignIn}
                className="px-4 py-2 text-xs font-medium text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs flex items-center gap-1.5"
              >
                <span>Sign In with Google</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* MAIN WORKSPACE */}
      <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-8 space-y-8">
        {/* VIEW 1 & 2: DOCUMENT ANALYZER OR SPLIT FORENSICS WORKSPACE */}
        {(activeNav === 'analyzer' || activeNav === 'split') && (
          <>
            {/* Top Control Card */}
            <section className="bg-white border border-slate-200/90 rounded-lg p-6 space-y-6 shadow-xs">
              <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 pb-6 border-b border-slate-200/80">
                <div className="max-w-2xl">
                  <p className="text-xs text-slate-500 font-mono">
                    Ontario Child, Youth and Family Services Act (CYFSA) · Production Analyzer Pipeline
                  </p>
                  <h1 className="mt-1 text-3xl sm:text-4xl font-normal text-slate-900 tracking-tight font-editorial">
                    {activeNav === 'split' ? 'Split-Screen Forensics Workspace' : 'Evidentiary & Structural Document Analyzer'}
                  </h1>
                  <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                    Extract once and run either <strong>Quick Document Review</strong> or{' '}
                    <strong>Forensic In-Depth Analysis</strong> with verbatim source traceability, 8-tier evidentiary classification, and interactive citation jumping.
                  </p>
                </div>

                <div className="text-xs text-slate-600 space-y-1 shrink-0 lg:text-right font-mono tabular-nums">
                  <div>
                    Auth Status:{' '}
                    <strong className={currentUser ? 'text-[#166534]' : 'text-[#991B1B]'}>
                      {currentUser ? `VERIFIED (${currentUser.uid})` : 'UNAUTHENTICATED'}
                    </strong>
                  </div>
                  <div>
                    Access Eligibility:{' '}
                    <strong className={accessStatus?.allowed ? 'text-[#166534]' : 'text-[#9A5B13]'}>
                      {accessStatus
                        ? `ALLOWED=${String(accessStatus.allowed).toUpperCase()} · SOURCE=${accessStatus.source.toUpperCase()}`
                        : 'PENDING CHECK'}
                    </strong>
                  </div>
                  {accessStatus && (
                    <div className="text-slate-500">
                      free_usage: {accessStatus.remainingFreeAllowance ?? 0} · paid_sessions:{' '}
                      {accessStatus.paidSessionCreditsRemaining ?? 0}
                    </div>
                  )}
                </div>
              </div>

              {/* 10-Stage Pipeline Tracker */}
              <div>
                <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
                  <span className="font-medium text-slate-700">
                    Active Pipeline Stage:{' '}
                    <strong className="font-mono text-[#1E3A5F]">{stage}</strong>
                  </span>
                  {extractedDoc && (
                    <span className="font-mono text-slate-600">
                      Active Document: {extractedDoc.fileName} ({extractedDoc.pageCount} pages ·{' '}
                      {extractedDoc.paragraphCount} paragraphs · {extractedDoc.wordCount} words)
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-9 gap-1.5">
                  {PIPELINE_STAGES_ORDER.map((s) => {
                    const currentIdx = PIPELINE_STAGES_ORDER.indexOf(stage);
                    const thisIdx = PIPELINE_STAGES_ORDER.indexOf(s);
                    const isErrorStage = stage === AnalyzerStage.ERROR && errorPayload?.stage === s;
                    const isActive = stage === s;
                    const isCompleted =
                      stage === AnalyzerStage.COMPLETE ||
                      (currentIdx > thisIdx && stage !== AnalyzerStage.ERROR);

                    return (
                      <div
                        key={s}
                        className={`px-2.5 py-2 rounded text-[11px] font-mono text-center border transition-colors ${
                          isErrorStage
                            ? 'bg-[#FEF2F2] border-[#991B1B] text-[#991B1B] font-semibold'
                            : isActive
                            ? 'bg-[#1E3A5F] border-[#1E3A5F] text-white font-semibold'
                            : isCompleted
                            ? 'bg-slate-100 border-slate-300 text-slate-800'
                            : 'bg-slate-50/70 border-slate-200/70 text-slate-400'
                        }`}
                      >
                        {s}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Error Banner */}
              {errorPayload && (
                <div className="p-4 rounded-md bg-[#FEF2F2] border border-[#991B1B]/30 text-sm text-[#991B1B] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 font-mono text-xs font-semibold">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>
                        STAGE: {errorPayload.stage} · CODE: {errorPayload.code}
                      </span>
                    </div>
                    <p className="font-medium text-slate-900">{errorPayload.message}</p>
                    <p className="text-xs text-slate-700">
                      <strong>Remediation:</strong> {errorPayload.remediation}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {errorPayload.code === 'SIGN_IN_REQUIRED' && (
                      <button
                        type="button"
                        onClick={() => establishFirebaseSession('free')}
                        className="px-3.5 py-2 bg-[#1E3A5F] text-white text-xs font-medium rounded-md cursor-pointer"
                      >
                        Sign In Now
                      </button>
                    )}
                    {errorPayload.code === 'USAGE_SERVICE_TEMPORARILY_UNAVAILABLE' && (
                      <button
                        type="button"
                        onClick={() => handleLedgerControl('toggle_supabase_outage')}
                        className="px-3.5 py-2 bg-[#1E3A5F] text-white text-xs font-medium rounded-md cursor-pointer"
                      >
                        Restore Connection
                      </button>
                    )}
                    {errorPayload.code === 'ACCESS_DENIED_NO_CREDITS' && (
                      <button
                        type="button"
                        onClick={() => handleLedgerControl('activate_paid_session')}
                        className="px-3.5 py-2 bg-[#1E3A5F] text-white text-xs font-medium rounded-md cursor-pointer"
                      >
                        Activate Paid Session (+10 Credits)
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRunAnalysis(selectedMode)}
                      className="px-3.5 py-2 bg-white border border-slate-300 text-slate-800 text-xs font-medium rounded-md hover:bg-slate-50 cursor-pointer"
                    >
                      Retry Pipeline
                    </button>
                  </div>
                </div>
              )}

              {/* Intake & Mode Bar */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
                <div className="lg:col-span-7 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-slate-900">
                      1. Document Intake & Single-Pass Extraction
                    </h2>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.docx,.txt,image/png,image/jpeg,image/webp"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium rounded-md flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Upload PDF / DOCX / TXT / Image</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5">
                    {SAMPLE_CYFSA_DOCUMENTS.map((doc) => {
                      const isSelected = selectedSampleId === doc.id;
                      return (
                        <div
                          key={doc.id}
                          onClick={() => {
                            if (!isBusy) handleExtractSampleDocument(doc);
                          }}
                          className={`p-3 rounded-md border transition-colors cursor-pointer ${
                            isSelected
                              ? 'border-[#1E3A5F] bg-[#FAF8F5]'
                              : 'border-slate-200 hover:border-slate-300 bg-white'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-slate-900">
                              {doc.title}
                            </span>
                            <span className="text-[11px] font-mono text-slate-500 shrink-0">
                              {doc.badgeText}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                            {doc.description}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="lg:col-span-5 flex flex-col justify-between p-5 rounded-md bg-[#FAF8F5] border border-slate-200/90 space-y-5">
                  <div className="space-y-4">
                    <h2 className="text-base font-semibold text-slate-900">
                      2. Select Analysis Depth
                    </h2>

                    <div className="space-y-2.5">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          setSelectedMode('quick');
                          if (extractedDoc && analysisCache[`${extractedDoc.sha256Hash}:quick`]) {
                            setCurrentResult(analysisCache[`${extractedDoc.sha256Hash}:quick`]);
                            setStage(AnalyzerStage.COMPLETE);
                          }
                        }}
                        className={`w-full text-left p-3.5 rounded-md border transition-colors cursor-pointer ${
                          selectedMode === 'quick'
                            ? 'bg-white border-[#1E3A5F] shadow-xs'
                            : 'bg-white/60 border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-slate-900">
                            Mode 1: Quick Document Review
                          </span>
                          <span className="text-xs font-mono text-[#1E3A5F]">14 Sections</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                          Rapid structured review for Overview, Dates, Parties, Claims, Strengths, Weaknesses, Contradictions, and Steps.
                        </p>
                      </button>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          setSelectedMode('forensic');
                          if (extractedDoc && analysisCache[`${extractedDoc.sha256Hash}:forensic`]) {
                            setCurrentResult(analysisCache[`${extractedDoc.sha256Hash}:forensic`]);
                            setStage(AnalyzerStage.COMPLETE);
                          }
                        }}
                        className={`w-full text-left p-3.5 rounded-md border transition-colors cursor-pointer ${
                          selectedMode === 'forensic'
                            ? 'bg-white border-[#1E3A5F] shadow-xs'
                            : 'bg-white/60 border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-slate-900">
                            Mode 2: Forensic In-Depth Analysis
                          </span>
                          <span className="text-xs font-mono text-[#1E3A5F]">25 Sections</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                          Comprehensive audit: Document Structure, Sources, Corroboration, Multi-Layer Hearsay, Inference, CYFSA Legal Issue Spotting, and Evidence Matrix.
                        </p>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2.5 pt-2 border-t border-slate-200/80">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleRunAnalysis(selectedMode)}
                      className="w-full py-3 px-4 bg-[#1E3A5F] hover:bg-[#162C49] disabled:opacity-50 text-white text-sm font-medium rounded-md flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs"
                    >
                      {isBusy ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Running Stage: {stage}…</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4" />
                          <span>
                            {selectedMode === 'forensic'
                              ? 'Start Forensic In-Depth Analysis'
                              : 'Start Quick Document Review'}
                          </span>
                        </>
                      )}
                    </button>

                    <p className="text-[11px] text-slate-500 text-center">
                      Reuses extracted document without re-uploading when switching modes.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* RESULTS RENDERING: SPLIT WORKSPACE OR FULL DOSSIER */}
            {currentResult && (
              <>
                {activeNav === 'split' && extractedDoc ? (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                    {/* Left Pane: Interactive Document Record */}
                    <div className="lg:col-span-5 h-[800px] sticky top-24">
                      <DocumentViewerPane
                        document={extractedDoc}
                        activeCitationTarget={activeCitationTarget}
                        onClearCitationTarget={() => setActiveCitationTarget(null)}
                      />
                    </div>

                    {/* Right Pane: Analytical Findings Dossier */}
                    <div className="lg:col-span-7">
                      <AnalysisReportView
                        result={currentResult}
                        onRunOtherMode={(targetMode) => handleRunAnalysis(targetMode)}
                        hasCachedOtherMode={hasCachedOtherMode}
                        isBusy={isBusy}
                        onJumpToCitation={handleJumpToCitation}
                      />
                    </div>
                  </div>
                ) : (
                  <AnalysisReportView
                    result={currentResult}
                    onRunOtherMode={(targetMode) => handleRunAnalysis(targetMode)}
                    hasCachedOtherMode={hasCachedOtherMode}
                    isBusy={isBusy}
                    onJumpToCitation={handleJumpToCitation}
                  />
                )}
              </>
            )}
          </>
        )}

        {/* VIEW 3: MIGRATION AUDIT */}
        {activeNav === 'audit' && <MigrationAuditView />}

        {/* VIEW 4: CONFIG & LEDGER */}
        {activeNav === 'config' && (
          <div className="space-y-8">
            <section className="bg-white border border-slate-200/90 rounded-lg p-6 space-y-6 shadow-xs">
              <div>
                <h2 className="text-2xl font-normal text-slate-900 font-editorial">
                  Supabase Usage Ledger & Fail-Closed Verification Console
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Inspect and test deterministic Supabase credential resolution, idempotent credit consumption (`free_usage` and `navigator_paid_sessions`), and fail-closed `USAGE_SERVICE_TEMPORARILY_UNAVAILABLE` protection.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-4 rounded-md bg-slate-900 text-slate-100 font-mono text-xs space-y-2">
                  <div className="text-slate-400">
                    // Live /api/analyzer/access Response Payload
                  </div>
                  <pre className="overflow-x-auto leading-relaxed">
                    {JSON.stringify(
                      accessStatus ||
                        errorPayload || {
                          allowed: false,
                          reason: 'Sign in required',
                          source: 'none',
                        },
                      null,
                      2
                    )}
                  </pre>
                </div>

                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Test Access & Fail-Closed Scenarios
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => handleLedgerControl('reset_free_allowance')}
                      className="p-3 text-left border border-slate-200 rounded-md hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <span className="text-xs font-semibold text-[#166534] block">
                        Reset free_usage Allowance
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Restores 3/3 free analyses (source: "free")
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleLedgerControl('activate_paid_session')}
                      className="p-3 text-left border border-slate-200 rounded-md hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <span className="text-xs font-semibold text-[#1E3A5F] block">
                        Activate navigator_paid_sessions
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Grants 10 paid session credits (source: "paid")
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleLedgerControl('exhaust_free_allowance')}
                      className="p-3 text-left border border-slate-200 rounded-md hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <span className="text-xs font-semibold text-[#9A5B13] block">
                        Simulate Zero Remaining Credits
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Sets allowed: false, source: "none"
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleLedgerControl('toggle_supabase_outage')}
                      className="p-3 text-left border border-slate-200 rounded-md hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <span className="text-xs font-semibold text-[#991B1B] block">
                        {diagnostics?.simulateSupabaseOutage
                          ? 'Restore Supabase Connection'
                          : 'Simulate Supabase Outage (Fail-Closed)'}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Verifies USAGE_SERVICE_TEMPORARILY_UNAVAILABLE
                      </span>
                    </button>
                  </div>

                  {diagnostics && (
                    <div className="p-3.5 rounded-md bg-[#FAF8F5] border border-slate-200 text-xs font-mono space-y-1">
                      <div>
                        Target Supabase Host: <strong>{diagnostics.supabaseTargetHost}</strong>
                      </div>
                      <div>
                        Verified Project Ref: <strong>{diagnostics.supabaseProjectRef}</strong>
                      </div>
                      <div>
                        Credential Role: <strong>{diagnostics.supabaseCredentialRole}</strong>
                      </div>
                      <div>
                        Firebase Project ID: <strong>{diagnostics.firebaseProjectId}</strong>
                      </div>
                      <div>
                        Gemini Server SDK: <strong>{diagnostics.geminiSdk} ({diagnostics.geminiModel})</strong>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>
        )}
      </main>

      {/* QUIET EDITORIAL FOOTER */}
      <footer className="bg-white border-t border-slate-200/80 py-6 px-6 mt-12">
        <div className="max-w-[1400px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div>
            CYFSA Navigator · Ontario Child, Youth and Family Services Act Educational Document Analyzer
          </div>
          <div>
            Not legal advice or a certified forensic examination · Verify current statutory and court requirements
          </div>
        </div>
      </footer>
    </div>
  );
}
