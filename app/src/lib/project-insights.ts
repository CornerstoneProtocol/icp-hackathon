import { fromStablecoin, ProjectStaticConfig } from '@/lib/icp';
import { ProjectMetrics, PhaseInfo } from '@/lib/canister-queries';

const PHASE_LABELS = [
  'Fundraising and Acquisition',
  'Design and Architectural',
  'Permitting',
  'Abatement/Demolition',
  'Construction',
  'Revenue and Sales',
] as const;

const DAY_MS = 86_400_000;

export type InsightChartPoint = {
  timestamp: number;
  isoLabel: string;
  dailyDeposits: number;
  dailyWithdrawals: number;
  dailyReserveFunded: number;
  cumulativeDeposits: number;
  cumulativeWithdrawals: number;
  cumulativeReserveFunded: number;
  netExposure: number;
};

export type InsightPhaseOverlay = {
  phaseId: number;
  label: string;
  start: number;
  end: number;
  aprPercent: number;
  capAmount: number;
  capPercent: number;
  status: 'past' | 'current' | 'upcoming';
};

export type InsightEventMarker = {
  id: string;
  type: 'deposit' | 'withdrawal' | 'phase' | 'reserve' | 'proceeds' | 'fundraise' | 'appraisal';
  timestamp: number;
  title: string;
  subtitle?: string;
  amount?: number;
  phaseId?: number;
  tone: 'primary' | 'success' | 'warning' | 'info';
};

export type ProjectInsightsData = {
  points: InsightChartPoint[];
  phases: InsightPhaseOverlay[];
  events: InsightEventMarker[];
  totals: {
    totalDeposited: number;
    totalWithdrawn: number;
    netExposure: number;
    lastUpdated: number | null;
  };
  domain: {
    start: number;
    end: number;
  };
};

type BuildArgs = {
  project: ProjectMetrics | null;
  staticConfig: ProjectStaticConfig | null;
  tokenSymbol?: string;
  now?: number;
};

const ZERO_DATA: ProjectInsightsData = {
  points: [],
  phases: [],
  events: [],
  totals: {
    totalDeposited: 0,
    totalWithdrawn: 0,
    netExposure: 0,
    lastUpdated: null,
  },
  domain: {
    start: Date.now(),
    end: Date.now(),
  },
};

export function buildProjectInsightsData({
  project,
  staticConfig,
  tokenSymbol,
  now = Date.now(),
}: BuildArgs): ProjectInsightsData {
  if (!project) {
    return ZERO_DATA;
  }

  const totalDeposited = toTokenAmount(project.totalRaised);
  const totalWithdrawn = toTokenAmount(project.totalDevWithdrawn);
  const reserveFunded = toTokenAmount(project.reserveBalance);
  const netExposure = totalDeposited - totalWithdrawn;

  // Derive phase overlays first to get the time range
  const phases = derivePhaseOverlays({
    project,
    staticConfig,
    now,
  });

  // Create historical points based on actual phase progressions
const points: InsightChartPoint[] = [];

// Add a starting point (project inception)
const projectStart = phases.length > 0 ? phases[0].start : now - 180 * DAY_MS;
points.push({
  timestamp: projectStart,
  isoLabel: new Date(projectStart).toISOString(),
  dailyDeposits: 0,
  dailyWithdrawals: 0,
  dailyReserveFunded: 0,
  cumulativeDeposits: 0,
  cumulativeWithdrawals: 0,
  cumulativeReserveFunded: 0,
  netExposure: 0,
});


// Distribute deposits and withdrawals proportionally across completed phases
const completedPhases = Math.min(project.currentPhase + 1, project.phases.length);
const depositPerPhase = totalDeposited / Math.max(1, completedPhases);

for (let i = 0; i < project.phases.length; i++) {
  const phase = project.phases[i];
  const phaseOverlay = phases[i];
  
  if (!phaseOverlay) continue;
  
  const isPastOrCurrent = i <= project.currentPhase;
  const phaseWithdrawn = toTokenAmount(phase.withdrawn);
  
  // Calculate running totals up to this phase
  const runningDeposits = isPastOrCurrent ? depositPerPhase * (i + 1) : depositPerPhase * project.currentPhase;
  const runningWithdrawals = toTokenAmount(project.totalDevWithdrawn) * (i / Math.max(1, project.currentPhase));
  const runningReserve = isPastOrCurrent ? reserveFunded * ((i + 1) / Math.max(1, completedPhases)) : 0;
  
  points.push({
    timestamp: phaseOverlay.end,
    isoLabel: new Date(phaseOverlay.end).toISOString(),
    dailyDeposits: 0,  // ADD - can calculate delta if needed
    dailyWithdrawals: 0,  // ADD
    dailyReserveFunded: 0,  // ADD
    cumulativeDeposits: Math.min(runningDeposits, totalDeposited),
    cumulativeWithdrawals: Math.min(runningWithdrawals, totalWithdrawn),
    cumulativeReserveFunded: runningReserve,
    netExposure: Math.min(runningDeposits, totalDeposited) - Math.min(runningWithdrawals, totalWithdrawn),
  });
}

  points.push({
    timestamp: now,
    isoLabel: new Date(now).toISOString(),
    dailyDeposits: 0,  // ADD - can calculate delta if needed
    dailyWithdrawals: 0,  // ADD
    dailyReserveFunded: 0,
    cumulativeDeposits: totalDeposited,
    cumulativeWithdrawals: totalWithdrawn,
    cumulativeReserveFunded: reserveFunded,
    netExposure,
  });

  const events = deriveEventMarkers({ project });

  const domainStart = phases.length > 0 ? Math.min(...phases.map((p) => p.start)) : now - 180 * DAY_MS;
  const domainEnd = Math.max(now, phases.length > 0 ? Math.max(...phases.map((p) => p.end)) : now);

  return {
    points,
    phases,
    events,
    totals: {
      totalDeposited,
      totalWithdrawn,
      netExposure,
      lastUpdated: now,
    },
    domain: {
      start: domainStart,
      end: domainEnd,
    },
  };
}

