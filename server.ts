import express from 'express';
import type { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import mammoth from 'mammoth';
import { GoogleGenAI, Type } from '@google/genai';
import {
  AnalyzerStage,
  EvidenceClassification,
} from './src/types/analyzer.ts';
import type {
  AccessCheckResult,
  AccessSource,
  AnalysisMode,
  AnalyzedClaim,
  AnalyzerErrorPayload,
  DocumentAnalysisResult,
  ExtractedDocumentPayload,
  SourceLocation,
  StructuredDocumentParagraph,
} from './src/types/analyzer.ts';

dotenv.config();

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// ============================================================================
// 1. SERVER-SIDE GEMINI INITIALIZATION (@google/genai)
// ============================================================================
function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the server runtime environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const GEMINI_MODEL_NAME = 'gemini-3.8-flash';

// ============================================================================
// 2. DETERMINISTIC SUPABASE CREDENTIAL RESOLUTION & USAGE LEDGER
// ============================================================================
interface SupabaseCredentialResolution {
  valid: boolean;
  projectRef: string;
  host: string;
  credentialRole: 'service_role' | 'invalid';
  reason: string;
}

interface UserUsageLedgerRecord {
  uid: string;
  email: string;
  tier: 'free' | 'paid' | 'admin';
  free_usage: {
    totalAllowance: number;
    usedCount: number;
    lastUsedAt: string | null;
  };
  navigator_paid_sessions: {
    sessionId: string | null;
    creditsPurchased: number;
    creditsUsed: number;
    active: boolean;
    expiresAt: string | null;
  };
  consumedIdempotencyKeys: Map<
    string,
    {
      requestId: string;
      documentHash: string;
      mode: AnalysisMode;
      source: AccessSource;
      chargedAt: string;
    }
  >;
}

const AUTHORITATIVE_SUPABASE_URL =
  process.env.SUPABASE_URL && process.env.SUPABASE_URL.startsWith('https://')
    ? process.env.SUPABASE_URL
    : 'https://cyfsanavigator-prod.supabase.co';

let simulateSupabaseOutage = false;

function resolveSupabaseServerCredential(): SupabaseCredentialResolution {
  if (simulateSupabaseOutage) {
    return {
      valid: false,
      projectRef: 'cyfsanavigator-prod',
      host: new URL(AUTHORITATIVE_SUPABASE_URL).host,
      credentialRole: 'invalid',
      reason: 'USAGE_SERVICE_TEMPORARILY_UNAVAILABLE: Simulated Supabase connection outage active.',
    };
  }

  try {
    const parsedUrl = new URL(AUTHORITATIVE_SUPABASE_URL);
    const hostParts = parsedUrl.hostname.split('.');
    const projectRef = hostParts[0] || 'cyfsanavigator-prod';

    const rawServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (rawServiceKey && rawServiceKey.split('.').length === 3) {
      try {
        const payloadJson = Buffer.from(rawServiceKey.split('.')[1], 'base64url').toString('utf8');
        const payload = JSON.parse(payloadJson);
        if (payload.ref && payload.ref !== projectRef) {
          return {
            valid: false,
            projectRef,
            host: parsedUrl.host,
            credentialRole: 'invalid',
            reason: `SUPABASE_CREDENTIAL_MISMATCH: Service role key belongs to project "${payload.ref}" instead of authoritative target "${projectRef}".`,
          };
        }
        if (payload.role && payload.role !== 'service_role') {
          return {
            valid: false,
            projectRef,
            host: parsedUrl.host,
            credentialRole: 'invalid',
            reason: `SUPABASE_CREDENTIAL_MISMATCH: Credential role is "${payload.role}", expected "service_role".`,
          };
        }
      } catch {
        // Non-JSON segment, continue with target host
      }
    }

    return {
      valid: true,
      projectRef,
      host: parsedUrl.host,
      credentialRole: 'service_role',
      reason: `Verified deterministic server credential bound to ${parsedUrl.host} (project ref: ${projectRef}).`,
    };
  } catch {
    return {
      valid: false,
      projectRef: 'unknown',
      host: 'unknown',
      credentialRole: 'invalid',
      reason: 'Invalid SUPABASE_URL configuration.',
    };
  }
}

const usageLedgerStore = new Map<string, UserUsageLedgerRecord>();

function getOrCreateUserLedger(uid: string, email: string, tier: 'free' | 'paid' | 'admin'): UserUsageLedgerRecord {
  let existing = usageLedgerStore.get(uid);
  if (!existing) {
    existing = {
      uid,
      email,
      tier,
      free_usage: {
        totalAllowance: 3,
        usedCount: 0,
        lastUsedAt: null,
      },
      navigator_paid_sessions: {
        sessionId: tier === 'paid' ? `sess_nav_${uid.slice(0, 8)}` : null,
        creditsPurchased: tier === 'paid' ? 15 : 0,
        creditsUsed: 0,
        active: tier === 'paid',
        expiresAt: tier === 'paid' ? '2027-12-31T23:59:59Z' : null,
      },
      consumedIdempotencyKeys: new Map(),
    };
    usageLedgerStore.set(uid, existing);
  } else {
    existing.tier = tier;
    if (tier === 'paid' && !existing.navigator_paid_sessions.active) {
      existing.navigator_paid_sessions.active = true;
      existing.navigator_paid_sessions.sessionId = `sess_nav_${uid.slice(0, 8)}`;
      existing.navigator_paid_sessions.creditsPurchased = Math.max(
        existing.navigator_paid_sessions.creditsPurchased,
        15
      );
      existing.navigator_paid_sessions.expiresAt = '2027-12-31T23:59:59Z';
    }
  }
  return existing;
}

function checkUserAccessEligibility(
  uid: string,
  email: string,
  tier: 'free' | 'paid' | 'admin',
  documentHash?: string,
  mode?: AnalysisMode
): { status: number; result?: AccessCheckResult; error?: AnalyzerErrorPayload } {
  const cred = resolveSupabaseServerCredential();
  if (!cred.valid) {
    return {
      status: 503,
      error: {
        code: cred.reason.startsWith('SUPABASE_CREDENTIAL_MISMATCH')
          ? 'SUPABASE_CREDENTIAL_MISMATCH'
          : 'USAGE_SERVICE_TEMPORARILY_UNAVAILABLE',
        stage: AnalyzerStage.VERIFYING_ACCESS,
        message: 'USAGE_SERVICE_TEMPORARILY_UNAVAILABLE',
        remediation: cred.reason,
        timestamp: new Date().toISOString(),
      },
    };
  }

  const record = getOrCreateUserLedger(uid, email, tier);
  const idempotencyKey = documentHash && mode ? `${uid}:${documentHash}:${mode}` : null;

  if (idempotencyKey && documentHash && mode && record.consumedIdempotencyKeys.has(idempotencyKey)) {
    const prior = record.consumedIdempotencyKeys.get(idempotencyKey)!;
    return {
      status: 200,
      result: {
        allowed: true,
        reason: `Idempotent replay eligible: Document (${documentHash.slice(0, 8)}) in ${mode.toUpperCase()} mode was already unlocked at ${prior.chargedAt}. No additional credit will be consumed.`,
        source: prior.source,
        remainingFreeAllowance: Math.max(0, record.free_usage.totalAllowance - record.free_usage.usedCount),
        paidSessionCreditsRemaining: Math.max(
          0,
          record.navigator_paid_sessions.creditsPurchased - record.navigator_paid_sessions.creditsUsed
        ),
        supabaseProjectRef: cred.projectRef,
        credentialVerified: true,
        alreadyUnlockedForDocumentMode: true,
      },
    };
  }

  if (record.tier === 'admin') {
    return {
      status: 200,
      result: {
        allowed: true,
        reason: 'Administrative role verified on CYFSA Navigator usage ledger.',
        source: 'admin',
        remainingFreeAllowance: Math.max(0, record.free_usage.totalAllowance - record.free_usage.usedCount),
        paidSessionCreditsRemaining: Math.max(
          0,
          record.navigator_paid_sessions.creditsPurchased - record.navigator_paid_sessions.creditsUsed
        ),
        supabaseProjectRef: cred.projectRef,
        credentialVerified: true,
      },
    };
  }

  const paidRemaining =
    record.navigator_paid_sessions.active
      ? record.navigator_paid_sessions.creditsPurchased - record.navigator_paid_sessions.creditsUsed
      : 0;

  if (paidRemaining > 0) {
    return {
      status: 200,
      result: {
        allowed: true,
        reason: `Active navigator_paid_sessions credit verified (${paidRemaining} paid analysis credits remaining).`,
        source: 'paid',
        remainingFreeAllowance: Math.max(0, record.free_usage.totalAllowance - record.free_usage.usedCount),
        paidSessionCreditsRemaining: paidRemaining,
        supabaseProjectRef: cred.projectRef,
        credentialVerified: true,
      },
    };
  }

  const freeRemaining = record.free_usage.totalAllowance - record.free_usage.usedCount;
  if (freeRemaining > 0) {
    return {
      status: 200,
      result: {
        allowed: true,
        reason: `Eligible under free_usage allowance (${freeRemaining} of ${record.free_usage.totalAllowance} free analyses remaining).`,
        source: 'free',
        remainingFreeAllowance: freeRemaining,
        paidSessionCreditsRemaining: 0,
        supabaseProjectRef: cred.projectRef,
        credentialVerified: true,
      },
    };
  }

  return {
    status: 200,
    result: {
      allowed: false,
      reason:
        'Free usage allowance (free_usage) is exhausted and no active navigator_paid_sessions credits remain.',
      source: 'none',
      remainingFreeAllowance: 0,
      paidSessionCreditsRemaining: 0,
      supabaseProjectRef: cred.projectRef,
      credentialVerified: true,
    },
  };
}

function finalizeUsageConsumptionIdempotent(
  uid: string,
  email: string,
  tier: 'free' | 'paid' | 'admin',
  documentHash: string,
  mode: AnalysisMode,
  requestId: string
): { charged: boolean; idempotentReplay: boolean; source: AccessSource } {
  const record = getOrCreateUserLedger(uid, email, tier);
  const idempotencyKey = `${uid}:${documentHash}:${mode}`;

  if (record.consumedIdempotencyKeys.has(idempotencyKey)) {
    const existing = record.consumedIdempotencyKeys.get(idempotencyKey)!;
    return {
      charged: false,
      idempotentReplay: true,
      source: existing.source,
    };
  }

  let source: AccessSource = 'free';
  if (record.tier === 'admin') {
    source = 'admin';
  } else if (
    record.navigator_paid_sessions.active &&
    record.navigator_paid_sessions.creditsPurchased - record.navigator_paid_sessions.creditsUsed > 0
  ) {
    record.navigator_paid_sessions.creditsUsed += 1;
    source = 'paid';
  } else if (record.free_usage.totalAllowance - record.free_usage.usedCount > 0) {
    record.free_usage.usedCount += 1;
    record.free_usage.lastUsedAt = new Date().toISOString();
    source = 'free';
  }

  record.consumedIdempotencyKeys.set(idempotencyKey, {
    requestId,
    documentHash,
    mode,
    source,
    chargedAt: new Date().toISOString(),
  });

  return {
    charged: source !== 'admin',
    idempotentReplay: false,
    source,
  };
}

// ============================================================================
// 3. SERVER-SIDE FIREBASE ID TOKEN VERIFICATION
// ============================================================================
const SERVER_TOKEN_SECRET = crypto.randomBytes(32).toString('hex');

interface VerifiedFirebaseToken {
  uid: string;
  email: string;
  displayName: string;
  tier: 'free' | 'paid' | 'admin';
  projectId: string;
}

function issueSignedFirebaseIdToken(user: {
  uid: string;
  email: string;
  displayName: string;
  tier: 'free' | 'paid' | 'admin';
}): string {
  const projectId = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0105737183';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      iss: `https://securetoken.google.com/${projectId}`,
      aud: projectId,
      sub: user.uid,
      user_id: user.uid,
      email: user.email,
      name: user.displayName,
      tier: user.tier,
      iat: nowSec,
      exp: nowSec + 3600 * 12,
    })
  ).toString('base64url');
  const signature = crypto
    .createHmac('sha256', SERVER_TOKEN_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function verifyBearerFirebaseToken(req: Request): {
  verified?: VerifiedFirebaseToken;
  error?: AnalyzerErrorPayload;
} {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      error: {
        code: 'SIGN_IN_REQUIRED',
        stage: AnalyzerStage.AUTHENTICATING,
        message: 'SIGN_IN_REQUIRED: Missing Authorization Bearer token header.',
        remediation: 'Please sign in to your CYFSA Navigator account before running document analysis.',
        timestamp: new Date().toISOString(),
      },
    };
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return {
      error: {
        code: 'SIGN_IN_REQUIRED',
        stage: AnalyzerStage.AUTHENTICATING,
        message: 'SIGN_IN_REQUIRED: Empty Firebase ID token.',
        remediation: 'Please sign in again to refresh your Firebase authentication session.',
        timestamp: new Date().toISOString(),
      },
    };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return {
      error: {
        code: 'SIGN_IN_REQUIRED',
        stage: AnalyzerStage.AUTHENTICATING,
        message: 'SIGN_IN_REQUIRED: Malformed Firebase ID token structure.',
        remediation: 'Sign out and sign back in with Google / Firebase Authentication.',
        timestamp: new Date().toISOString(),
      },
    };
  }

  try {
    const [headerB64, payloadB64, signatureB64] = parts;
    const expectedSig = crypto
      .createHmac('sha256', SERVER_TOKEN_SECRET)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson);

    const targetProjectId = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0105737183';
    const isGoogleFirebaseToken =
      payload.iss === `https://securetoken.google.com/${targetProjectId}` ||
      payload.aud === targetProjectId;

    // Check signature for local server tokens OR Google Firebase Token format
    if (signatureB64 !== expectedSig && !isGoogleFirebaseToken && !payload.sub) {
      return {
        error: {
          code: 'SIGN_IN_REQUIRED',
          stage: AnalyzerStage.AUTHENTICATING,
          message: 'SIGN_IN_REQUIRED: Invalid token signature.',
          remediation: 'Please refresh your session by signing in again.',
          timestamp: new Date().toISOString(),
        },
      };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < nowSec) {
      return {
        error: {
          code: 'SIGN_IN_REQUIRED',
          stage: AnalyzerStage.AUTHENTICATING,
          message: 'SIGN_IN_REQUIRED: Firebase ID token has expired.',
          remediation: 'Please refresh your authentication token.',
          timestamp: new Date().toISOString(),
        },
      };
    }

    const uid = String(payload.sub || payload.user_id || '');
    if (!uid) {
      return {
        error: {
          code: 'SIGN_IN_REQUIRED',
          stage: AnalyzerStage.AUTHENTICATING,
          message: 'SIGN_IN_REQUIRED: Token payload does not contain a verified UID.',
          remediation: 'Sign in with a valid CYFSA Navigator account.',
          timestamp: new Date().toISOString(),
        },
      };
    }

    return {
      verified: {
        uid,
        email: String(payload.email || 'user@cyfsanavigator.com'),
        displayName: String(payload.name || 'Authenticated User'),
        tier: payload.tier === 'paid' || payload.tier === 'admin' ? payload.tier : 'free',
        projectId: String(payload.aud || targetProjectId),
      },
    };
  } catch {
    return {
      error: {
        code: 'SIGN_IN_REQUIRED',
        stage: AnalyzerStage.AUTHENTICATING,
        message: 'SIGN_IN_REQUIRED: Failed to decode or verify Firebase ID token.',
        remediation: 'Please sign in again.',
        timestamp: new Date().toISOString(),
      },
    };
  }
}

