export type MigrationAction =
  | 'KEEP CURRENT'
  | 'TRANSPLANT KNOWN-GOOD'
  | 'MERGE'
  | 'REPLACE'
  | 'REMOVE OBSOLETE CODE';

export interface MigrationMatrixRow {
  id: number;
  component: string;
  knownGoodImplementation: string;
  currentImplementation: string;
  difference: string;
  contributesToFailure: boolean;
  action: MigrationAction;
  reconciliationDetail: string;
}

export interface EnvVariableMappingRow {
  knownGoodVar: string;
  currentVar: string;
  serviceBelongsTo: string;
  requiredRuntime: 'Production + Preview + Local Dev' | 'Production + Preview' | 'Build + Client Bundle';
  scope: 'SERVER ONLY' | 'CLIENT (PUBLIC)';
  status: 'PRESENT / RECONCILED' | 'MAPPED TO AUTHORITATIVE' | 'DEPRECATED / REMOVED';
  resolutionRule: string;
}

export interface SampleCyfsaDocument {
  id: string;
  title: string;
  documentType: string;
  fileName: string;
  description: string;
  badgeText: string;
  content: string;
}

export const WORKING_REQUEST_PATH = [
  {
    step: 1,
    stage: 'BROWSER',
    title: 'Client Workspace Initialization',
    detail: 'Loads CYFSA Navigator SPA, initializes Firebase session listener, and prepares reusable extraction state store.',
  },
  {
    step: 2,
    stage: 'AUTH',
    title: 'Firebase ID Token Acquisition',
    detail: 'Obtains signed Firebase ID token via user.getIdToken() and attaches Authorization: Bearer <token> to protected API requests.',
  },
  {
    step: 3,
    stage: 'UPLOAD',
    title: 'Document Intake (PDF / DOCX / TXT / OCR)',
    detail: 'Validates MIME type, file extension, and byte size before streaming payload to the extraction pipeline.',
  },
  {
    step: 4,
    stage: 'EXTRACTION',
    title: 'Single-Pass Structured Extraction',
    detail: 'Extracts text once, generates SHA-256 document hash, indexes [Page X, Para Y] anchors, and caches payload for mode switching.',
  },
  {
    step: 5,
    stage: 'ACCESS',
    title: 'Deterministic Supabase Eligibility Check',
    detail: 'Verifies server-side Firebase UID against free_usage and navigator_paid_sessions using project-matched service credential.',
  },
  {
    step: 6,
    stage: 'ANALYZE API',
    title: 'Protected Server Endpoint (/api/analyzer/analyze)',
    detail: 'Creates idempotent analysis request record keyed by (uid + documentHash + mode) without pre-deducting credit.',
  },
  {
    step: 7,
    stage: 'GEMINI',
    title: 'Server-Side @google/genai Execution',
    detail: 'Invokes gemini-3.8-flash with strict JSON responseSchema, Ontario CYFSA forensic system prompt, and timeout/retry guards.',
  },
  {
    step: 8,
    stage: 'VALIDATION',
    title: 'Schema Validation & Defensive Normalization',
    detail: 'Validates JSON output, enforces source traceability fallbacks, and normalizes all 8 evidence classifications.',
  },
  {
    step: 9,
    stage: 'RESPONSE',
    title: 'Idempotent Usage Finalization & HTTP 200 Payload',
    detail: 'Commits credit consumption to Supabase ledger only after valid schema completion and returns normalized result.',
  },
  {
    step: 10,
    stage: 'FRONTEND',
    title: 'Stage Transition to COMPLETE',
    detail: 'Updates React state machine (SAVING → COMPLETE) without full page reload and preserves extracted payload in memory.',
  },
  {
    step: 11,
    stage: 'RESULTS',
    title: 'Traceable Report & Instant Mode Upgrade',
    detail: 'Renders Quick Review or Forensic In-Depth tabs; switching modes reuses extracted document without re-uploading.',
  },
];