function toTokenAmount(value?: bigint | null): number {
  if (value === undefined || value === null) return 0;
  try {
    return Number(fromStablecoin(value));
  } catch {
    return 0;
  }
}

function derivePhaseOverlays({
  project,
  staticConfig,
  now,
}: {
  project: ProjectMetrics;
  staticConfig: ProjectStaticConfig | null;
  now: number;
}): InsightPhaseOverlay[] {
  const targetAmount = staticConfig ? Number(fromStablecoin(staticConfig.maxRaise)) : 0;
  const overlays: InsightPhaseOverlay[] = [];
  
  // Use the project creation/first deposit as the start point instead of calculating backwards
  const projectStart = now - (project.currentPhase * 90 * DAY_MS); // More realistic estimate
  let cursor = projectStart;

  for (let i = 0; i < PHASE_LABELS.length; i++) {
    const phase = project.phases[i];
    const start = cursor;
    
    // Check if we have actual phase close timestamp from documents
    let end: number;
    const phaseDocs = project.phaseDocuments[i];
    if (phaseDocs && phaseDocs.length > 0) {
      const latestDoc = phaseDocs[phaseDocs.length - 1];
      end = Number(latestDoc.submitted_at) / 1_000_000; // Convert from nanoseconds to milliseconds
    } else {
      const durationMs = Number(phase.duration || 7776000) * 1000; // Default 90 days
      end = start + durationMs;
    }

    cursor = end;

    const status: InsightPhaseOverlay['status'] =
      i < project.currentPhase ? 'past' : i === project.currentPhase ? 'current' : 'upcoming';

    const aprPercent = phase.aprBps / 100;
    const capAmount = staticConfig
      ? (Number(fromStablecoin(staticConfig.maxRaise)) * phase.capBps) / 10000
      : 0;
    const capPercent = targetAmount > 0 ? Math.min(100, (capAmount / targetAmount) * 100) : 0;

    overlays.push({
      phaseId: i,
      label: PHASE_LABELS[i],
      start,
      end,
      aprPercent,
      capAmount,
      capPercent,
      status,
    });
  }

  return overlays;
}