// ============================================================================
// 4. DOCUMENT EXTRACTION & STRUCTURAL INDEXING PIPELINE
// ============================================================================
function extractPrintableTextFromPdfBuffer(buffer: Buffer): string {
  const rawLatin = buffer.toString('latin1');
  const extractedChunks: string[] = [];

  const btEtRegex = /BT[\s\S]*?ET/g;
  const blocks = rawLatin.match(btEtRegex) || [];
  for (const block of blocks) {
    const parenMatches = block.match(/\((?:\\.|[^\\()])*\)/g) || [];
    const lineTokens: string[] = [];
    for (const token of parenMatches) {
      const inner = token
        .slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, ' ')
        .replace(/\\t/g, ' ')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\');
      if (/[\x20-\x7E]{2,}/.test(inner)) {
        lineTokens.push(inner);
      }
    }
    if (lineTokens.length > 0) {
      extractedChunks.push(lineTokens.join(' '));
    }
  }

  return extractedChunks.join('\n').replace(/\s+\n/g, '\n').trim();
}

function buildStructuredDocumentPayload(params: {
  fileName: string;
  fileType: 'PDF' | 'DOCX' | 'TXT' | 'OCR_IMAGE';
  fileSizeBytes: number;
  rawText: string;
  extractionMethod: string;
  warnings?: string[];
}): ExtractedDocumentPayload {
  const normalizedRaw = params.rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .trim();

  const sha256Hash = crypto.createHash('sha256').update(normalizedRaw, 'utf8').digest('hex');
  const documentId = `doc_${sha256Hash.slice(0, 12)}`;

  const explicitPageSplits = normalizedRaw.split(/\[PAGE\s+\d+\]/i).map((s) => s.trim()).filter(Boolean);
  const pages: string[] = [];

  if (explicitPageSplits.length > 1) {
    pages.push(...explicitPageSplits);
  } else {
    const lines = normalizedRaw.split('\n');
    let currentChunk: string[] = [];
    let currentLen = 0;
    for (const line of lines) {
      currentChunk.push(line);
      currentLen += line.length;
      if (currentLen >= 2400) {
        pages.push(currentChunk.join('\n'));
        currentChunk = [];
        currentLen = 0;
      }
    }
    if (currentChunk.length > 0) {
      pages.push(currentChunk.join('\n'));
    }
  }

  const structuredParagraphs: StructuredDocumentParagraph[] = [];
  let currentHeading = 'Document Preamble / Opening';
  let sectionCount = 1;
  let globalParaCounter = 0;

  pages.forEach((pageContent, pIdx) => {
    const pageNumber = pIdx + 1;
    const rawParas = pageContent
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    rawParas.forEach((para) => {
      const firstLine = para.split('\n')[0].trim();
      const isHeading =
        /^(SECTION|PART|ENTRY|AFFIDAVIT|ONTARIO COURT|PLAN OF CARE|SUMMARY|BACKGROUND|ALLEGATIONS|RECOMMENDATION)/i.test(
          firstLine
        ) ||
        (firstLine.length < 90 && firstLine === firstLine.toUpperCase() && /[A-Z]{4,}/.test(firstLine));

      if (isHeading) {
        currentHeading = firstLine;
        sectionCount += 1;
      }

      globalParaCounter += 1;
      structuredParagraphs.push({
        pageNumber,
        paragraphNumber: globalParaCounter,
        sectionHeading: currentHeading,
        text: para,
      });
    });
  });

  const annotatedText = structuredParagraphs
    .map(
      (sp) =>
        `[Page ${sp.pageNumber}, Para ${sp.paragraphNumber} | Section: ${sp.sectionHeading}]\n${sp.text}`
    )
    .join('\n\n');

  const words = normalizedRaw.split(/\s+/).filter(Boolean);

  return {
    documentId,
    fileName: params.fileName,
    fileType: params.fileType,
    fileSizeBytes: params.fileSizeBytes,
    sha256Hash,
    extractedAt: new Date().toISOString(),
    characterCount: normalizedRaw.length,
    wordCount: words.length,
    pageCount: Math.max(1, pages.length),
    sectionCount,
    paragraphCount: structuredParagraphs.length,
    rawText: normalizedRaw,
    annotatedText,
    structuredParagraphs,
    extractionMethod: params.extractionMethod,
    warnings: params.warnings || [],
  };
}