export const MIGRATION_MATRIX: MigrationMatrixRow[] = [
  {
    id: 1,
    component: '1. Analyzer Frontend Component(s)',
    knownGoodImplementation: 'Single cohesive DocumentAnalyzerView with unified stage machine and cached extraction state.',
    currentImplementation: 'Fragmented multi-component stubs with disconnected state hooks and legacy experimental modal.',
    difference: 'Current project split upload state from analysis state, losing extracted text on mode switch.',
    contributesToFailure: true,
    action: 'MERGE',
    reconciliationDetail: 'Preserve current CYFSA Navigator design language while transplanting the unified state machine from Known-Good.',
  },
  {
    id: 2,
    component: '2. Upload Implementation',
    knownGoodImplementation: 'Multipart/base64 file reader supporting PDF, DOCX, TXT with strict pre-flight size and extension checks.',
    currentImplementation: 'Raw File input that cleared buffer after first API dispatch.',
    difference: 'Current implementation discarded file buffer immediately after initial Quick Review.',
    contributesToFailure: true,
    action: 'TRANSPLANT KNOWN-GOOD',
    reconciliationDetail: 'Retain uploaded metadata and reusable ExtractedDocumentPayload across mode switches.',
  },
  {
    id: 3,
    component: '3. Extraction Implementation',
    knownGoodImplementation: 'Page/paragraph-indexed extractor (mammoth for DOCX, PDF page parser + Gemini multimodal OCR fallback).',
    currentImplementation: 'Incomplete client-side text reader that failed on binary DOCX/PDF streams and lacked paragraph markers.',
    difference: 'Current extractor sent raw binary or unindexed blobs to Gemini, breaking source location traceability.',
    contributesToFailure: true,
    action: 'TRANSPLANT KNOWN-GOOD',
    reconciliationDetail: 'Use server-backed single-pass extraction returning [Page X, Para Y] structured sections and SHA-256 hash.',
  },
  {
    id: 4,
    component: '4. API Routes',
    knownGoodImplementation: 'Dedicated /api/analyzer/extract, /api/analyzer/access, and /api/analyzer/analyze routes.',
    currentImplementation: 'Competing /api/analyze-v1, /api/analyze-v2, and client-side direct calls.',
    difference: 'Route drift caused frontend to hit deprecated route lacking schema normalization.',
    contributesToFailure: true,
    action: 'REPLACE',
    reconciliationDetail: 'Consolidate into one authoritative /api/analyzer/* pipeline and remove obsolete experimental routes.',
  },
  {
    id: 5,
    component: '5. Authentication Flow',
    knownGoodImplementation: 'Firebase Google Sign-In + authenticated session context with automatic token refresh.',
    currentImplementation: 'Firebase Auth initialized on current cyfsanavigator.com project.',
    difference: 'Current Firebase project is authoritative; only token propagation to analyzer API was inconsistent.',
    contributesToFailure: false,
    action: 'KEEP CURRENT',
    reconciliationDetail: 'Keep authoritative CYFSA Navigator Firebase Auth identity provider and session persistence.',
  },
  {
    id: 6,
    component: '6. Firebase Token Handling',
    knownGoodImplementation: 'Always calls await currentUser.getIdToken() before protected requests and sends Authorization: Bearer.',
    currentImplementation: 'Sent user.uid in JSON request body without Bearer header in one codepath.',
    difference: 'Missing Authorization header caused 401 or insecure UID handling.',
    contributesToFailure: true,
    action: 'TRANSPLANT KNOWN-GOOD',
    reconciliationDetail: 'Enforce Bearer ID token header on every /api/analyzer/* request.',
  },
  {
    id: 7,
    component: '7. Backend Firebase Verification',
    knownGoodImplementation: 'Server-side token verification extracting verified uid and rejecting unauthenticated requests with 401 SIGN_IN_REQUIRED.',
    currentImplementation: 'Trusted client-supplied body.uid or failed when admin cert env format differed.',
    difference: 'Security & reliability defect in current backend verification middleware.',
    contributesToFailure: true,
    action: 'TRANSPLANT KNOWN-GOOD',
    reconciliationDetail: 'Verify Bearer token server-side, bind exclusively to verified UID, and return HTTP 401 SIGN_IN_REQUIRED on failure.',
  },
  {
    id: 8,
    component: '8. Supabase Client Initialization',
    knownGoodImplementation: 'Server-only Supabase admin client with explicit project-ref validation.',
    currentImplementation: 'Fallback chain keyA || keyB || keyC mixing anon key and stale service role key.',
    difference: 'Fallback chain selected a service key belonging to an old Supabase project ref, causing Invalid API key / 401 errors.',
    contributesToFailure: true,
    action: 'REPLACE',
    reconciliationDetail: 'Implement deterministic credential resolution verifying JWT ref matches SUPABASE_URL host before initialization.',
  },
  {
    id: 9,
    component: '9. Supabase Project Targeting',
    knownGoodImplementation: 'Targeted legacy prototype Supabase instance.',
    currentImplementation: 'Targets authoritative CYFSA Navigator production Supabase PostgreSQL database.',
    difference: 'Current Supabase database holds production free_usage and navigator_paid_sessions tables.',
    contributesToFailure: false,
    action: 'KEEP CURRENT',
    reconciliationDetail: 'Keep current production SUPABASE_URL and schema; never point back to legacy database.',
  },
  {
    id: 10,
    component: '10. Usage / Access Verification',
    knownGoodImplementation: 'Structured { allowed, reason, source } check against free_usage and navigator_paid_sessions.',
    currentImplementation: 'Silent catch block that either bypassed or threw generic 500 when Supabase timed out.',
    difference: 'Violated fail-closed policy and obscured USAGE_SERVICE_TEMPORARILY_UNAVAILABLE errors.',
    contributesToFailure: true,
    action: 'MERGE',
    reconciliationDetail: 'Query authoritative free_usage and navigator_paid_sessions tables and fail closed with USAGE_SERVICE_TEMPORARILY_UNAVAILABLE.',
  },
  {
    id: 11,
    component: '11. Analysis-Credit Handling',
    knownGoodImplementation: 'Post-validation idempotent credit deduction keyed by uid + documentHash + mode.',
    currentImplementation: 'Pre-analysis credit decrement before calling Gemini.',
    difference: 'Users lost credits when Gemini timed out or when retrying failed requests.',
    contributesToFailure: true,
    action: 'TRANSPLANT KNOWN-GOOD',
    reconciliationDetail: 'Charge allowance only in SAVING stage after validated Gemini output; deduplicate retries via idempotency key.',
  },
  {
    id: 12,
    component: '12. Gemini Initialization',
    knownGoodImplementation: 'Server-side new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) with User-Agent telemetry.',
    currentImplementation: 'Mixed legacy GoogleGenerativeAI client and browser-side key reference.',
    difference: 'Legacy SDK initialization caused runtime method errors.',
    contributesToFailure: true,
    action: 'REPLACE',
    reconciliationDetail: 'Standardize on server-side @google/genai new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }).',
  },
  {
    id: 13,
    component: '13. Gemini SDK / Version',
    knownGoodImplementation: '@google/genai ^2.4.0 using ai.models.generateContent.',
    currentImplementation: 'Mixed deprecated @google/generative-ai patterns (getGenerativeModel / response.text()).',
    difference: 'Calling response.text() as a function instead of property response.text threw TypeError.',
    contributesToFailure: true,
    action: 'REPLACE',
    reconciliationDetail: 'Use @google/genai ^2.4.0 exclusively on the server and read response.text property.',
  },
  {
    id: 14,
    component: '14. Gemini Model Configuration',
    knownGoodImplementation: 'Configured valid current flash model with responseMimeType: "application/json" and responseSchema.',
    currentImplementation: 'Referenced retired gemini-1.5-flash / gemini-2.0-flash strings causing 404 Model Not Found.',
    difference: 'Deprecated model strings caused immediate 404 failures from Google API.',
    contributesToFailure: true,
    action: 'REPLACE',
    reconciliationDetail: 'Use gemini-3.8-flash with structured responseSchema.',
  },
  {
    id: 15,
    component: '15. Gemini Prompt',
    knownGoodImplementation: 'Domain-specific Ontario CYFSA analytical prompt enforcing evidentiary humility, source quotes, and non-fabrication.',
    currentImplementation: 'Short generic legal summarization prompt.',
    difference: 'Generic prompt omitted evidence classification reasoning and conflated missing support in document with no evidence existing.',
    contributesToFailure: true,
    action: 'TRANSPLANT KNOWN-GOOD',
    reconciliationDetail: 'Transplant full Ontario CYFSA Quick Review and Forensic In-Depth prompts with strict non-fabrication guardrails.',
  },
  {
    id: 16,
    component: '16. JSON Response Format',
    knownGoodImplementation: 'Strict Type.OBJECT responseSchema enforced by @google/genai.',
    currentImplementation: 'Freeform markdown with ```json fences.',
    difference: 'Markdown preambles frequently broke JSON.parse().',
    contributesToFailure: true,
    action: 'TRANSPLANT KNOWN-GOOD',
    reconciliationDetail: 'Enforce responseMimeType: "application/json" and explicit responseSchema.',
  },
  {
    id: 17,
    component: '17. JSON Parsing',
    knownGoodImplementation: 'Defensive parser stripping optional fences, repairing trailing commas, and reporting VALIDATING stage errors.',
    currentImplementation: 'Unwrapped JSON.parse(text) without try/catch stage context.',
    difference: 'Unhandled syntax errors crashed the route with generic 500.',
    contributesToFailure: true,
    action: 'TRANSPLANT KNOWN-GOOD',
    reconciliationDetail: 'Use defensive safeParseAnalysisJson with explicit VALIDATION_FAILED stage reporting.',
  },
  {
    id: 18,
    component: '18. Analysis Schema',
    knownGoodImplementation: 'Complete 14-section Quick Review schema + 11-section Forensic In-Depth extension.',
    currentImplementation: 'Partial 5-field summary object.',
    difference: 'Missing claims array, evidence classification enum, and sourceLocation objects.',
    contributesToFailure: true,
    action: 'TRANSPLANT KNOWN-GOOD',
    reconciliationDetail: 'Restore full Quick Review and Forensic In-Depth TypeScript & Gemini schemas.',
  },
  {
    id: 19,
    component: '19. Normalization',
    knownGoodImplementation: 'Post-parse normalizer ensuring every array, claim, classification, and sourceLocation has safe defaults.',
    currentImplementation: 'Passed raw parsed JSON directly to frontend.',
    difference: 'Undefined nested arrays caused React rendering crashes (.map of undefined).',
    contributesToFailure: true,
    action: 'TRANSPLANT KNOWN-GOOD',
    reconciliationDetail: 'Run normalizeAnalysisResult() on all Gemini outputs prior to SAVING stage.',
  },
  {
    id: 20,
    component: '20. Retry Logic',
    knownGoodImplementation: 'Bounded retry (max 2 retries with exponential jitter) for transient 429/503 Gemini errors.',
    currentImplementation: 'No retry on transient network blips.',
    difference: 'Single transient spike aborted long forensic analyses.',
    contributesToFailure: true,
    action: 'TRANSPLANT KNOWN-GOOD',
    reconciliationDetail: 'Implement bounded retry wrapper that never double-charges user credits.',
  },
  {
    id: 21,
    component: '21. Timeout Logic',
    knownGoodImplementation: 'AbortController timeout guard returning structured GEMINI_TIMEOUT error.',
    currentImplementation: 'Unbounded promise hanging until serverless function hard-killed.',
    difference: 'Left frontend spinner stuck indefinitely in ANALYZING state.',
    contributesToFailure: true,
    action: 'TRANSPLANT KNOWN-GOOD',
    reconciliationDetail: 'Enforce explicit server timeout with structured GEMINI_TIMEOUT response.',
  },
  {
    id: 22,
    component: '22. Error Handling',
    knownGoodImplementation: 'Stage-tagged error contract { code, stage, message, remediation }.',
    currentImplementation: 'Generic error.message strings.',
    difference: 'Users could not tell if failure occurred in AUTHENTICATING, EXTRACTING, VERIFYING_ACCESS, or ANALYZING.',
    contributesToFailure: true,
    action: 'TRANSPLANT KNOWN-GOOD',
    reconciliationDetail: 'Standardize all errors onto AnalyzerErrorPayload mapped to exact pipeline stages.',
  },
  {
    id: 23,
    component: '23. Frontend State Management',
    knownGoodImplementation: 'Deterministic 10-stage state machine preserving extractedDocument across mode toggles.',
    currentImplementation: 'Ad-hoc boolean flags (isLoading, isError) that reset document on error or mode change.',
    difference: 'Switching Quick → Forensic forced user to re-upload the file.',
    contributesToFailure: true,
    action: 'TRANSPLANT KNOWN-GOOD',
    reconciliationDetail: 'Maintain extractedDocument and per-mode result cache in top-level analyzer state.',
  },
  {
    id: 24,
    component: '24. Result Rendering',
    knownGoodImplementation: 'Structured dossier view with filterable claims, source location citations, and evidence badges.',
    currentImplementation: 'Incomplete accordion missing forensic sections.',
    difference: 'Forensic In-Depth fields were never rendered even when returned.',
    contributesToFailure: true,
    action: 'MERGE',
    reconciliationDetail: 'Combine clean editorial legal typography with comprehensive Quick & Forensic dossier rendering.',
  },
  {
    id: 25,
    component: '25. Package Versions',
    knownGoodImplementation: 'React 19, @google/genai ^2.4.0, mammoth, Express 4, Vite.',
    currentImplementation: 'Compatible modern Vite + React 19 stack.',
    difference: 'Added mammoth for server-side DOCX extraction.',
    contributesToFailure: false,
    action: 'KEEP CURRENT',
    reconciliationDetail: 'Keep current package versions with mammoth added for DOCX support.',
  },
  {
    id: 26,
    component: '26. Vercel / Runtime Configuration',
    knownGoodImplementation: 'Node.js runtime with sufficient body limit (15MB) for uploaded PDFs/DOCX.',
    currentImplementation: 'Default 100kb JSON parser limit on Express/serverless route.',
    difference: 'Multi-page PDFs/DOCX failed with HTTP 413 Payload Too Large.',
    contributesToFailure: true,
    action: 'TRANSPLANT KNOWN-GOOD',
    reconciliationDetail: 'Configure express.json({ limit: "25mb" }) to support full legal affidavits and reports.',
  },
  {
    id: 27,
    component: '27. Environment-Variable NAMES',
    knownGoodImplementation: 'Used GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FIREBASE_PROJECT_ID.',
    currentImplementation: 'Had conflicting VITE_GEMINI_KEY, OLD_SUPABASE_KEY, SUPABASE_SECRET_KEY aliases.',
    difference: 'Mismatched env names caused undefined Gemini key or stale Supabase key selection.',
    contributesToFailure: true,
    action: 'REPLACE',
    reconciliationDetail: 'Standardize on authoritative server-only variable names and deterministic project verification.',
  },
  {
    id: 28,
    component: '28. Build Configuration',
    knownGoodImplementation: 'Vite SPA build + Express API server.',
    currentImplementation: 'Vite SPA build + Express API server.',
    difference: 'No structural build conflict.',
    contributesToFailure: false,
    action: 'KEEP CURRENT',
    reconciliationDetail: 'Preserve current Vite + tsx/Node server build configuration.',
  },
  {
    id: 29,
    component: '29. TypeScript Configuration',
    knownGoodImplementation: 'Strict shared interfaces between frontend and server.',
    currentImplementation: 'Loose any types in API handler.',
    difference: 'Allowed schema drift between backend normalizer and frontend renderer.',
    contributesToFailure: true,
    action: 'MERGE',
    reconciliationDetail: 'Share src/types/analyzer.ts across both server.ts and React components.',
  },
  {
    id: 30,
    component: '30. Working Verification Suite',
    knownGoodImplementation: 'Live end-to-end pipeline self-test verifying auth, extraction, access, and schema normalization.',
    currentImplementation: 'No automated pipeline diagnostic.',
    difference: 'Regressions went undetected until production deployment.',
    contributesToFailure: false,
    action: 'TRANSPLANT KNOWN-GOOD',
    reconciliationDetail: 'Include built-in Pipeline & Credential Diagnostic Inspector in the analyzer workspace.',
  },
];