function deriveEventMarkers({ project }: { project: ProjectMetrics }): InsightEventMarker[] {
  const markers: InsightEventMarker[] = [];

  // Add phase closed events from documents
  for (let i = 0; i < project.phaseDocuments.length; i++) {
    const docs = project.phaseDocuments[i];
    if (docs && docs.length > 0) {
      // Each phase can have multiple document submissions
      for (const doc of docs) {
        const timestamp = Number(doc.submitted_at) / 1_000_000; // Convert nanoseconds to milliseconds
        markers.push({
          id: `phase-${i}-${doc.submitted_at}`,
          type: 'phase',
          timestamp,
          title: `Phase ${i + 1} Closed`,
          subtitle: `${doc.doc_types.length} document(s) submitted`,
          tone: 'info',
          phaseId: i,
        });
      }
    }
  }

  // Add appraisal events
  for (const appraisal of project.appraisals) {
    const timestamp = Number(appraisal.submitted_at) / 1_000_000;
    markers.push({
      id: `appraisal-${appraisal.submitted_at}`,
      type: 'appraisal',
      timestamp,
      title: 'Appraisal Submitted',
      subtitle: `${appraisal.percent_complete}% complete`,
      tone: 'info',
    });
  }

  // Derive synthetic events from phase withdrawals
  // (These won't have exact timestamps, but we can estimate based on phase closure)
  for (let i = 0; i < project.phases.length; i++) {
    const phase = project.phases[i];
    const phaseWithdrawn = phase.withdrawn;
    
    if (phaseWithdrawn > 0n) {
      // Try to get timestamp from phase documents if available
      const phaseDocs = project.phaseDocuments[i];
      const timestamp = phaseDocs && phaseDocs.length > 0
        ? Number(phaseDocs[phaseDocs.length - 1].submitted_at) / 1_000_000
        : Date.now(); // Fallback to current time if no docs
      
      markers.push({
        id: `withdrawal-phase-${i}`,
        type: 'withdrawal',
        timestamp,
        title: `Phase ${i + 1} Funds Withdrawn`,
        subtitle: formatAmountSubtitle(phaseWithdrawn),
        amount: toTokenAmount(phaseWithdrawn),
        tone: 'warning',
        phaseId: i,
      });
    }
  }

  // Add synthetic deposit event (total raised)
  if (project.totalRaised > 0n) {
    // Use the first phase doc timestamp as estimate, or current time
    const firstPhaseDoc = project.phaseDocuments[0]?.[0];
    const estimatedDepositTime = firstPhaseDoc 
      ? Number(firstPhaseDoc.submitted_at) / 1_000_000 
      : Date.now() - 90 * 24 * 60 * 60 * 1000; // 90 days ago as fallback
    
    markers.push({
      id: `deposits-aggregate`,
      type: 'deposit',
      timestamp: estimatedDepositTime,
      title: 'Fundraising Completed',
      subtitle: formatAmountSubtitle(project.totalRaised),
      amount: toTokenAmount(project.totalRaised),
      tone: 'success',
    });
  }

  // Add reserve funded event if reserve exists
  if (project.reserveBalance > 0n) {
    // Estimate reserve funding happened after first phase
    const firstPhaseDoc = project.phaseDocuments[0]?.[0];
    const estimatedReserveTime = firstPhaseDoc 
      ? Number(firstPhaseDoc.submitted_at) / 1_000_000 + (7 * 24 * 60 * 60 * 1000) // 7 days after phase 0
      : Date.now() - 60 * 24 * 60 * 60 * 1000; // 60 days ago as fallback
    
    markers.push({
      id: `reserve-funded`,
      type: 'reserve',
      timestamp: estimatedReserveTime,
      title: 'Interest Reserve Funded',
      subtitle: formatAmountSubtitle(project.reserveBalance),
      amount: toTokenAmount(project.reserveBalance),
      tone: 'success',
    });
  }

  // Add principal buffer/proceeds event if available
  if (project.principalBuffer > 0n) {
    // Estimate proceeds submission happened recently or after last phase
    const lastPhaseWithDocs = project.phaseDocuments.findIndex((docs, idx) => 
      idx === project.phaseDocuments.length - 1 && docs && docs.length > 0
    );
    const lastDoc = lastPhaseWithDocs >= 0 
      ? project.phaseDocuments[lastPhaseWithDocs]?.[0]
      : null;
    
    const estimatedProceedsTime = lastDoc
      ? Number(lastDoc.submitted_at) / 1_000_000 + (14 * 24 * 60 * 60 * 1000) // 14 days after last phase
      : Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days ago as fallback
    
    markers.push({
      id: `proceeds-submitted`,
      type: 'proceeds',
      timestamp: estimatedProceedsTime,
      title: 'Sales Proceeds Submitted',
      subtitle: formatAmountSubtitle(project.principalBuffer),
      amount: toTokenAmount(project.principalBuffer),
      tone: 'success',
    });
  }

  // Add fundraise closed event if applicable
  if (project.fundraiseClosed) {
    const firstPhaseDoc = project.phaseDocuments[0]?.[0];
    const closedTime = firstPhaseDoc
      ? Number(firstPhaseDoc.submitted_at) / 1_000_000
      : Date.now() - 90 * 24 * 60 * 60 * 1000;
    
    markers.push({
      id: `fundraise-closed`,
      type: 'fundraise',
      timestamp: closedTime,
      title: project.fundraiseSuccessful ? 'Fundraise Closed — Successful' : 'Fundraise Closed',
      tone: project.fundraiseSuccessful ? 'success' : 'info',
    });
  }

  return markers.sort((a, b) => a.timestamp - b.timestamp);
}

// Helper function to format amount for subtitle
function formatAmountSubtitle(value: bigint | undefined): string | undefined {
  if (!value) return undefined;
  const amount = toTokenAmount(value);
  if (!amount) return undefined;
  return `${formatNumber(amount)} tokens`;
}

// Helper function to format numbers nicely
function formatNumber(value: number): string {
  return Intl.NumberFormat('en-US', {
    maximumFractionDigits: value >= 100 ? 0 : value >= 10 ? 1 : 2,
  }).format(value);
}