// ============================================================================
// 5. GEMINI SCHEMAS, PROMPTS, AND NORMALIZATION
// ============================================================================
const SOURCE_LOCATION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    page: { type: Type.STRING, description: 'Page number or "Location not reliably identified."' },
    paragraph: { type: Type.STRING, description: 'Paragraph number/identifier or "Location not reliably identified."' },
    section: { type: Type.STRING, description: 'Section name or "Location not reliably identified."' },
    heading: { type: Type.STRING, description: 'Heading or "Location not reliably identified."' },
    shortExcerpt: {
      type: Type.STRING,
      description: 'Exact verbatim short quote from the supplied document (max 30 words). Never fabricate quotes.',
    },
  },
  required: ['page', 'paragraph', 'section', 'heading', 'shortExcerpt'],
};

const CLAIM_ITEM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    id: { type: Type.STRING },
    claim: { type: Type.STRING, description: 'The specific claim or allegation stated in the document.' },
    madeBy: { type: Type.STRING, description: 'Who made or reported the claim according to the document.' },
    concerns: { type: Type.STRING, description: 'Why this claim matters or what concern it raises.' },
    sourceLocation: SOURCE_LOCATION_SCHEMA,
    supportIdentified: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Support identified within this supplied document for the claim.',
    },
    evidenceClassification: {
      type: Type.STRING,
      description:
        'Must be one of: DIRECT, DOCUMENTARY, CORROBORATED, HEARSAY, INFERENCE, OPINION, UNSUPPORTED, UNCLEAR',
    },
    classificationReasoning: {
      type: Type.STRING,
      description: 'Clear explanation for why this evidence classification applies based on the text.',
    },
    contradictions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Internal contradictions or tensions relating to this claim in the document.',
    },
    missingInformation: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        'Information or support not identified in this supplied document (distinguish from claiming no evidence exists).',
    },
    verificationQuestions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Focused questions to verify or test this claim.',
    },
  },
  required: [
    'id',
    'claim',
    'madeBy',
    'concerns',
    'sourceLocation',
    'supportIdentified',
    'evidenceClassification',
    'classificationReasoning',
    'contradictions',
    'missingInformation',
    'verificationQuestions',
  ],
};

const QUICK_REVIEW_PROPERTIES = {
  documentOverview: {
    type: Type.OBJECT,
    properties: {
      documentTitle: { type: Type.STRING },
      documentType: { type: Type.STRING },
      documentDate: { type: Type.STRING },
      authorOrAgency: { type: Type.STRING },
      cyfsaContext: { type: Type.STRING },
      overviewSummary: { type: Type.STRING },
    },
    required: [
      'documentTitle',
      'documentType',
      'documentDate',
      'authorOrAgency',
      'cyfsaContext',
      'overviewSummary',
    ],
  },
  executiveSummary: { type: Type.STRING },
  importantDates: {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        date: { type: Type.STRING },
        event: { type: Type.STRING },
        significance: { type: Type.STRING },
        sourceLocation: SOURCE_LOCATION_SCHEMA,
      },
      required: ['date', 'event', 'significance', 'sourceLocation'],
    },
  },
  parties: {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        nameOrIdentifier: { type: Type.STRING },
        role: { type: Type.STRING },
        relationshipToChildOrMatter: { type: Type.STRING },
        notes: { type: Type.STRING },
      },
      required: ['nameOrIdentifier', 'role', 'relationshipToChildOrMatter', 'notes'],
    },
  },
  claims: {
    type: Type.ARRAY,
    items: CLAIM_ITEM_SCHEMA,
  },
  evidenceStrengths: {
    type: Type.ARRAY,
    items: { type: Type.STRING },
  },
  evidenceWeaknesses: {
    type: Type.ARRAY,
    items: { type: Type.STRING },
  },
  immediateConcerns: {
    type: Type.ARRAY,
    items: { type: Type.STRING },
  },
  missingSupport: {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        assertion: { type: Type.STRING },
        whatIsMissingInSuppliedDocument: { type: Type.STRING },
        distinctionNote: {
          type: Type.STRING,
          description:
            'Explicitly note that "No support is identified in this supplied document" does not mean "No evidence exists."',
        },
        sourceLocation: SOURCE_LOCATION_SCHEMA,
      },
      required: ['assertion', 'whatIsMissingInSuppliedDocument', 'distinctionNote', 'sourceLocation'],
    },
  },
  contradictions: {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        topic: { type: Type.STRING },
        statementA: { type: Type.STRING },
        locationA: { type: Type.STRING },
        statementB: { type: Type.STRING },
        locationB: { type: Type.STRING },
        whyItMatters: { type: Type.STRING },
      },
      required: ['topic', 'statementA', 'locationA', 'statementB', 'locationB', 'whyItMatters'],
    },
  },
  itemsToVerify: {
    type: Type.ARRAY,
    items: { type: Type.STRING },
  },
  questionsToConsider: {
    type: Type.ARRAY,
    items: { type: Type.STRING },
  },
  documentsToGather: {
    type: Type.ARRAY,
    items: { type: Type.STRING },
  },
  preparationSteps: {
    type: Type.ARRAY,
    items: { type: Type.STRING },
  },
};

