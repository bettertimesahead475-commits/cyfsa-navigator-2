export const AnalyzerStage = {
  IDLE: 'IDLE',
  UPLOADING: 'UPLOADING',
  AUTHENTICATING: 'AUTHENTICATING',
  EXTRACTING: 'EXTRACTING',
  VERIFYING_ACCESS: 'VERIFYING_ACCESS',
  ANALYZING: 'ANALYZING',
  VALIDATING: 'VALIDATING',
  SAVING: 'SAVING',
  COMPLETE: 'COMPLETE',
  ERROR: 'ERROR',
} as const;

export type AnalyzerStage = (typeof AnalyzerStage)[keyof typeof AnalyzerStage];

export type AnalysisMode = 'quick' | 'forensic';

export const EvidenceClassification = {
  DIRECT: 'DIRECT',
  DOCUMENTARY: 'DOCUMENTARY',
  CORROBORATED: 'CORROBORATED',
  HEARSAY: 'HEARSAY',
  INFERENCE: 'INFERENCE',
  OPINION: 'OPINION',
  UNSUPPORTED: 'UNSUPPORTED',
  UNCLEAR: 'UNCLEAR',
} as const;

export type EvidenceClassification = (typeof EvidenceClassification)[keyof typeof EvidenceClassification];

export type AccessSource = 'free' | 'paid' | 'admin' | 'none';

export interface AccessCheckResult {
  allowed: boolean;
  reason: string;
  source: AccessSource;
  remainingFreeAllowance?: number;
  paidSessionCreditsRemaining?: number;
  supabaseProjectRef?: string;
  credentialVerified?: boolean;
  alreadyUnlockedForDocumentMode?: boolean;
}

export interface SourceLocation {
  page: string;
  paragraph: string;
  section: string;
  heading: string;
  shortExcerpt: string;
}

export interface AnalyzedClaim {
  id: string;
  claim: string;
  madeBy: string;
  concerns: string;
  sourceLocation: SourceLocation;
  supportIdentified: string[];
  evidenceClassification: EvidenceClassification;
  classificationReasoning: string;
  contradictions: string[];
  missingInformation: string[];
  verificationQuestions: string[];
}

export interface ImportantDateItem {
  date: string;
  event: string;
  significance: string;
  sourceLocation: SourceLocation;
}

export interface PartyItem {
  nameOrIdentifier: string;
  role: string;
  relationshipToChildOrMatter: string;
  notes: string;
}

export interface ContradictionItem {
  topic: string;
  statementA: string;
  locationA: string;
  statementB: string;
  locationB: string;
  whyItMatters: string;
}

export interface MissingSupportItem {
  assertion: string;
  whatIsMissingInSuppliedDocument: string;
  distinctionNote: string;
  sourceLocation: SourceLocation;
}

export interface ForensicStructureAnalysis {
  documentTypeIdentified: string;
  swornOrUnswornStatus: string;
  structuralCompleteness: string;
  sectionsIdentified: string[];
  structuralAnomalies: string[];
}

export interface ForensicSourceItem {
  sourceNameOrRole: string;
  sourceType: 'Primary / Direct Observer' | 'Secondary / Institutional' | 'Third-Party / Hearsay' | 'Anonymous / Unspecified';
  reliabilityNotes: string;
  attributableClaimsCount: number;
}

export interface ForensicEvidenceBreakdownItem {
  classification: EvidenceClassification;
  itemSummary: string;
  explanationOfClassification: string;
  sourceLocation: SourceLocation;
}

export interface ForensicHearsayAuditItem {
  statement: string;
  originalDeclarant: string;
  reportingLayer: string;
  classification: 'HEARSAY' | 'INFERENCE' | 'OPINION' | 'UNSUPPORTED';
  concernExplanation: string;
  sourceLocation: SourceLocation;
}

export interface ForensicLegalIssueItem {
  issueTitle: string;
  cyfsaTopicCategory: string;
  documentBasis: string;
  reviewGuidance: string;
  uncertaintyFraming: string;
  sourceLocation: SourceLocation;
}

export interface ForensicProceduralIssueItem {
  proceduralTopic: string;
  observationInDocument: string;
  questionsForReview: string;
  sourceLocation: SourceLocation;
}

