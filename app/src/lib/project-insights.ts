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
  type: 'phase' | 'appraisal';
  timestamp: number;
  title: string;
  subtitle?: string;
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

  // Create historical points based on phases for better visualization
  const points: InsightChartPoint[] = [];
  
  // Add a starting point (project inception)
  const projectStart = phases.length > 0 ? phases[0].start : now - 180 * DAY_MS;
  points.push({
    timestamp: projectStart,
    isoLabel: new Date(projectStart).toISOString(),
    cumulativeDeposits: 0,
    cumulativeWithdrawals: 0,
    cumulativeReserveFunded: 0,
    netExposure: 0,
  });

  // Add points at phase transitions to show progression
  let runningDeposits = 0;
  let runningWithdrawals = 0;
  let runningReserve = 0;
  
  for (let i = 0; i < project.phases.length; i++) {
    const phase = project.phases[i];
    const phaseOverlay = phases[i];
    
    if (!phaseOverlay) continue;
    
    // Estimate deposits and withdrawals per phase
    const phaseProgress = i <= project.currentPhase ? 1 : 0;
    const phaseDeposits = (totalDeposited / project.phases.length) * phaseProgress;
    const phaseWithdrawals = toTokenAmount(phase.withdrawn);
    
    runningDeposits += phaseDeposits;
    runningWithdrawals += phaseWithdrawals;
    
    // Add reserve funding at phase start if it's a past phase
    if (i <= project.currentPhase && i > 0) {
      runningReserve = reserveFunded * (i / Math.max(1, project.currentPhase));
    }
    
    // Add point at phase start
    points.push({
      timestamp: phaseOverlay.start,
      isoLabel: new Date(phaseOverlay.start).toISOString(),
      cumulativeDeposits: runningDeposits,
      cumulativeWithdrawals: runningWithdrawals,
      cumulativeReserveFunded: runningReserve,
      netExposure: runningDeposits - runningWithdrawals,
    });
    
    // Add point at phase end
    points.push({
      timestamp: phaseOverlay.end,
      isoLabel: new Date(phaseOverlay.end).toISOString(),
      cumulativeDeposits: runningDeposits,
      cumulativeWithdrawals: runningWithdrawals,
      cumulativeReserveFunded: runningReserve,
      netExposure: runningDeposits - runningWithdrawals,
    });
  }

  // Add current point with actual values
  points.push({
    timestamp: now,
    isoLabel: new Date(now).toISOString(),
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
  
  // Calculate project start based on current phase
  // Assume each completed phase took its duration, current phase is in progress
  let projectStart = now;
  for (let i = 0; i < project.currentPhase; i++) {
    const duration = Number(project.phases[i]?.duration || 7776000); // 90 days default in seconds
    projectStart -= duration * 1000;
  }
  
  // Subtract half the current phase duration to show we're midway
  const currentPhaseDuration = Number(project.phases[project.currentPhase]?.duration || 7776000);
  projectStart -= (currentPhaseDuration * 1000) / 2;
  
  let cursor = projectStart;

  for (let i = 0; i < PHASE_LABELS.length; i++) {
    const phase = project.phases[i];
    const start = cursor;
    const durationMs = Number(phase.duration || 7776000) * 1000; // Default 90 days
    const end = start + durationMs;

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
      const latestDoc = docs[docs.length - 1];
      markers.push({
        id: `phase-${i}`,
        type: 'phase',
        timestamp: Number(latestDoc.submitted_at) * 1000,
        title: `Phase ${i + 1} Closed`,
        tone: 'info',
        phaseId: i,
      });
    }
  }

  // Add recent appraisals
  for (const appraisal of project.appraisals.slice(-2)) {
    markers.push({
      id: `appraisal-${appraisal.submitted_at}`,
      type: 'appraisal',
      timestamp: Number(appraisal.submitted_at) * 1000,
      title: 'Appraisal Submitted',
      subtitle: `${appraisal.percent_complete}% complete`,
      tone: 'info',
    });
  }

  return markers.sort((a, b) => a.timestamp - b.timestamp);
}