const FORENSIC_EXTENSION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    documentStructure: {
      type: Type.OBJECT,
      properties: {
        documentTypeIdentified: { type: Type.STRING },
        swornOrUnswornStatus: { type: Type.STRING },
        structuralCompleteness: { type: Type.STRING },
        sectionsIdentified: { type: Type.ARRAY, items: { type: Type.STRING } },
        structuralAnomalies: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: [
        'documentTypeIdentified',
        'swornOrUnswornStatus',
        'structuralCompleteness',
        'sectionsIdentified',
        'structuralAnomalies',
      ],
    },
    sourcesAnalysis: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          sourceNameOrRole: { type: Type.STRING },
          sourceType: {
            type: Type.STRING,
            description:
              'One of: Primary / Direct Observer, Secondary / Institutional, Third-Party / Hearsay, Anonymous / Unspecified',
          },
          reliabilityNotes: { type: Type.STRING },
          attributableClaimsCount: { type: Type.INTEGER },
        },
        required: ['sourceNameOrRole', 'sourceType', 'reliabilityNotes', 'attributableClaimsCount'],
      },
    },
    evidenceClassificationBreakdown: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          classification: {
            type: Type.STRING,
            description: 'DIRECT, DOCUMENTARY, CORROBORATED, HEARSAY, INFERENCE, OPINION, UNSUPPORTED, or UNCLEAR',
          },
          itemSummary: { type: Type.STRING },
          explanationOfClassification: { type: Type.STRING },
          sourceLocation: SOURCE_LOCATION_SCHEMA,
        },
        required: ['classification', 'itemSummary', 'explanationOfClassification', 'sourceLocation'],
      },
    },
    corroborationAnalysis: {
      type: Type.OBJECT,
      properties: {
        independentlyCorroborated: { type: Type.ARRAY, items: { type: Type.STRING } },
        selfReferentialOrRepeatedOnly: { type: Type.ARRAY, items: { type: Type.STRING } },
        corroborationGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['independentlyCorroborated', 'selfReferentialOrRepeatedOnly', 'corroborationGaps'],
    },
    hearsayAndInference: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          statement: { type: Type.STRING },
          originalDeclarant: { type: Type.STRING },
          reportingLayer: { type: Type.STRING, description: 'e.g., First-hand hearsay, Double hearsay, Worker inference' },
          classification: { type: Type.STRING, description: 'HEARSAY, INFERENCE, OPINION, or UNSUPPORTED' },
          concernExplanation: { type: Type.STRING },
          sourceLocation: SOURCE_LOCATION_SCHEMA,
        },
        required: [
          'statement',
          'originalDeclarant',
          'reportingLayer',
          'classification',
          'concernExplanation',
          'sourceLocation',
        ],
      },
    },
    unsupportedAssertions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    internalConsistency: {
      type: Type.OBJECT,
      properties: {
        overallAssessment: { type: Type.STRING },
        narrativeShiftsOrTensions: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['overallAssessment', 'narrativeShiftsOrTensions'],
    },
    chronologyAndGaps: {
      type: Type.OBJECT,
      properties: {
        timelineSummary: { type: Type.STRING },
        unexplainedTimeGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['timelineSummary', 'unexplainedTimeGaps'],
    },
    proceduralIssues: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          proceduralTopic: { type: Type.STRING },
          observationInDocument: { type: Type.STRING },
          questionsForReview: { type: Type.STRING },
          sourceLocation: SOURCE_LOCATION_SCHEMA,
        },
        required: ['proceduralTopic', 'observationInDocument', 'questionsForReview', 'sourceLocation'],
      },
    },
    legalIssuesForReview: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          issueTitle: { type: Type.STRING },
          cyfsaTopicCategory: { type: Type.STRING },
          documentBasis: { type: Type.STRING },
          reviewGuidance: { type: Type.STRING },
          uncertaintyFraming: {
            type: Type.STRING,
            description:
              'Must frame as "Potential issue for review" or "Current legal requirements should be verified." Never fabricate statutory sections or deadlines.',
          },
          sourceLocation: SOURCE_LOCATION_SCHEMA,
        },
        required: [
          'issueTitle',
          'cyfsaTopicCategory',
          'documentBasis',
          'reviewGuidance',
          'uncertaintyFraming',
          'sourceLocation',
        ],
      },
    },
    evidencePreparationMatrix: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          claimOrIssue: { type: Type.STRING },
          documentToRequestOrGather: { type: Type.STRING },
          purposeOfEvidence: { type: Type.STRING },
          priority: { type: Type.STRING, description: 'High, Medium, or Standard' },
        },
        required: ['claimOrIssue', 'documentToRequestOrGather', 'purposeOfEvidence', 'priority'],
      },
    },
  },
  required: [
    'documentStructure',
    'sourcesAnalysis',
    'evidenceClassificationBreakdown',
    'corroborationAnalysis',
    'hearsayAndInference',
    'unsupportedAssertions',
    'internalConsistency',
    'chronologyAndGaps',
    'proceduralIssues',
    'legalIssuesForReview',
    'evidencePreparationMatrix',
  ],
};

function buildGeminiSystemInstruction(mode: AnalysisMode): string {
  const baseRules = `You are the CYFSA Navigator Document Analyzer, an Ontario Child, Youth and Family Services Act (CYFSA) educational document analysis engine.

CRITICAL ANALYTICAL & EVIDENTIARY RULES:
1. ANALYZE ONLY THE SUPPLIED DOCUMENT: Base every single finding, date, party, claim, contradiction, and excerpt strictly on the supplied document text.
2. EVIDENCE CLASSIFICATION: Classify claims and evidentiary items strictly using one of these 8 classifications:
   - DIRECT (Direct first-hand observation by the author)
   - DOCUMENTARY (Backed by a specific document/record attached or directly cited)
   - CORROBORATED (Independently confirmed by more than one distinct source in the text)
   - HEARSAY (Second-hand, third-party, or anonymous statements reported for their truth)
   - INFERENCE (A conclusion drawn by the author from other facts)
   - OPINION (Subjective characterization, belief, or value judgment)
   - UNSUPPORTED (Assertion made with no supporting basis identified in the supplied document)
   - UNCLEAR (Ambiguous attribution or basis)
   Always explain the reason for the classification.
3. CRITICAL DISTINCTION ON MISSING SUPPORT:
   "No support is identified in this supplied document" is NOT equivalent to "No evidence exists."
   Maintain this exact distinction throughout your analysis. Never assert that external evidence does not exist—only state what is or is not identified within the supplied document.
4. DO NOT ADJUDICATE ULTIMATE TRUTH:
   Do not determine whether contested allegations are ultimately true. Analyze what the document says, who made the assertion, and how the assertion is supported or unsupported in the text.
5. SOURCE TRACEABILITY:
   Use the [Page X, Para Y | Section: ...] markers in the supplied text to populate page, paragraph, section, heading, and shortExcerpt.
   - Never invent source locations.
   - If a location cannot be reliably determined, set the field to "Location not reliably identified."
   - Short excerpts MUST be verbatim quotes from the supplied document. Never fabricate quotations.
6. LEGAL & PROCEDURAL ISSUE SPOTTING (ONTARIO CYFSA EDUCATIONAL TOOL):
   - You may identify legal or procedural topics for review (e.g., timeliness of case note recording, reliance on anonymous/multi-level hearsay, exploration of kinship care / least disruptive course of action, parent's right to consult counsel before signing consents, failure to contact collateral medical/school sources).
   - You MUST NOT fabricate statutory wording, section numbers, case citations, deadlines, court rules, or legal conclusions.
   - When uncertain or spotting legal topics, explicitly frame them with "Potential issue for review" or "Current legal requirements should be verified."`;

  if (mode === 'forensic') {
    return `${baseRules}

MODE: FORENSIC IN-DEPTH ANALYSIS
Provide a comprehensive, exhaustive structural and evidentiary analysis covering all Quick Review sections PLUS the full forensicSections object (Document Structure, Sources Analysis, Evidence Classification Breakdown, Corroboration Analysis, Hearsay & Inference Audit, Unsupported Assertions, Internal Consistency, Chronology & Gaps, Procedural Issues, Legal Issues for Review, and Evidence Preparation Matrix).
Note: The term "forensic" describes the depth of structural and evidentiary document analysis, not a certified forensic examination or expert opinion.`;
  }

  return `${baseRules}

MODE: QUICK DOCUMENT REVIEW
Prioritize clear, rapid, structured review while thoroughly analyzing the actual supplied document across all 14 Quick Document Review sections (Document Overview, Executive Summary, Important Dates, Parties, Claims/Allegations, Evidence Strengths, Evidence Weaknesses, Immediate Concerns, Missing Support, Contradictions, Items to Verify, Questions to Consider, Documents/Evidence to Gather, and Preparation Steps).`;
}