export interface ForensicPreparationMatrixItem {
  claimOrIssue: string;
  documentToRequestOrGather: string;
  purposeOfEvidence: string;
  priority: 'High' | 'Medium' | 'Standard';
}

export interface ForensicInDepthSections {
  documentStructure: ForensicStructureAnalysis;
  sourcesAnalysis: ForensicSourceItem[];
  evidenceClassificationBreakdown: ForensicEvidenceBreakdownItem[];
  corroborationAnalysis: {
    independentlyCorroborated: string[];
    selfReferentialOrRepeatedOnly: string[];
    corroborationGaps: string[];
  };
  hearsayAndInference: ForensicHearsayAuditItem[];
  unsupportedAssertions: string[];
  internalConsistency: {
    overallAssessment: string;
    narrativeShiftsOrTensions: string[];
  };
  chronologyAndGaps: {
    timelineSummary: string;
    unexplainedTimeGaps: string[];
  };
  proceduralIssues: ForensicProceduralIssueItem[];
  legalIssuesForReview: ForensicLegalIssueItem[];
  evidencePreparationMatrix: ForensicPreparationMatrixItem[];
}

export interface DocumentAnalysisResult {
  mode: AnalysisMode;
  documentOverview: {
    documentTitle: string;
    documentType: string;
    documentDate: string;
    authorOrAgency: string;
    cyfsaContext: string;
    overviewSummary: string;
  };
  executiveSummary: string;
  importantDates: ImportantDateItem[];
  parties: PartyItem[];
  claims: AnalyzedClaim[];
  evidenceStrengths: string[];
  evidenceWeaknesses: string[];
  immediateConcerns: string[];
  missingSupport: MissingSupportItem[];
  contradictions: ContradictionItem[];
  itemsToVerify: string[];
  questionsToConsider: string[];
  documentsToGather: string[];
  preparationSteps: string[];
  forensicSections?: ForensicInDepthSections;
  metadata: {
    requestId: string;
    documentId: string;
    documentHash: string;
    fileName: string;
    mode: AnalysisMode;
    modelUsed: string;
    analyzedAt: string;
    processingTimeMs: number;
    accessSource: AccessSource;
    creditCharged: boolean;
    idempotentReplay: boolean;
    schemaValidated: boolean;
    forensicDisclaimer: string;
    evidentiaryDistinctionNotice: string;
  };
}

export interface StructuredDocumentParagraph {
  pageNumber: number;
  paragraphNumber: number;
  sectionHeading: string;
  text: string;
}

export interface ExtractedDocumentPayload {
  documentId: string;
  fileName: string;
  fileType: 'PDF' | 'DOCX' | 'TXT' | 'OCR_IMAGE';
  fileSizeBytes: number;
  sha256Hash: string;
  extractedAt: string;
  characterCount: number;
  wordCount: number;
  pageCount: number;
  sectionCount: number;
  paragraphCount: number;
  rawText: string;
  annotatedText: string;
  structuredParagraphs: StructuredDocumentParagraph[];
  extractionMethod: string;
  warnings: string[];
}

export interface AnalyzerErrorPayload {
  code:
    | 'SIGN_IN_REQUIRED'
    | 'USAGE_SERVICE_TEMPORARILY_UNAVAILABLE'
    | 'ACCESS_DENIED_NO_CREDITS'
    | 'EXTRACTION_EMPTY'
    | 'EXTRACTION_FAILED'
    | 'UNSUPPORTED_FILE_TYPE'
    | 'MALFORMED_DOCUMENT'
    | 'GEMINI_ANALYSIS_FAILED'
    | 'GEMINI_TIMEOUT'
    | 'VALIDATION_FAILED'
    | 'SUPABASE_CREDENTIAL_MISMATCH'
    | 'INTERNAL_PIPELINE_ERROR';
  stage: AnalyzerStage;
  message: string;
  remediation: string;
  timestamp: string;
}

export interface AuthenticatedUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  tier: 'free' | 'paid' | 'admin';
  idToken: string;
  tokenIssuedAt: string;
  firebaseProjectId: string;
}

export type CrossExamTag = 'Contested' | 'Hearsay to Strike' | 'Request Disclosure' | 'Admitted' | 'Key Weakness';

export interface UserTaggedClaimItem {
  claimId: string;
  tags: CrossExamTag[];
  crossExamNotes: string;
  crossExamQuestions: string[];
}
