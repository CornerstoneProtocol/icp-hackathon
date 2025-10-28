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

  // For ICP, we don't have individual transaction events stored
  // We create a simplified view based on current state
  const totalDeposited = toTokenAmount(project.totalRaised);
  const totalWithdrawn = toTokenAmount(project.totalDevWithdrawn);
  const netExposure = totalDeposited - totalWithdrawn;

  // Create a single point representing current state
  const currentPoint: InsightChartPoint = {
    timestamp: now,
    isoLabel: new Date(now).toISOString(),
    cumulativeDeposits: totalDeposited,
    cumulativeWithdrawals: totalWithdrawn,
    cumulativeReserveFunded: toTokenAmount(project.reserveBalance),
    netExposure,
  };

  const points = [currentPoint];

  const phases = derivePhaseOverlays({
    project,
    staticConfig,
    now,
  });

  const events = deriveEventMarkers({ project });

  const domainStart = phases.length > 0 ? Math.min(...phases.map((p) => p.start)) : now - 30 * DAY_MS;
  const domainEnd = phases.length > 0 ? Math.max(...phases.map((p) => p.end)) : now;

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
  
  let cursor = now - 180 * DAY_MS; // Start 6 months ago as default

  for (let i = 0; i < PHASE_LABELS.length; i++) {
    const phase = project.phases[i];
    const start = cursor;
    const durationMs = Number(phase.duration) * 1000;
    const end = start + (durationMs || 90 * DAY_MS);

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