export const ENV_RECONCILIATION_MATRIX: EnvVariableMappingRow[] = [
  {
    knownGoodVar: 'GEMINI_API_KEY',
    currentVar: 'GEMINI_API_KEY',
    serviceBelongsTo: 'Google Gemini API (@google/genai)',
    requiredRuntime: 'Production + Preview + Local Dev',
    scope: 'SERVER ONLY',
    status: 'PRESENT / RECONCILED',
    resolutionRule: 'Read exclusively on server via process.env.GEMINI_API_KEY. Never expose via VITE_ prefix.',
  },
  {
    knownGoodVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
    currentVar: 'GEMINI_API_KEY',
    serviceBelongsTo: 'Google Gemini API (Legacy Alias)',
    requiredRuntime: 'Production + Preview',
    scope: 'SERVER ONLY',
    status: 'MAPPED TO AUTHORITATIVE',
    resolutionRule: 'Consolidated into GEMINI_API_KEY to eliminate dual-key ambiguity.',
  },
  {
    knownGoodVar: 'VITE_GEMINI_API_KEY',
    currentVar: '(REMOVED — PROHIBITED)',
    serviceBelongsTo: 'Browser Bundle (Obsolete)',
    requiredRuntime: 'Build + Client Bundle',
    scope: 'SERVER ONLY',
    status: 'DEPRECATED / REMOVED',
    resolutionRule: 'Removed from client code so API credentials are never bundled into browser assets.',
  },
  {
    knownGoodVar: 'SUPABASE_URL',
    currentVar: 'SUPABASE_URL',
    serviceBelongsTo: 'Authoritative CYFSA Navigator Supabase Project',
    requiredRuntime: 'Production + Preview + Local Dev',
    scope: 'SERVER ONLY',
    status: 'PRESENT / RECONCILED',
    resolutionRule: 'Extracts authoritative project ref from hostname (https://<project-ref>.supabase.co).',
  },
  {
    knownGoodVar: 'SUPABASE_SERVICE_ROLE_KEY',
    currentVar: 'SUPABASE_SERVICE_ROLE_KEY',
    serviceBelongsTo: 'Authoritative CYFSA Navigator Supabase Project',
    requiredRuntime: 'Production + Preview + Local Dev',
    scope: 'SERVER ONLY',
    status: 'PRESENT / RECONCILED',
    resolutionRule: 'Deterministically verified against SUPABASE_URL project ref and role=service_role; never falls back to stale keys.',
  },
  {
    knownGoodVar: 'OLD_SUPABASE_SERVICE_KEY',
    currentVar: '(REJECTED BY PROJECT-REF GUARD)',
    serviceBelongsTo: 'Obsolete Prototype Supabase Project',
    requiredRuntime: 'Production + Preview',
    scope: 'SERVER ONLY',
    status: 'DEPRECATED / REMOVED',
    resolutionRule: 'Blocked by deterministic credential resolver; prevents cross-project 401 errors.',
  },
  {
    knownGoodVar: 'FIREBASE_PROJECT_ID',
    currentVar: 'FIREBASE_PROJECT_ID',
    serviceBelongsTo: 'CYFSA Navigator Firebase Authentication',
    requiredRuntime: 'Production + Preview + Local Dev',
    scope: 'SERVER ONLY',
    status: 'PRESENT / RECONCILED',
    resolutionRule: 'Verifies audience/issuer claims on incoming Bearer ID tokens on /api/analyzer/* routes.',
  },
  {
    knownGoodVar: 'VITE_FIREBASE_PROJECT_ID',
    currentVar: 'VITE_FIREBASE_PROJECT_ID',
    serviceBelongsTo: 'CYFSA Navigator Firebase Client SDK',
    requiredRuntime: 'Build + Client Bundle',
    scope: 'CLIENT (PUBLIC)',
    status: 'PRESENT / RECONCILED',
    resolutionRule: 'Public project identifier paired with Firebase Google Sign-In flow.',
  },
];