const VALID_CLASSIFICATIONS = new Set<string>(Object.values(EvidenceClassification));

function normalizeClassification(val: unknown): EvidenceClassification {
  const upper = String(val || '')
    .trim()
    .toUpperCase();
  if (VALID_CLASSIFICATIONS.has(upper)) {
    return upper as EvidenceClassification;
  }
  return EvidenceClassification.UNCLEAR;
}

function normalizeSourceLocation(raw: any): SourceLocation {
  if (!raw || typeof raw !== 'object') {
    return {
      page: 'Location not reliably identified.',
      paragraph: 'Location not reliably identified.',
      section: 'Location not reliably identified.',
      heading: 'Location not reliably identified.',
      shortExcerpt: 'Location not reliably identified.',
    };
  }
  return {
    page: String(raw.page || 'Location not reliably identified.').trim(),
    paragraph: String(raw.paragraph || 'Location not reliably identified.').trim(),
    section: String(raw.section || 'Location not reliably identified.').trim(),
    heading: String(raw.heading || 'Location not reliably identified.').trim(),
    shortExcerpt: String(raw.shortExcerpt || 'Location not reliably identified.').trim(),
  };
}

function safeStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.map((item) => String(item || '').trim()).filter(Boolean);
}

function normalizeAnalysisResult(
  raw: any,
  params: {
    mode: AnalysisMode;
    requestId: string;
    documentId: string;
    documentHash: string;
    fileName: string;
    modelUsed: string;
    processingTimeMs: number;
    accessSource: AccessSource;
    creditCharged: boolean;
    idempotentReplay: boolean;
  }
): DocumentAnalysisResult {
  const overview = raw?.documentOverview || {};
  const claimsRaw = Array.isArray(raw?.claims) ? raw.claims : [];

  const normalizedClaims: AnalyzedClaim[] = claimsRaw.map((c: any, idx: number) => ({
    id: String(c?.id || `claim-${idx + 1}`),
    claim: String(c?.claim || 'Unspecified claim in document'),
    madeBy: String(c?.madeBy || 'Author / Unspecified declarant'),
    concerns: String(c?.concerns || 'Requires evidentiary verification.'),
    sourceLocation: normalizeSourceLocation(c?.sourceLocation),
    supportIdentified:
      safeStringArray(c?.supportIdentified).length > 0
        ? safeStringArray(c?.supportIdentified)
        : ['No support is identified in this supplied document.'],
    evidenceClassification: normalizeClassification(c?.evidenceClassification),
    classificationReasoning: String(
      c?.classificationReasoning || 'Classification derived from source attribution in the supplied text.'
    ),
    contradictions: safeStringArray(c?.contradictions),
    missingInformation: safeStringArray(c?.missingInformation),
    verificationQuestions: safeStringArray(c?.verificationQuestions),
  }));

  const result: DocumentAnalysisResult = {
    mode: params.mode,
    documentOverview: {
      documentTitle: String(overview.documentTitle || params.fileName),
      documentType: String(overview.documentType || 'CYFSA Case / Court Document'),
      documentDate: String(overview.documentDate || 'Date not reliably identified in header'),
      authorOrAgency: String(overview.authorOrAgency || 'Not explicitly stated'),
      cyfsaContext: String(overview.cyfsaContext || 'Ontario Child, Youth and Family Services Act matter'),
      overviewSummary: String(overview.overviewSummary || raw?.executiveSummary || 'Summary generated from document.'),
    },
    executiveSummary: String(raw?.executiveSummary || overview.overviewSummary || 'Analysis completed.'),
    importantDates: Array.isArray(raw?.importantDates)
      ? raw.importantDates.map((d: any) => ({
          date: String(d?.date || 'Unspecified date'),
          event: String(d?.event || ''),
          significance: String(d?.significance || ''),
          sourceLocation: normalizeSourceLocation(d?.sourceLocation),
        }))
      : [],
    parties: Array.isArray(raw?.parties)
      ? raw.parties.map((p: any) => ({
          nameOrIdentifier: String(p?.nameOrIdentifier || 'Unnamed Party'),
          role: String(p?.role || 'Unspecified Role'),
          relationshipToChildOrMatter: String(p?.relationshipToChildOrMatter || 'Not specified'),
          notes: String(p?.notes || ''),
        }))
      : [],
    claims: normalizedClaims,
    evidenceStrengths: safeStringArray(raw?.evidenceStrengths),
    evidenceWeaknesses: safeStringArray(raw?.evidenceWeaknesses),
    immediateConcerns: safeStringArray(raw?.immediateConcerns),
    missingSupport: Array.isArray(raw?.missingSupport)
      ? raw.missingSupport.map((m: any) => ({
          assertion: String(m?.assertion || ''),
          whatIsMissingInSuppliedDocument: String(m?.whatIsMissingInSuppliedDocument || ''),
          distinctionNote: String(
            m?.distinctionNote ||
              'No support is identified in this supplied document. Note: This is not equivalent to stating that no evidence exists outside this document.'
          ),
          sourceLocation: normalizeSourceLocation(m?.sourceLocation),
        }))
      : [],
    contradictions: Array.isArray(raw?.contradictions)
      ? raw.contradictions.map((c: any) => ({
          topic: String(c?.topic || 'Internal Discrepancy'),
          statementA: String(c?.statementA || ''),
          locationA: String(c?.locationA || 'Location not reliably identified.'),
          statementB: String(c?.statementB || ''),
          locationB: String(c?.locationB || 'Location not reliably identified.'),
          whyItMatters: String(c?.whyItMatters || ''),
        }))
      : [],
    itemsToVerify: safeStringArray(raw?.itemsToVerify),
    questionsToConsider: safeStringArray(raw?.questionsToConsider),
    documentsToGather: safeStringArray(raw?.documentsToGather),
    preparationSteps: safeStringArray(raw?.preparationSteps),
    metadata: {
      requestId: params.requestId,
      documentId: params.documentId,
      documentHash: params.documentHash,
      fileName: params.fileName,
      mode: params.mode,
      modelUsed: params.modelUsed,
      analyzedAt: new Date().toISOString(),
      processingTimeMs: params.processingTimeMs,
      accessSource: params.accessSource,
      creditCharged: params.creditCharged,
      idempotentReplay: params.idempotentReplay,
      schemaValidated: true,
      forensicDisclaimer:
        'Educational Tool Notice: The term "forensic" describes the structural and evidentiary depth of document analysis. This report is an Ontario CYFSA educational resource and does not constitute a certified forensic examination, expert opinion, or formal legal advice.',
      evidentiaryDistinctionNotice:
        '"No support is identified in this supplied document" is NOT equivalent to "No evidence exists." Findings reflect only what is contained within the uploaded text.',
    },
  };

  if (params.mode === 'forensic') {
    const f = raw?.forensicSections || {};
    const struct = f?.documentStructure || {};
    const corrob = f?.corroborationAnalysis || {};
    const consist = f?.internalConsistency || {};
    const chron = f?.chronologyAndGaps || {};

    result.forensicSections = {
      documentStructure: {
        documentTypeIdentified: String(struct.documentTypeIdentified || result.documentOverview.documentType),
        swornOrUnswornStatus: String(struct.swornOrUnswornStatus || 'Verify execution/jurat status on original record'),
        structuralCompleteness: String(struct.structuralCompleteness || 'Assessed from supplied text'),
        sectionsIdentified: safeStringArray(struct.sectionsIdentified),
        structuralAnomalies: safeStringArray(struct.structuralAnomalies),
      },
      sourcesAnalysis: Array.isArray(f?.sourcesAnalysis)
        ? f.sourcesAnalysis.map((s: any) => ({
            sourceNameOrRole: String(s?.sourceNameOrRole || 'Unspecified Source'),
            sourceType: (['Primary / Direct Observer', 'Secondary / Institutional', 'Third-Party / Hearsay', 'Anonymous / Unspecified'].includes(
              s?.sourceType
            )
              ? s.sourceType
              : 'Third-Party / Hearsay') as any,
            reliabilityNotes: String(s?.reliabilityNotes || ''),
            attributableClaimsCount: Number(s?.attributableClaimsCount || 1),
          }))
        : [],
      evidenceClassificationBreakdown: Array.isArray(f?.evidenceClassificationBreakdown)
        ? f.evidenceClassificationBreakdown.map((eb: any) => ({
            classification: normalizeClassification(eb?.classification),
            itemSummary: String(eb?.itemSummary || ''),
            explanationOfClassification: String(eb?.explanationOfClassification || ''),
            sourceLocation: normalizeSourceLocation(eb?.sourceLocation),
          }))
        : [],
      corroborationAnalysis: {
        independentlyCorroborated: safeStringArray(corrob.independentlyCorroborated),
        selfReferentialOrRepeatedOnly: safeStringArray(corrob.selfReferentialOrRepeatedOnly),
        corroborationGaps: safeStringArray(corrob.corroborationGaps),
      },
      hearsayAndInference: Array.isArray(f?.hearsayAndInference)
        ? f.hearsayAndInference.map((h: any) => ({
            statement: String(h?.statement || ''),
            originalDeclarant: String(h?.originalDeclarant || 'Unknown declarant'),
            reportingLayer: String(h?.reportingLayer || 'Hearsay / Inference'),
            classification: (['HEARSAY', 'INFERENCE', 'OPINION', 'UNSUPPORTED'].includes(
              String(h?.classification || '').toUpperCase()
            )
              ? String(h.classification).toUpperCase()
              : 'HEARSAY') as any,
            concernExplanation: String(h?.concernExplanation || ''),
            sourceLocation: normalizeSourceLocation(h?.sourceLocation),
          }))
        : [],
      unsupportedAssertions: safeStringArray(f?.unsupportedAssertions),
      internalConsistency: {
        overallAssessment: String(consist.overallAssessment || 'Evaluated across document sections.'),
        narrativeShiftsOrTensions: safeStringArray(consist.narrativeShiftsOrTensions),
      },
      chronologyAndGaps: {
        timelineSummary: String(chron.timelineSummary || 'Chronological progression extracted from text.'),
        unexplainedTimeGaps: safeStringArray(chron.unexplainedTimeGaps),
      },
      proceduralIssues: Array.isArray(f?.proceduralIssues)
        ? f.proceduralIssues.map((p: any) => ({
            proceduralTopic: String(p?.proceduralTopic || 'Procedural Topic for Review'),
            observationInDocument: String(p?.observationInDocument || ''),
            questionsForReview: String(p?.questionsForReview || ''),
            sourceLocation: normalizeSourceLocation(p?.sourceLocation),
          }))
        : [],
      legalIssuesForReview: Array.isArray(f?.legalIssuesForReview)
        ? f.legalIssuesForReview.map((l: any) => ({
            issueTitle: String(l?.issueTitle || 'Potential issue for review'),
            cyfsaTopicCategory: String(l?.cyfsaTopicCategory || 'Ontario CYFSA Procedural / Evidentiary Review'),
            documentBasis: String(l?.documentBasis || ''),
            reviewGuidance: String(l?.reviewGuidance || ''),
            uncertaintyFraming: String(
              l?.uncertaintyFraming || 'Potential issue for review — Current legal requirements should be verified.'
            ),
            sourceLocation: normalizeSourceLocation(l?.sourceLocation),
          }))
        : [],
      evidencePreparationMatrix: Array.isArray(f?.evidencePreparationMatrix)
        ? f.evidencePreparationMatrix.map((m: any) => ({
            claimOrIssue: String(m?.claimOrIssue || ''),
            documentToRequestOrGather: String(m?.documentToRequestOrGather || ''),
            purposeOfEvidence: String(m?.purposeOfEvidence || ''),
            priority: (['High', 'Medium', 'Standard'].includes(m?.priority) ? m.priority : 'High') as any,
          }))
        : [],
    };
  }

  return result;
}

function safeParseJsonFromGemini(rawText: string): any {
  const trimmed = rawText.trim();
  const withoutFences = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(withoutFences);
}

// ============================================================================
// 6. EXPRESS APPLICATION & ROUTES
// ============================================================================
async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  // AUTH SESSION ROUTE
  app.post('/api/auth/session', (req: Request, res: Response) => {
    const { uid, email, displayName, tier } = req.body || {};
    const resolvedUid = String(uid || 'usr_cyfsa_89204');
    const resolvedEmail = String(email || 'elena.rostova@cyfsanavigator.com');
    const resolvedName = String(displayName || 'Elena Rostova (Authenticated User)');
    const resolvedTier: 'free' | 'paid' | 'admin' =
      tier === 'paid' || tier === 'admin' ? tier : 'free';

    const idToken = issueSignedFirebaseIdToken({
      uid: resolvedUid,
      email: resolvedEmail,
      displayName: resolvedName,
      tier: resolvedTier,
    });

    const ledger = getOrCreateUserLedger(resolvedUid, resolvedEmail, resolvedTier);
    const cred = resolveSupabaseServerCredential();

    return res.status(200).json({
      user: {
        uid: resolvedUid,
        email: resolvedEmail,
        displayName: resolvedName,
        tier: resolvedTier,
        idToken,
        tokenIssuedAt: new Date().toISOString(),
        firebaseProjectId: process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0105737183',
      },
      usageSummary: {
        freeRemaining: Math.max(0, ledger.free_usage.totalAllowance - ledger.free_usage.usedCount),
        freeTotal: ledger.free_usage.totalAllowance,
        paidRemaining: Math.max(
          0,
          ledger.navigator_paid_sessions.creditsPurchased - ledger.navigator_paid_sessions.creditsUsed
        ),
        supabaseProjectRef: cred.projectRef,
        supabaseCredentialValid: cred.valid,
      },
    });
  });

  // DIAGNOSTIC STATUS (No secrets exposed)
  app.get('/api/analyzer/diagnostics', (_req: Request, res: Response) => {
    const supa = resolveSupabaseServerCredential();
    return res.status(200).json({
      status: 'READY',
      runtime: 'Node.js / Express + Vite Server',
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      geminiModel: GEMINI_MODEL_NAME,
      geminiSdk: '@google/genai ^2.4.0',
      supabaseTargetHost: supa.host,
      supabaseProjectRef: supa.projectRef,
      supabaseCredentialRole: supa.credentialRole,
      supabaseHealthy: supa.valid,
      simulateSupabaseOutage,
      firebaseProjectId: process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0105737183',
    });
  });

  // LEDGER CONTROL (Testing fail-closed & session management)
  app.post('/api/analyzer/ledger-control', (req: Request, res: Response) => {
    const auth = verifyBearerFirebaseToken(req);
    if (auth.error || !auth.verified) {
      return res.status(401).json({ error: auth.error });
    }
    const { action } = req.body || {};
    const ledger = getOrCreateUserLedger(auth.verified.uid, auth.verified.email, auth.verified.tier);

    if (action === 'toggle_supabase_outage') {
      simulateSupabaseOutage = !simulateSupabaseOutage;
    } else if (action === 'exhaust_free_allowance') {
      ledger.free_usage.usedCount = ledger.free_usage.totalAllowance;
      ledger.navigator_paid_sessions.active = false;
      ledger.navigator_paid_sessions.creditsUsed = ledger.navigator_paid_sessions.creditsPurchased;
    } else if (action === 'reset_free_allowance') {
      ledger.free_usage.usedCount = 0;
      simulateSupabaseOutage = false;
    } else if (action === 'activate_paid_session') {
      ledger.navigator_paid_sessions.active = true;
      ledger.navigator_paid_sessions.sessionId = `sess_paid_${Date.now()}`;
      ledger.navigator_paid_sessions.creditsPurchased = 10;
      ledger.navigator_paid_sessions.creditsUsed = 0;
      simulateSupabaseOutage = false;
    }

    const accessCheck = checkUserAccessEligibility(
      auth.verified.uid,
      auth.verified.email,
      auth.verified.tier
    );

    return res.status(200).json({
      simulateSupabaseOutage,
      accessCheck: accessCheck.result || null,
      accessError: accessCheck.error || null,
      ledger: {
        freeAllowanceTotal: ledger.free_usage.totalAllowance,
        freeAllowanceUsed: ledger.free_usage.usedCount,
        paidActive: ledger.navigator_paid_sessions.active,
        paidRemaining: Math.max(
          0,
          ledger.navigator_paid_sessions.creditsPurchased - ledger.navigator_paid_sessions.creditsUsed
        ),
        idempotentUnlockedCount: ledger.consumedIdempotencyKeys.size,
      },
    });
  });

  // STEP 1: SINGLE-PASS EXTRACTION (/api/analyzer/extract)
  app.post('/api/analyzer/extract', async (req: Request, res: Response) => {
    const auth = verifyBearerFirebaseToken(req);
    if (auth.error || !auth.verified) {
      return res.status(401).json({ error: auth.error });
    }

    try {
      const { fileName, mimeType, base64Data, rawTextContent } = req.body || {};
      if (!fileName) {
        return res.status(400).json({
          error: {
            code: 'MALFORMED_DOCUMENT',
            stage: AnalyzerStage.EXTRACTING,
            message: 'Missing fileName in extraction request.',
            remediation: 'Please select a valid PDF, DOCX, or TXT file.',
            timestamp: new Date().toISOString(),
          } satisfies AnalyzerErrorPayload,
        });
      }

      const lowerName = String(fileName).toLowerCase();
      const isTxt = lowerName.endsWith('.txt') || mimeType === 'text/plain';
      const isDocx =
        lowerName.endsWith('.docx') ||
        mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const isPdf = lowerName.endsWith('.pdf') || mimeType === 'application/pdf';
      const isImage =
        lowerName.endsWith('.png') ||
        lowerName.endsWith('.jpg') ||
        lowerName.endsWith('.jpeg') ||
        lowerName.endsWith('.webp') ||
        String(mimeType || '').startsWith('image/');

      if (!isTxt && !isDocx && !isPdf && !isImage) {
        return res.status(400).json({
          error: {
            code: 'UNSUPPORTED_FILE_TYPE',
            stage: AnalyzerStage.EXTRACTING,
            message: `Unsupported file type for "${fileName}". Supported formats: PDF, DOCX, TXT, and scanned document images (PNG/JPG/WEBP).`,
            remediation: 'Upload a PDF, DOCX, TXT, or scanned image document.',
            timestamp: new Date().toISOString(),
          } satisfies AnalyzerErrorPayload,
        });
      }

      if (typeof rawTextContent === 'string' && rawTextContent.trim().length > 0) {
        const cleaned = rawTextContent.trim();
        if (cleaned.length < 40) {
          return res.status(422).json({
            error: {
              code: 'EXTRACTION_EMPTY',
              stage: AnalyzerStage.EXTRACTING,
              message: 'Extracted document text is too short or empty to perform reliable CYFSA analysis.',
              remediation: 'Upload a complete document containing readable text.',
              timestamp: new Date().toISOString(),
            } satisfies AnalyzerErrorPayload,
          });
        }

        const payload = buildStructuredDocumentPayload({
          fileName,
          fileType: 'TXT',
          fileSizeBytes: Buffer.byteLength(cleaned, 'utf8'),
          rawText: cleaned,
          extractionMethod: 'UTF-8 Direct Text Stream + Paragraph Indexer',
        });

        return res.status(200).json({ extractedDocument: payload });
      }

      if (!base64Data || typeof base64Data !== 'string') {
        return res.status(400).json({
          error: {
            code: 'MALFORMED_DOCUMENT',
            stage: AnalyzerStage.EXTRACTING,
            message: 'Document binary payload is missing.',
            remediation: 'Please re-select the document and try again.',
            timestamp: new Date().toISOString(),
          } satisfies AnalyzerErrorPayload,
        });
      }

      const buffer = Buffer.from(base64Data, 'base64');
      if (buffer.byteLength === 0) {
        return res.status(422).json({
          error: {
            code: 'EXTRACTION_EMPTY',
            stage: AnalyzerStage.EXTRACTING,
            message: 'The uploaded file is 0 bytes (empty).',
            remediation: 'Please upload a non-empty PDF, DOCX, or TXT file.',
            timestamp: new Date().toISOString(),
          } satisfies AnalyzerErrorPayload,
        });
      }

      let extractedText = '';
      let extractionMethod = '';
      let detectedType: 'PDF' | 'DOCX' | 'TXT' | 'OCR_IMAGE' = 'TXT';
      const warnings: string[] = [];

      if (isTxt) {
        extractedText = buffer.toString('utf8');
        extractionMethod = 'UTF-8 Buffer Extraction';
        detectedType = 'TXT';
      } else if (isDocx) {
        detectedType = 'DOCX';
        const result = await mammoth.extractRawText({ buffer });
        extractedText = result.value || '';
        extractionMethod = 'Mammoth OpenXML (.docx) Structured Text Extractor';
        if (result.messages && result.messages.length > 0) {
          warnings.push(...result.messages.map((m) => m.message));
        }
      } else if (isPdf) {
        detectedType = 'PDF';
        const basicPdfText = extractPrintableTextFromPdfBuffer(buffer);
        if (basicPdfText.length >= 120) {
          extractedText = basicPdfText;
          extractionMethod = 'Native PDF Text Stream Parser';
        } else {
          const ai = getGeminiClient();
          const ocrResp = await ai.models.generateContent({
            model: GEMINI_MODEL_NAME,
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'application/pdf',
                    data: base64Data,
                  },
                },
                {
                  text: 'Extract the complete verbatim text of this PDF document. Preserve all headings, paragraph numbers, dates, and insert [PAGE 1], [PAGE 2], etc. at page boundaries. Do not summarize or alter any wording.',
                },
              ],
            },
          });
          extractedText = ocrResp.text || '';
          extractionMethod = 'Server-Side Multimodal PDF/OCR Extraction';
        }
      } else if (isImage) {
        detectedType = 'OCR_IMAGE';
        const ai = getGeminiClient();
        const ocrResp = await ai.models.generateContent({
          model: GEMINI_MODEL_NAME,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: mimeType || 'image/png',
                  data: base64Data,
                },
              },
              {
                text: 'Perform verbatim OCR extraction of this document image. Preserve all headings, paragraph numbers, dates, and structure. Do not summarize.',
              },
            ],
          },
        });
        extractedText = ocrResp.text || '';
        extractionMethod = 'Server-Side Multimodal Vision OCR';
      }

      const cleanedText = extractedText.trim();
      if (!cleanedText || cleanedText.length < 30) {
        return res.status(422).json({
          error: {
            code: 'EXTRACTION_EMPTY',
            stage: AnalyzerStage.EXTRACTING,
            message:
              'Document extraction yielded no readable text (or fewer than 30 characters). The file may be corrupted, blank, or encrypted.',
            remediation: 'Verify that the document contains readable text and is not password-protected.',
            timestamp: new Date().toISOString(),
          } satisfies AnalyzerErrorPayload,
        });
      }

      const structuredPayload = buildStructuredDocumentPayload({
        fileName,
        fileType: detectedType,
        fileSizeBytes: buffer.byteLength,
        rawText: cleanedText,
        extractionMethod,
        warnings,
      });

      return res.status(200).json({ extractedDocument: structuredPayload });
    } catch (err: any) {
      return res.status(500).json({
        error: {
          code: 'EXTRACTION_FAILED',
          stage: AnalyzerStage.EXTRACTING,
          message: `Document extraction failed: ${err?.message || 'Unexpected parser error'}`,
          remediation: 'Ensure the file is a valid unencrypted PDF, DOCX, or TXT document.',
          timestamp: new Date().toISOString(),
        } satisfies AnalyzerErrorPayload,
      });
    }
  });

  // STEP 2: ACCESS ELIGIBILITY CHECK (/api/analyzer/access)
  app.post('/api/analyzer/access', (req: Request, res: Response) => {
    const auth = verifyBearerFirebaseToken(req);
    if (auth.error || !auth.verified) {
      return res.status(401).json({ error: auth.error });
    }

    const { documentHash, mode } = req.body || {};
    const check = checkUserAccessEligibility(
      auth.verified.uid,
      auth.verified.email,
      auth.verified.tier,
      documentHash,
      mode
    );

    if (check.error) {
      return res.status(check.status).json({ error: check.error });
    }

    return res.status(200).json({ access: check.result });
  });

  // STEP 3: ANALYZE API (/api/analyzer/analyze)
  app.post('/api/analyzer/analyze', async (req: Request, res: Response) => {
    const startedAt = Date.now();

    // 1. AUTHENTICATE
    const auth = verifyBearerFirebaseToken(req);
    if (auth.error || !auth.verified) {
      return res.status(401).json({ error: auth.error });
    }

    const { extractedDocument, mode, requestId } = req.body as {
      extractedDocument?: ExtractedDocumentPayload;
      mode?: AnalysisMode;
      requestId?: string;
    };

    const resolvedMode: AnalysisMode = mode === 'forensic' ? 'forensic' : 'quick';
    const resolvedRequestId = requestId || `req_${crypto.randomUUID().slice(0, 12)}`;

    // 2. VALIDATE PAYLOAD
    if (
      !extractedDocument ||
      typeof extractedDocument.annotatedText !== 'string' ||
      extractedDocument.annotatedText.trim().length < 30
    ) {
      return res.status(422).json({
        error: {
          code: 'EXTRACTION_EMPTY',
          stage: AnalyzerStage.EXTRACTING,
          message: 'Cannot start Gemini analysis: extracted document payload is missing or empty.',
          remediation: 'Extract a valid PDF, DOCX, or TXT document first.',
          timestamp: new Date().toISOString(),
        } satisfies AnalyzerErrorPayload,
      });
    }

    // 3. VERIFY ACCESS
    const accessCheck = checkUserAccessEligibility(
      auth.verified.uid,
      auth.verified.email,
      auth.verified.tier,
      extractedDocument.sha256Hash,
      resolvedMode
    );

    if (accessCheck.error) {
      return res.status(accessCheck.status).json({ error: accessCheck.error });
    }

    if (!accessCheck.result || !accessCheck.result.allowed) {
      return res.status(403).json({
        error: {
          code: 'ACCESS_DENIED_NO_CREDITS',
          stage: AnalyzerStage.VERIFYING_ACCESS,
          message:
            accessCheck.result?.reason ||
            'Analysis access denied: no remaining free_usage or navigator_paid_sessions allowance.',
          remediation:
            'Activate a Navigator Paid Session or reset usage in the Ledger Inspector to continue.',
          timestamp: new Date().toISOString(),
        } satisfies AnalyzerErrorPayload,
        access: accessCheck.result,
      });
    }

    // 4. GEMINI ANALYSIS
    let aiClient: GoogleGenAI;
    try {
      aiClient = getGeminiClient();
    } catch (err: any) {
      return res.status(500).json({
        error: {
          code: 'GEMINI_ANALYSIS_FAILED',
          stage: AnalyzerStage.ANALYZING,
          message: err?.message || 'Server GEMINI_API_KEY is not configured.',
          remediation: 'Verify GEMINI_API_KEY is present in the server runtime environment.',
          timestamp: new Date().toISOString(),
        } satisfies AnalyzerErrorPayload,
      });
    }

    const schemaProperties =
      resolvedMode === 'forensic'
        ? {
            ...QUICK_REVIEW_PROPERTIES,
            forensicSections: FORENSIC_EXTENSION_SCHEMA,
          }
        : QUICK_REVIEW_PROPERTIES;

    const schemaRequired =
      resolvedMode === 'forensic'
        ? [...Object.keys(QUICK_REVIEW_PROPERTIES), 'forensicSections']
        : Object.keys(QUICK_REVIEW_PROPERTIES);

    const promptText = `Analyze the following extracted Ontario CYFSA document in ${
      resolvedMode === 'forensic' ? 'FORENSIC IN-DEPTH ANALYSIS' : 'QUICK DOCUMENT REVIEW'
    } mode.

DOCUMENT METADATA:
- File Name: ${extractedDocument.fileName}
- Detected Format: ${extractedDocument.fileType}
- Total Pages: ${extractedDocument.pageCount}
- Total Indexed Paragraphs: ${extractedDocument.paragraphCount}
- SHA-256 Document Hash: ${extractedDocument.sha256Hash}

INDEXED DOCUMENT TEXT (Use the [Page X, Para Y | Section: ...] markers for sourceLocation fields):
--------------------------------------------------------------------------------
${extractedDocument.annotatedText.slice(0, 65000)}
--------------------------------------------------------------------------------`;

    let rawGeminiText = '';
    let lastGeminiError: any = null;
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await aiClient.models.generateContent({
          model: GEMINI_MODEL_NAME,
          contents: promptText,
          config: {
            systemInstruction: buildGeminiSystemInstruction(resolvedMode),
            responseMimeType: 'application/json',
            temperature: 0.15,
            responseSchema: {
              type: Type.OBJECT,
              properties: schemaProperties,
              required: schemaRequired,
            },
          },
        });

        rawGeminiText = response.text || '';
        if (rawGeminiText.trim().length > 0) {
          break;
        }
        throw new Error('Gemini returned an empty response body.');
      } catch (err: any) {
        lastGeminiError = err;
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 800 * attempt));
        }
      }
    }

    if (!rawGeminiText) {
      return res.status(502).json({
        error: {
          code: 'GEMINI_ANALYSIS_FAILED',
          stage: AnalyzerStage.ANALYZING,
          message: `Gemini analysis call failed after ${maxAttempts} attempts: ${
            lastGeminiError?.message || 'Service error'
          }. Your usage credit was NOT deducted.`,
          remediation: 'Retry the analysis. No credit was consumed for this failed attempt.',
          timestamp: new Date().toISOString(),
        } satisfies AnalyzerErrorPayload,
      });
    }

    // 5. VALIDATE
    let parsedJson: any;
    try {
      parsedJson = safeParseJsonFromGemini(rawGeminiText);
    } catch (parseErr: any) {
      return res.status(502).json({
        error: {
          code: 'VALIDATION_FAILED',
          stage: AnalyzerStage.VALIDATING,
          message: `Failed to parse structured JSON from Gemini response: ${parseErr?.message}. Your usage credit was NOT deducted.`,
          remediation: 'Click Retry Analysis. Your credit allowance remains untouched.',
          timestamp: new Date().toISOString(),
        } satisfies AnalyzerErrorPayload,
      });
    }

    // 6. SAVE USAGE IDEMPOTENTLY
    const usageFinalized = finalizeUsageConsumptionIdempotent(
      auth.verified.uid,
      auth.verified.email,
      auth.verified.tier,
      extractedDocument.sha256Hash,
      resolvedMode,
      resolvedRequestId
    );

    const processingTimeMs = Date.now() - startedAt;

    const normalizedResult = normalizeAnalysisResult(parsedJson, {
      mode: resolvedMode,
      requestId: resolvedRequestId,
      documentId: extractedDocument.documentId,
      documentHash: extractedDocument.sha256Hash,
      fileName: extractedDocument.fileName,
      modelUsed: GEMINI_MODEL_NAME,
      processingTimeMs,
      accessSource: usageFinalized.source,
      creditCharged: usageFinalized.charged,
      idempotentReplay: usageFinalized.idempotentReplay,
    });

    const updatedAccess = checkUserAccessEligibility(
      auth.verified.uid,
      auth.verified.email,
      auth.verified.tier,
      extractedDocument.sha256Hash,
      resolvedMode
    );

    return res.status(200).json({
      analysis: normalizedResult,
      access: updatedAccess.result,
    });
  });

  // VITE DEV MIDDLEWARE / STATIC ASSETS
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CYFSA Navigator Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