export const SAMPLE_CYFSA_DOCUMENTS: SampleCyfsaDocument[] = [
  {
    id: 'sample-protection-affidavit',
    title: 'Affidavit of Child Protection Worker (Protection Application)',
    documentType: 'Court Affidavit — Ontario Court of Justice (CYFSA)',
    fileName: 'Affidavit_Worker_M_vance_Oct2026.txt',
    badgeText: 'Affidavit · 3 Pages · Contested Claims & Hearsay',
    description:
      'Sworn worker affidavit containing mixed direct observations, unverified third-party school/neighbour reports, internal date discrepancies, and unsupported inferences.',
    content: `[PAGE 1]
ONTARIO COURT OF JUSTICE
IN THE MATTER OF THE CHILD, YOUTH AND FAMILY SERVICES ACT, 2017, S.O. 2017, c. 14, Sched. 1
AND IN THE MATTER OF A.R. (born May 14, 2019), a child under the age of eighteen years.

AFFIDAVIT OF MARCUS VANCE, CHILD PROTECTION WORKER
(Sworn October 1, 2026)

I, MARCUS VANCE, of the City of Hamilton, in the Province of Ontario, MAKE OATH AND SAY AS FOLLOWS:

1. I am a Child Protection Worker employed by the Children's Aid Society ("the Society") and have been assigned to the family of Elena Rostova ("the Mother") and David Rostov ("the Father") since September 12, 2026. As such, I have knowledge of the matters hereinafter deposed to, except where stated to be on information and belief.

2. SECTION A: REFERRAL AND INITIAL ALLEGATIONS
On September 9, 2026, the Society Intake Department received an anonymous telephone referral from an individual believed to be a neighbour in the apartment building. The caller stated that they heard "loud arguing and a door slamming" coming from Unit 402 at approximately 11:30 p.m. on September 8, 2026, and believed the parents were "chronically unstable and possibly misusing substances." The caller did not observe the child A.R. or enter the unit.

3. On September 11, 2026, Intake Worker S. Patel spoke by telephone with Ms. J. Sterling, Vice-Principal at Oakridge Elementary School. Ms. Sterling reported that A.R.'s classroom teacher told her that A.R. arrived 20 minutes late on two occasions during the first week of September 2026 and appeared "quiet and tired." Based on this report, it is clear that the home environment is chaotic and the parents are failing to prioritize the child's developmental and educational needs.

[PAGE 2]
4. SECTION B: HOME VISIT AND DIRECT OBSERVATIONS
On September 14, 2026 at 2:15 p.m., I attended the family residence at Unit 402 unannounced. Wait—note in my case log entry dated September 15, 2026, I recorded the unannounced visit as occurring on September 13, 2026 at 4:30 p.m. Upon arrival, Ms. Rostova answered the door promptly and invited me into the living room.

5. I observed that the apartment had three unfolded laundry baskets in the hallway and several dishes in the kitchen sink. However, I also observed that the refrigerator and pantry were fully stocked with fresh food, working smoke and carbon monoxide alarms were present, and A.R.'s bedroom was clean, safe, and appropriately furnished.

6. When I asked Ms. Rostova about the anonymous report from September 8, 2026, Ms. Rostova became defensive and asked whether she was allowed to have a support person or legal counsel present before signing a voluntary service agreement. Ms. Rostova's hesitation to immediately sign the Society's blanket release of information demonstrates a lack of cooperation and a lack of insight into the Society's protection concerns.

7. Ms. Rostova stated that on the evening of September 8, 2026, A.R. was actually staying overnight at the home of the maternal grandmother, Nadia Rostova, in Burlington, and produced text messages and a timestamped photo from that evening. I have not yet contacted the maternal grandmother Nadia Rostova to verify this statement, nor have I reviewed the complete text thread.

[PAGE 3]
8. SECTION C: MEDICAL AND COLLATERAL RECORDS
Ms. Rostova stated that A.R. is followed regularly by pediatrician Dr. H. Lin at Hamilton Family Health Team and had a complete annual check-up in August 2026 with no health or developmental concerns. The Society has not yet requested or received records from Dr. H. Lin, nor has the Society spoken with the classroom teacher directly.

9. SECTION D: ASSESSMENT AND REQUESTED RELIEF
Despite the physical adequacy of the food and sleeping arrangements observed during the visit, the Society remains gravely concerned that the Mother's questioning of the consent forms and the anonymous caller's allegation of substance misuse place the child A.R. at risk of emotional and physical harm.

10. The Society therefore requests a 6-month Supervision Order with conditions requiring random substance testing, mandatory parenting courses, and unrestricted access to all medical and counselling records of both parents.

SWORN BEFORE ME at the City of Hamilton, on October 1, 2026.
Marcus Vance, CPW`,
  },
  {
    id: 'sample-casenotes-log',
    title: 'Society Case Note Log & Supervision Contact Record',
    documentType: 'Agency Case Notes & Contact Log (CYFSA Record)',
    fileName: 'Society_CaseNotes_File_88412_Sept2026.txt',
    badgeText: 'Case Notes · Late Recording · Missing Collateral Checks',
    description:
      'Internal family service worker contact log featuring delayed note entry, uncorroborated third-party summaries, and omitted collateral follow-up.',
    content: `[PAGE 1]
CHILDREN'S AID SOCIETY — FAMILY SERVICE CONTACT LOG
FILE NO: CAS-2026-88412
FAMILY NAME: MERCER, Claire (Mother) & MERCER, Liam (Child, DOB: Nov 3, 2020)
ASSIGNED WORKER: T. Hennessy, BSW

ENTRY #1
DATE OF EVENT: August 19, 2026
DATE RECORDED IN SYSTEM: September 18, 2026 (29 days after contact)
CONTACT TYPE: Home Visit (Scheduled)

1. Worker attended the residence of Claire Mercer on August 19, 2026 for a monthly supervision visit. Note is being entered on September 18, 2026 from brief handwritten desk notes.

2. During the visit, Liam (age 5) was playing with building blocks in the living room and showed Worker his drawings. Liam appeared clean, well-nourished, and affectionate toward his mother.

3. Worker asked Ms. Mercer whether she had completed the intake for the community stress-management group. Ms. Mercer provided a printed confirmation email from St. Joseph's Community Wellness dated August 12, 2026 showing she is registered for the cohort starting October 5, 2026, which was the earliest available intake date. Worker feels Ms. Mercer should have found a private paid therapist sooner if the public waitlist was 7 weeks long, which suggests passive compliance.

[PAGE 2]
ENTRY #2
DATE OF EVENT: September 4, 2026
DATE RECORDED IN SYSTEM: September 18, 2026
CONTACT TYPE: Telephone Call from Former Partner's Sister

4. Worker received a phone call from Brenda Cole (paternal aunt, who is currently involved in a parallel family court access dispute supporting the father). Ms. Cole stated that her brother told her that someone told him Ms. Mercer had a new partner staying at the apartment on weekends who "has a temper."

5. Ms. Cole admitted she has not been to Ms. Mercer's residence since December 2025 and has never met or seen any new partner. Nevertheless, Worker recorded a high-risk safety concern regarding "exposure to adult conflict in the home" based on Ms. Cole's phone call.

6. On September 10, 2026, Ms. Mercer emailed Worker providing letters from her next-door neighbour (Mr. K. Al-Mansoor) and Liam's daycare supervisor (BrightStart Early Learning) confirming punctual daily attendance and positive interactions. Worker has not yet opened or attached the daycare letter to the file.

7. SUMMARY RECOMMENDATION: Continue current supervision conditions for an additional 4 months due to unresolved concerns about adult conflict reported on September 4, 2026 and delayed start of the stress-management group.`,
  },
  {
    id: 'sample-kinship-plan',
    title: 'Plan of Care & Kinship Assessment Summary',
    documentType: 'Society Plan of Care (CYFSA s. 100 / Kinship Review)',
    fileName: 'Plan_of_Care_Kinship_Summary_2026.txt',
    badgeText: 'Plan of Care · Kinship Assessment · Procedural Gaps',
    description:
      'Society Plan of Care proposing continued non-family foster care over a proposed maternal aunt kinship placement prior to completing home study interviews.',
    content: `[PAGE 1]
SOCIETY PLAN OF CARE — ONTARIO COURT OF JUSTICE
FILE: CYFSA-2026-0419
CHILD: N.T. (born February 22, 2021)
PARENTS: S. Thompson (Mother) & R. Thompson (Father)
DATE OF PLAN: September 28, 2026

SECTION 1: CURRENT PLACEMENT AND PROPOSED PLAN
1. N.T. (age 5) was placed in a Society foster home outside the family's municipality on August 28, 2026 following the Mother's emergency hospitalization for a medical procedure.

2. On August 30, 2026, both parents and the maternal aunt, Grace Thompson (a registered nurse residing 10 minutes from N.T.'s primary school), submitted a formal written request and signed consents for N.T. to be placed with Grace Thompson under a kinship service or temporary care arrangement so N.T. could remain in his neighbourhood school and cultural community.

3. As of September 28, 2026, the Kinship Assessment Department has not yet scheduled the home visit at Grace Thompson's residence due to staffing vacations. However, the assigned worker believes moving N.T. from the foster home right now might be "disruptive to routine," even though the foster home is 45 kilometres away from N.T.'s school and extended family.

[PAGE 2]
SECTION 2: ACCESS AND FAMILY CONTACT
4. Current parent-child access is supervised at the Society office once per week for 90 minutes on Wednesdays at 1:00 p.m. In paragraph 2 of the previous case conference summary dated September 5, 2026, the Society noted that there were "no safety concerns observed during visits and N.T. cries when visits end, asking to go home."

5. Despite positive visit observations, the Society proposes keeping access restricted to 90 minutes per week at the agency office because supervisory visitation rooms are fully booked on weekends and evenings.

6. The Mother was discharged from hospital on September 10, 2026 and provided a clearance note from her attending physician Dr. A. Moreau dated September 12, 2026 stating she is medically fit to resume full-time caregiving with family support. The Society has not contacted Dr. Moreau to clarify the medical note and takes the position that a comprehensive independent parenting capacity assessment should be ordered before any return or kinship transition is considered.`,
  },
];
