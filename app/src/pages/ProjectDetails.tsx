import { useEffect, useMemo, useState, ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { RoleGate, Role } from '@/components/RoleGate';
import { TimelineCard } from '@/components/TimelineCard';
import ProjectInsightsPanel from '@/components/project/ProjectInsightsPanel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Edit, Upload, DollarSign, AlertTriangle, MessageSquare, Banknote, DoorClosed, Wallet, FileText, Target, Users, ShieldCheck, HardHat } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { 
  getAccount, 
  login, 
  isAuthenticated,
  fetchProjectRealtimeState, 
  fetchProjectStaticConfig,
  deposit,
  claimInterest,
  withdrawPrincipal,
  fundReserve,
  withdrawPhaseFunds,
  submitSalesProceeds,
  closePhase,
  toStablecoin,
  fromStablecoin,
  ProjectRealtimeState,
  ProjectStaticConfig,
  DocRecord,
} from '@/lib/icp';
import { getCompleteProjectData, getProjectSupportersCount } from '@/lib/canister-queries';
import { TOKEN_CONFIG, getTokenConfigByCanisterId } from '@/config/canisters';
import { Principal } from '@dfinity/principal';
import { buildProjectInsightsData, ProjectInsightsData } from '@/lib/project-insights';
import { icpUpload } from '@/lib/icp-storage';

const ProjectDetails = () => {
  const { id } = useParams();
  const [currentRole, setCurrentRole] = useState<Role>('holder');
  const [activeTab, setActiveTab] = useState('milestones');

  // UI state
  const [supportAmount, setSupportAmount] = useState('');
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [depositStep, setDepositStep] = useState<'amount' | 'deposit'>('amount');
  
  // Developer action states
  const [reserveAmount, setReserveAmount] = useState('');
  const [fundReserveModalOpen, setFundReserveModalOpen] = useState(false);
  const [fundReserveStep, setFundReserveStep] = useState<'amount' | 'fund'>('amount');
  
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawFundsModalOpen, setWithdrawFundsModalOpen] = useState(false);
  const [withdrawFundsStep, setWithdrawFundsStep] = useState<'amount' | 'withdraw'>('amount');
  
  const [proceedsAmount, setProceedsAmount] = useState('');
  const [submitProceedsModalOpen, setSubmitProceedsModalOpen] = useState(false);
  const [submitProceedsStep, setSubmitProceedsStep] = useState<'amount' | 'submit'>('amount');
  
  const [uploadedDocs, setUploadedDocs] = useState<File[]>([]);
  
  // Phase document viewer state
  const [activeDocPhase, setActiveDocPhase] = useState(0);
  const [phaseDocuments, setPhaseDocuments] = useState<any[][]>([[], [], [], [], [], []]);
  
  // Loading states
  const [isDepositing, setIsDepositing] = useState(false);
  const [isClaimingInterest, setIsClaimingInterest] = useState(false);
  const [isRedeemingPrincipal, setIsRedeemingPrincipal] = useState(false);
  const [isFundingReserve, setIsFundingReserve] = useState(false);
  const [isClosingPhase, setIsClosingPhase] = useState(false);
  const [isWithdrawingFunds, setIsWithdrawingFunds] = useState(false);
  const [isSubmittingProceeds, setIsSubmittingProceeds] = useState(false);

  // Project data
  const canisterId = id; // In ICP, the project canister ID is the identifier
  const [account, setAccount] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [realtimeData, setRealtimeData] = useState<ProjectRealtimeState | null>(null);
  const [staticConfig, setStaticConfig] = useState<ProjectStaticConfig | null>(null);
  const [projectData, setProjectData] = useState<any>(null);
  const [supporters, setSupporters] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const resetDepositModal = () => {
    setDepositModalOpen(false);
    setDepositStep('amount');
    setSupportAmount('');
  };

  const resetFundReserveModal = () => {
    setFundReserveModalOpen(false);
    setFundReserveStep('amount');
    setReserveAmount('');
  };

  const resetWithdrawFundsModal = () => {
    setWithdrawFundsModalOpen(false);
    setWithdrawFundsStep('amount');
    setWithdrawAmount('');
  };

  const resetSubmitProceedsModal = () => {
    setSubmitProceedsModalOpen(false);
    setSubmitProceedsStep('amount');
    setProceedsAmount('');
  };

  // Determine which token this project uses
  const projectTokenConfig = useMemo(() => {
    // For now, use default token config since ICP projects don't store stablecoin address
    // In the future, you might want to store this in project params
    return TOKEN_CONFIG;
  }, []);

  async function connectWallet() {
    try {
      await login('plug'); // Default to Internet Identity, can add method selection
      const addr = await getAccount();
      if (addr) {
        setAccount(addr);
        setConnected(true);
        toast.success('Wallet connected');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Connect failed');
    }
  }

  function phaseName(idx: number) {
    const names = [
      'Fundraising and Acquisition',
      'Design and Architectural',
      'Permitting',
      'Abatement/Demolition',
      'Construction',
      'Revenue and Sales',
    ] as const;
    if (idx < 0) idx = 0;
    return names[idx] ?? 'Unknown';
  }

  async function refresh() {
    try {
      if (!canisterId) return;
      
      setLoading(true);

      // Get user principal if connected
      let userPrincipal: Principal | undefined;
      if (account) {
        try {
          userPrincipal = Principal.fromText(account);
        } catch {
          console.warn('Could not parse account as Principal');
        }
      }

      // Fetch data in parallel
      const [projectResult, realtimeResult, staticResult, supportersCount] = await Promise.all([
        getCompleteProjectData(canisterId, userPrincipal),
        fetchProjectRealtimeState(canisterId, userPrincipal),
        fetchProjectStaticConfig(canisterId),
        getProjectSupportersCount(canisterId),
      ]);
      
      setProjectData(projectResult);
      setRealtimeData(realtimeResult);
      setStaticConfig(staticResult);
      setSupporters(supportersCount);
    } catch (e) {
      console.error('Error refreshing project data:', e);
      toast.error('Failed to load project data');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    isAuthenticated().then((auth) => {
      if (auth) {
        getAccount().then((a) => {
          if (a) {
            setAccount(a);
            setConnected(true);
          }
        });
      }
    });
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canisterId, account]);

  // Process phase documents from project data
  useEffect(() => {
    if (!projectData?.project?.phaseDocuments) return;
    
    const phaseClosedEvents = projectData.project.phaseDocuments || [];
    const docsByPhase: any[][] = [[], [], [], [], [], []];

    phaseClosedEvents.forEach((phaseDoc: any, phaseIndex: number) => {
      if (phaseIndex < 0 || phaseIndex > 5) return;
      if (!phaseDoc || !Array.isArray(phaseDoc)) return;
      
      const phaseDocs = phaseDoc.map((doc: any, docIndex: number) => ({
        id: `phase${phaseIndex}-doc${docIndex}`,
        type: doc.doc_type || 'document',
        hash: doc.doc_hash || '',
        uri: doc.metadata_uri || '',
      }));
      
      docsByPhase[phaseIndex] = phaseDocs;
    });

    setPhaseDocuments(docsByPhase);
  }, [projectData]);

  const withdrawableNow = Number(fromStablecoin(realtimeData?.totalDevWithdrawn ?? 0n));

  const totalRaisedRaw = projectData?.project?.totalRaised ?? 0n;
  const totalDevWithdrawnRaw = projectData?.project?.totalDevWithdrawn ?? 0n;
  const poolBalanceRaw = realtimeData?.poolBalance ?? 0n;
  const principalBufferRaw = realtimeData?.principalBuffer ?? 0n;
  const interestAccruedRaw = poolBalanceRaw + totalDevWithdrawnRaw - totalRaisedRaw - principalBufferRaw;
  const interestAccrued = Number(fromStablecoin(interestAccruedRaw > 0n ? interestAccruedRaw : 0n));

  const project = {
    name: staticConfig?.projectName?.trim() || 'Cornerstone Residences',
    status: 'Active',
    canisterId: canisterId ?? '0x',
    owner: staticConfig?.owner ?? '',
    raised: Number(fromStablecoin(totalRaisedRaw)),
    withdrawn: Number(fromStablecoin(totalDevWithdrawnRaw)),
    target: Number(staticConfig?.maxRaise ? fromStablecoin(staticConfig.maxRaise) : '0'),
    minTarget: Number(staticConfig?.minRaise ? fromStablecoin(staticConfig.minRaise) : '0'),
    escrow: Number(realtimeData?.reserveBalance ? fromStablecoin(realtimeData.reserveBalance) : '0'),
    withdrawable: withdrawableNow,
    currentPhase: phaseName(projectData?.project?.currentPhase ?? 0),
    milestones: 0,
    supporters: supporters ?? 0,
    interestAccrued,
    description:
      'Redevelopment of a 120k sq. ft. mixed-use tower with ground floor retail, 140 market-rate apartments, and a rooftop amenity deck overlooking the South Lakefront Greenway.',
  };

  const raisedPercentage = project.target > 0 ? (project.raised / project.target) * 100 : 0;
  const withdrawnPercentage = project.target > 0 ? (project.withdrawn / project.target) * 100 : 0;
  const minRaisePercentage = project.target > 0 ? (project.minTarget / project.target) * 100 : 0;
  const format = (n: number) => n.toLocaleString('en-US');

  // Phases data (6 phases)
  const phaseNames = [
    'Fundraising and Acquisition',
    'Design and Architectural',
    'Permitting',
    'Abatement/Demolition',
    'Construction',
    'Revenue and Sales',
  ] as const;

  // Build phase details from project data
  const currentPhaseIndex = Math.max(0, projectData?.project?.currentPhase ?? 0);
  const phases = projectData?.project?.phases || [];
  
  const phasesDetails = phaseNames.map((name, i) => {
    const phaseMetric = phases[i];
    const capAmount = phaseMetric?.phaseCap ? Number(fromStablecoin(BigInt(phaseMetric.phaseCap))) : 0;
    const withdrawn = phaseMetric?.phaseWithdrawn ? Number(fromStablecoin(BigInt(phaseMetric.phaseWithdrawn))) : 0;
    const aprBps = phaseMetric?.aprBps ? Number(phaseMetric.aprBps) : 0;
    const capBps = phaseMetric?.capBps ? Number(phaseMetric.capBps) : 0;
    
    const status = i < currentPhaseIndex ? 'Past' : i === currentPhaseIndex ? 'Current' : 'Upcoming';
    const withdrawnPctOfCap = capAmount > 0 ? Math.min(100, (withdrawn / capAmount) * 100) : 0;
    const showWithdrawn = i < currentPhaseIndex || (i === currentPhaseIndex && withdrawn > 0);
    
    return {
      index: i,
      name,
      apr: aprBps / 100, // Convert from basis points to percentage
      capBps: capBps / 100,
      capAmount,
      withdrawn,
      withdrawnPctOfCap,
      status,
      showWithdrawn,
      showCumulativeCap: i !== phaseNames.length - 1,
    };
  });

  const phaseStatusBadge = {
    Past: 'border-4 border-[#2D572D] bg-[#55AA55] text-white shadow-[2px_2px_0_rgba(0,0,0,0.25)]',
    Current: 'border-4 border-[#AA7700] bg-[#FFD700] text-[#2D1B00] shadow-[2px_2px_0_rgba(0,0,0,0.25)]',
    Upcoming: 'border-4 border-[#3D2817] bg-[#8B7355] text-white shadow-[2px_2px_0_rgba(0,0,0,0.25)]',
  } as const;

  const phaseStatusDot = {
    Past: 'bg-[#55AA55]',
    Current: 'bg-[#FFD700]',
    Upcoming: 'bg-[#8B7355]',
  } as const;

  // Build insights data for flow insights panel
  const insightsData = useMemo(
    () =>
      buildProjectInsightsData({
        project: projectData?.project,
        staticConfig,
        tokenSymbol: projectTokenConfig.symbol,
        now: Date.now(),
      }),
    [projectData, staticConfig, projectTokenConfig.symbol],
  );

  // Format date for timeline
  const formatDateLabel = (timestamp: number | null | undefined) => {
    if (!timestamp || !Number.isFinite(timestamp)) return '';
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatRelativeTime = (timestamp: number | null | undefined) => {
    if (!timestamp || !Number.isFinite(timestamp)) return '';
    const diffSeconds = (timestamp - Date.now()) / 1000;
    const divisions: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
      { amount: 60, unit: 'second' },
      { amount: 60, unit: 'minute' },
      { amount: 24, unit: 'hour' },
      { amount: 7, unit: 'day' },
      { amount: 4.34524, unit: 'week' },
      { amount: 12, unit: 'month' },
      { amount: Infinity, unit: 'year' },
    ];
    try {
      let duration = diffSeconds;
      const formatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });
      for (const division of divisions) {
        if (Math.abs(duration) < division.amount) {
          return formatter.format(Math.round(duration), division.unit);
        }
        duration /= division.amount;
      }
    } catch {
      // ignore if Intl.RelativeTimeFormat is unavailable
    }
    return '';
  };

  const describeTimelineEvent = (event: ProjectInsightsData['events'][number]) => {
    switch (event.type) {
      case 'deposit':
        return event.subtitle ? `Investor deposits totaled ${event.subtitle}.` : 'Investor deposit recorded on-chain.';
      case 'withdrawal':
        return event.subtitle ? `Developer withdrawal processed for ${event.subtitle}.` : 'Developer withdrawal processed.';
      case 'phase':
        return `${typeof event.phaseId === 'number' ? `Phase ${event.phaseId + 1}` : 'Phase'} closed and documentation verified.`;
      case 'reserve':
        return event.subtitle ? `Interest reserve funded with ${event.subtitle}.` : 'Interest reserve funded on-chain.';
      case 'proceeds':
        return event.subtitle ? `Sales proceeds submitted totaling ${event.subtitle}.` : 'Sales proceeds submitted.';
      case 'fundraise':
        return 'Fundraise status updated and captured on-chain.';
      default:
        return 'On-chain update recorded.';
    }
  };

  const timelineEvents = useMemo(() => {
    if (!insightsData?.events?.length) return [];
    const eventTypeMap: Record<ProjectInsightsData['events'][number]['type'], 'milestone' | 'deliverable' | 'payout' | 'update'> = {
      deposit: 'update',
      withdrawal: 'payout',
      phase: 'milestone',
      reserve: 'update',
      proceeds: 'payout',
      fundraise: 'milestone',
    };
    return insightsData.events
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((event) => {
        const dateLabel = formatDateLabel(event.timestamp);
        const relative = formatRelativeTime(event.timestamp);
        const metaParts = [relative, dateLabel, event.subtitle].filter(Boolean);
        const meta = metaParts.length ? metaParts.join(' • ') : 'On-chain update';
        return {
          id: event.id,
          type: eventTypeMap[event.type] ?? 'update',
          title: event.title,
          meta,
          description: describeTimelineEvent(event),
        };
      });
  }, [insightsData.events]);

  const capitalSummaryMetrics = [
    {
      id: 'withdrawn',
      icon: Banknote,
      label: 'Withdrawn',
      value: `${format(project.withdrawn)} ${projectTokenConfig.symbol}`,
      skeletonClass: 'w-20',
    },
    {
      id: 'unlockable',
      icon: ShieldCheck,
      label: 'Unlockable',
      value: `${format(project.withdrawable)} ${projectTokenConfig.symbol}`,
      skeletonClass: 'w-24',
    },
    {
      id: 'min-raise',
      icon: Target,
      label: 'Min Raise',
      value: `${format(project.minTarget)} ${projectTokenConfig.symbol}`,
      skeletonClass: 'w-20',
      hidden: !(loading || project.minTarget > 0),
    },
  ].filter((metric) => !metric.hidden);

  const overviewStats = [
    {
      id: 'reserve',
      label: 'Interest Reserve',
      value: `${format(project.escrow)} ${projectTokenConfig.symbol}`,
      icon: ShieldCheck,
      tone: 'from-emerald-400/80 via-accent/60 to-primary/30',
    },
    {
      id: 'interest',
      label: 'Interest Accrued',
      value: `${format(project.interestAccrued)} ${projectTokenConfig.symbol}`,
      icon: DollarSign,
      tone: 'from-sky-400/80 via-primary/60 to-accent/40',
    },
    {
      id: 'supporters',
      label: 'Supporters',
      value: format(project.supporters),
      icon: Users,
      tone: 'from-indigo-400/80 via-primary/60 to-accent/40',
    },
  ] as const;

  const minecraftPanelClass =
    'rounded-lg border-4 border-[#654321] bg-[#F5DEB3] shadow-[6px_6px_0_rgba(0,0,0,0.35)]';
  const minecraftSubPanelClass =
    'rounded-lg border-4 border-[#654321] bg-[#EBD8B0] shadow-[4px_4px_0_rgba(0,0,0,0.3)]';
  const minecraftHeaderClass = 'border-b-4 border-[#654321] bg-[#C4A484] px-6 py-4';
  const minecraftPrimaryButtonClass =
    'rounded-none bg-[#5599FF] hover:bg-[#4488EE] border-4 border-[#2D5788] text-white font-bold shadow-[3px_3px_0_rgba(0,0,0,0.3)] hover:shadow-[5px_5px_0_rgba(0,0,0,0.3)] active:translate-y-1 active:shadow-[1px_1px_0_rgba(0,0,0,0.3)] disabled:opacity-60 disabled:cursor-not-allowed';
  const minecraftSuccessButtonClass =
    'rounded-none bg-[#55AA55] hover:bg-[#449944] border-4 border-[#2D572D] text-white font-bold shadow-[3px_3px_0_rgba(0,0,0,0.3)] hover:shadow-[5px_5px_0_rgba(0,0,0,0.3)] active:translate-y-1 active:shadow-[1px_1px_0_rgba(0,0,0,0.3)] disabled:opacity-60 disabled:cursor-not-allowed';
  const minecraftNeutralButtonClass =
    'rounded-none bg-[#D2B48C] hover:bg-[#C0A479] border-4 border-[#654321] text-[#2D1B00] font-bold shadow-[3px_3px_0_rgba(0,0,0,0.3)] hover:shadow-[5px_5px_0_rgba(0,0,0,0.3)] active:translate-y-1 active:shadow-[1px_1px_0_rgba(0,0,0,0.3)] disabled:opacity-60 disabled:cursor-not-allowed';
  const minecraftTabButtonBase =
    'px-6 py-3 font-bold text-sm border-4 shadow-[2px_2px_0_rgba(0,0,0,0.3)] transition-all uppercase tracking-[0.2em] rounded-none';

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-[#87CEEB] via-[#B0D9F0] to-[#D4E8F5]">
      <div className="absolute inset-0 opacity-10 pointer-events-none">
        <div className="absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent,transparent_16px,rgba(0,0,0,0.1)_16px,rgba(0,0,0,0.1)_18px)]" />
        <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,transparent,transparent_16px,rgba(0,0,0,0.1)_16px,rgba(0,0,0,0.1)_18px)]" />
      </div>
      <div className="relative z-10">
        {/* Header */}
        <header className="container mx-auto px-4 pt-12">
          <div className="bg-gradient-to-b from-[#654321] to-[#3D2817] p-1 shadow-[10px_10px_0_rgba(0,0,0,0.45)]">
            <div className="border-4 border-[#3D2817] bg-gradient-to-b from-[#F1D9A7] via-[#D2B48C] to-[#B08D69] px-6 py-8 text-[#2D1B00]">
              <div className="flex flex-col gap-8">
                <div className="flex flex-col gap-6 lg:flex-row">
                  <div className="relative h-32 w-32 flex-shrink-0 overflow-hidden border-4 border-[#3D2817] shadow-[6px_6px_0_rgba(0,0,0,0.4)]">
                    <img
                      src="https://images.unsplash.com/photo-1501183638710-841dd1904471?w=600&q=60&auto=format&fit=crop"
                      alt="Project visual"
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-[#3D2817]/40" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <h1 className="text-3xl font-bold tracking-[0.25em] text-[#FFD700] [text-shadow:_3px_3px_0_rgb(0_0_0_/_40%)]">
                        {loading ? <Skeleton className="h-9 w-64" /> : project.name.toUpperCase()}
                      </h1>
                      <Badge className="rounded-none border-4 border-[#2D572D] bg-[#55AA55] px-4 py-1 text-xs font-bold uppercase tracking-[0.2em] text-white shadow-[2px_2px_0_rgba(0,0,0,0.25)]">
                        {project.status}
                      </Badge>
                    </div>
                    <p className="text-sm font-semibold text-[#2D1B00]">
                      Canister ID:{' '}
                      {loading ? (
                        <Skeleton className="inline-block h-4 w-48" />
                      ) : (
                        <span className="font-mono text-xs text-[#2D1B00]">{project.canisterId}</span>
                      )}
                    </p>
                    <p className="text-sm text-[#5D4E37]">
                      {project.description}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Main content */}
        <div className="container mx-auto px-4 py-12">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Main column */}
            <div className="lg:col-span-2 space-y-6">
              {/* Summary */}
              <Card className={`${minecraftPanelClass} overflow-hidden`}>
                <CardHeader className={`${minecraftHeaderClass} pb-4`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg font-bold text-[#2D1B00] tracking-[0.2em] uppercase">
                        Capital Overview
                      </CardTitle>
                      <CardDescription className="text-sm font-semibold text-[#5D4E37]">
                        Funding progress across targets, reserves, and developer unlocks.
                      </CardDescription>
                    </div>
                    <Badge className="rounded-none border-4 border-[#AA7700] bg-[#FFD700] px-4 py-1 text-xs font-bold uppercase tracking-[0.25em] text-[#2D1B00] shadow-[2px_2px_0_rgba(0,0,0,0.3)]">
                      {project.target ? `${raisedPercentage.toFixed(1)}% Funded` : 'Open'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6 pt-6 text-[#2D1B00]">
                  <div className="space-y-4">
                    {/* Enhanced Target and Raised Display */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="relative overflow-hidden rounded-lg border-4 border-[#654321] bg-gradient-to-br from-[#FFD700] via-[#FFE55C] to-[#FFD700] p-4 shadow-[4px_4px_0_rgba(0,0,0,0.3)]">
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.3)_0%,_transparent_70%)]" />
                        <div className="relative z-10">
                          <p className="text-xs font-bold uppercase tracking-[0.3em] text-[#2D1B00] mb-1">Amount Raised</p>
                          <p className="text-2xl font-bold text-[#2D1B00] [text-shadow:_1px_1px_0_rgb(0_0_0_/_20%)]">
                            {loading ? <Skeleton className="h-8 w-32" /> : `${format(project.raised)} ${projectTokenConfig.symbol}`}
                          </p>
                        </div>
                      </div>
                      <div className="relative overflow-hidden rounded-lg border-4 border-[#654321] bg-gradient-to-br from-[#5599FF] via-[#6BB6FF] to-[#5599FF] p-4 shadow-[4px_4px_0_rgba(0,0,0,0.3)]">
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.3)_0%,_transparent_70%)]" />
                        <div className="relative z-10">
                          <p className="text-xs font-bold uppercase tracking-[0.3em] text-white mb-1">Target Goal</p>
                          <p className="text-2xl font-bold text-white [text-shadow:_1px_1px_0_rgb(0_0_0_/_20%)]">
                            {loading ? <Skeleton className="h-8 w-32" /> : `${format(project.target)} ${projectTokenConfig.symbol}`}
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    {/* Enhanced Progress Bar */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm font-bold text-[#2D1B00]">
                        <span>Funding Progress</span>
                        <span className="text-lg">{raisedPercentage.toFixed(1)}%</span>
                      </div>
                      <div className="relative h-6 w-full overflow-hidden rounded-none border-4 border-[#654321] bg-[#B08D69] shadow-[2px_2px_0_rgba(0,0,0,0.3)]">
                        <div
                          className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#5599FF] to-[#6BB6FF] transition-all duration-500 ease-out shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]"
                          style={{ width: `${Math.min(100, raisedPercentage)}%` }}
                        />
                        <div
                          className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#55AA55] to-[#66BB66] transition-all duration-500 ease-out shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]"
                          style={{ width: `${Math.min(100, withdrawnPercentage)}%` }}
                        />
                        {project.target > 0 && project.minTarget > 0 && (
                          <div
                            className="absolute inset-y-0 flex w-1 -translate-x-0.5 items-center justify-center"
                            style={{ left: `${Math.max(0, Math.min(100, minRaisePercentage))}%` }}
                          >
                            <span className="h-full w-px bg-[#FF4500] shadow-[0_0_4px_rgba(255,69,0,0.8)]" />
                          </div>
                        )}
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-xs font-bold text-[#2D1B00] [text-shadow:_1px_1px_0_rgb(255_255_255_/_80%)]">
                            {raisedPercentage.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-3">
                      {capitalSummaryMetrics.map((metric) => {
                        const Icon = metric.icon;
                        return (
                          <div
                            key={metric.id}
                            className="group relative flex h-full flex-col overflow-hidden rounded-lg border-4 border-[#654321] bg-gradient-to-br from-[#F8E3B5] via-[#FFF3C4] to-[#F8E3B5] p-5 text-[#2D1B00] shadow-[4px_4px_0_rgba(0,0,0,0.3)] transition-all hover:-translate-y-1 hover:shadow-[6px_6px_0_rgba(0,0,0,0.3)]"
                          >
                            <div
                              className="absolute inset-0 bg-[radial-gradient(circle,_rgba(255,215,0,0.3)_0%,_transparent_70%)] opacity-70 transition-opacity group-hover:opacity-90"
                              aria-hidden="true"
                            />
                            <div className="relative z-10 flex flex-col items-center text-center gap-4">
                              <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg border-4 border-[#654321] bg-gradient-to-br from-[#FFD700] to-[#FFE55C] text-[#2D1B00] shadow-[2px_2px_0_rgba(0,0,0,0.25)]">
                                  <Icon className="h-4 w-4" />
                                </div>
                                <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#2D1B00]">
                                  {metric.label}
                                </p>
                              </div>
                              <div className="w-full">
                                <p className="text-xl font-bold text-[#2D1B00] break-words">
                                  {loading ? <Skeleton className={`h-6 ${metric.skeletonClass}`} /> : metric.value}
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid gap-4 border-t-4 border-[#654321] pt-6 text-sm md:grid-cols-3">
                    {overviewStats.map((stat) => {
                      const Icon = stat.icon;
                      return (
                        <div
                          key={stat.id}
                          className="group relative flex h-full flex-col overflow-hidden rounded-lg border-4 border-[#654321] bg-gradient-to-br from-[#F8E3B5] via-[#FFF3C4] to-[#F8E3B5] p-5 text-[#2D1B00] shadow-[4px_4px_0_rgba(0,0,0,0.3)] transition-all hover:-translate-y-1 hover:shadow-[6px_6px_0_rgba(0,0,0,0.3)]"
                        >
                          <div
                            className="absolute inset-0 bg-[radial-gradient(circle,_rgba(255,215,0,0.3)_0%,_transparent_70%)] opacity-70 transition-opacity group-hover:opacity-90"
                            aria-hidden="true"
                          />
                          <div className="relative z-10 flex flex-col items-center text-center gap-4">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-lg border-4 border-[#654321] bg-gradient-to-br from-[#FFD700] to-[#FFE55C] text-[#2D1B00] shadow-[2px_2px_0_rgba(0,0,0,0.25)]">
                                <Icon className="h-4 w-4" />
                              </div>
                              <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#2D1B00] [text-shadow:_1px_1px_0_rgb(255_255_255_/_50%)]">
                                {stat.label}
                              </p>
                            </div>
                            <div className="w-full">
                              <p className="text-xl font-bold text-[#2D1B00] break-words [text-shadow:_1px_1px_0_rgb(255_255_255_/_30%)]">
                                {loading ? <Skeleton className="h-6 w-32" /> : stat.value}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Tabs */}
              <div className="flex flex-wrap items-center gap-3 rounded-none border-4 border-[#654321] bg-[#C4A484] p-2 shadow-[6px_6px_0_rgba(0,0,0,0.35)]">
                {[
                  { id: 'milestones', label: 'Phases' },
                  { id: 'flow-insights', label: 'Flow Insights' },
                  { id: 'verification', label: 'Documents' },
                  { id: 'timeline', label: 'Timeline' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`${minecraftTabButtonBase} ${
                      activeTab === tab.id
                        ? 'bg-[#FFD700] text-[#2D1B00] border-[#AA7700] shadow-[4px_4px_0_rgba(0,0,0,0.35)]'
                        : 'bg-[#8B7355] text-white border-[#3D2817] hover:-translate-y-0.5 hover:shadow-[4px_4px_0_rgba(0,0,0,0.35)]'
                    }`}
                  >
                    <span className="relative z-10 tracking-[0.25em]">{tab.label}</span>
                  </button>
                ))}
              </div>

              {/* Flow Insights Tab */}
              {activeTab === 'flow-insights' && (
                <div className={`${minecraftPanelClass} p-6`}>
                  <div className="-mx-2 overflow-x-auto px-2 pb-2">
                    <ProjectInsightsPanel
                      loading={loading}
                      data={insightsData}
                      tokenSymbol={projectTokenConfig.symbol}
                      className="min-w-[720px] w-full"
                    />
                  </div>
                </div>
              )}

              {/* Timeline Tab */}
              {activeTab === 'timeline' && (
                <div className={`${minecraftPanelClass} p-6`}>
                  <div className="relative text-[#2D1B00]">
                    {timelineEvents.length === 0 ? (
                      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-[#5D4E37]">
                        <span>No on-chain activity recorded yet.</span>
                        <span>Deployments, withdrawals, and updates will appear here automatically.</span>
                      </div>
                    ) : (
                      <>
                        <div className="pointer-events-none absolute left-6 top-3 h-[calc(100%-1.5rem)] w-px bg-gradient-to-b from-[#3D2817] via-[#8B7355] to-transparent md:left-1/2 md:-translate-x-1/2" />
                        <div className="space-y-10">
                          {timelineEvents.map((event, idx) => (
                            <div
                              key={event.id}
                              className={`relative flex gap-6 pl-12 md:pl-0 ${idx % 2 === 1 ? 'md:justify-end' : 'md:justify-start'}`}
                            >
                              <div className="absolute left-5 top-4 flex h-4 w-4 items-center justify-center rounded-full border-4 border-[#3D2817] bg-[#FFD700] shadow-[3px_3px_0_rgba(0,0,0,0.3)] md:left-1/2 md:-translate-x-1/2" />
                              <div
                                className={`relative w-full md:max-w-[45%] ${
                                  idx % 2 === 1 ? 'md:translate-x-6' : 'md:-translate-x-6'
                                }`}
                              >
                                <TimelineCard
                                  className="border-4 border-[#654321] bg-[#F8E3B5] p-5 text-[#2D1B00] shadow-[4px_4px_0_rgba(0,0,0,0.3)] transition-all hover:-translate-y-1 hover:shadow-[6px_6px_0_rgba(0,0,0,0.3)]"
                                  type={event.type}
                                  title={event.title}
                                  meta={event.meta}
                                >
                                  {event.description}
                                </TimelineCard>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Milestones/Phases Tab */}
              {activeTab === 'milestones' && (
                <div className={`${minecraftPanelClass} p-6`}>
                  <div className="relative text-[#2D1B00]">
                    <div className="absolute left-6 top-0 h-full w-px bg-gradient-to-b from-[#3D2817] via-[#8B7355] to-transparent" />
                    <div className="space-y-8">
                      {phasesDetails.map((p, idx) => {
                        const statusKey = p.status as keyof typeof phaseStatusDot;
                        const dotTone = phaseStatusDot[statusKey] ?? 'bg-slate-300';
                        const badgeTone = phaseStatusBadge[statusKey] ?? 'bg-muted text-foreground';
                        const progressWidth = `${Math.min(100, Math.round(p.withdrawnPctOfCap))}%`;
                        const infoBlocks: Array<{ label: string; value: string }> = [
                          { label: 'APR', value: `${p.apr}%` },
                          p.showCumulativeCap
                            ? {
                                label: 'Cumulative Cap',
                                value: `${p.capBps.toFixed(1)}% (${format(Math.round(p.capAmount))} ${projectTokenConfig.symbol})`,
                              }
                            : {
                                label: 'Phase Cap',
                                value: `${format(Math.round(p.capAmount))} ${projectTokenConfig.symbol}`,
                              },
                          p.showWithdrawn
                            ? { label: 'Withdrawn', value: `${format(Math.round(p.withdrawn))} ${projectTokenConfig.symbol}` }
                            : null,
                        ].filter(Boolean) as Array<{ label: string; value: string }>;

                        return (
                          <div key={p.index} className="relative flex gap-6 pl-12 md:pl-16">
                            <div className="absolute left-4 top-6 z-10 flex h-4 w-4 items-center justify-center rounded-full border-4 border-[#3D2817] bg-[#F8E3B5] shadow-[3px_3px_0_rgba(0,0,0,0.3)]">
                              <span className={`h-2.5 w-2.5 rounded-full ${dotTone}`} />
                            </div>
                            <div
                              className={`w-full rounded-lg border-4 border-[#654321] p-5 shadow-[4px_4px_0_rgba(0,0,0,0.3)] transition-all hover:-translate-y-1 hover:shadow-[6px_6px_0_rgba(0,0,0,0.3)] ${
                                idx === currentPhaseIndex ? 'bg-[#FFDFA6]' : 'bg-[#F8E3B5]'
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <p className="text-xs font-bold uppercase tracking-[0.35em] text-[#5D4E37]">
                                    Phase {p.index + 1}
                                  </p>
                                  <h3 className="text-lg font-bold text-[#2D1B00]">{p.name}</h3>
                                </div>
                                <Badge className={`rounded-none px-4 py-1 text-xs font-bold uppercase tracking-[0.25em] ${badgeTone}`}>
                                  {p.status}
                                </Badge>
                              </div>

                              <div className="mt-4 grid gap-4 md:grid-cols-3">
                                {infoBlocks.map((block) => (
                                  <div key={block.label}>
                                    <p className="text-[0.65rem] font-bold uppercase tracking-[0.3em] text-[#5D4E37]">
                                      {block.label}
                                    </p>
                                    <p className="text-sm font-bold text-[#2D1B00]">
                                      {loading ? <Skeleton className="h-4 w-20" /> : block.value}
                                    </p>
                                  </div>
                                ))}
                              </div>

                              {p.showWithdrawn && (
                                <>
                                  <div className="mt-5 space-y-2">
                                    <div className="flex items-center justify-between text-xs font-semibold text-[#5D4E37]">
                                      <span>Cap Unlock Progress</span>
                                      <span>{progressWidth}</span>
                                    </div>
                                    <div className="relative h-2 w-full overflow-hidden rounded-none border-4 border-[#654321] bg-[#B08D69]">
                                      <div
                                        className="absolute inset-y-0 left-0 bg-[#5599FF]"
                                        style={{ width: progressWidth }}
                                      />
                                    </div>
                                  </div>
                                  <p className="mt-3 text-xs text-[#5D4E37]">
                                    Phase cap unlocked and included in cumulative developer withdrawals.
                                  </p>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Documents/Verification Tab */}
              {activeTab === 'verification' && (
                <div className={`${minecraftPanelClass} p-6`}>
                  <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
                    <div className="space-y-3">
                      {phasesDetails.map((p) => {
                        const statusKey = p.status as keyof typeof phaseStatusBadge;
                        const docs = phaseDocuments[p.index] || [];
                        return (
                          <button
                            key={`docs-nav-${p.index}`}
                            type="button"
                            onClick={() => setActiveDocPhase(p.index)}
                            className={`w-full rounded-lg border-4 px-4 py-3 text-left font-semibold tracking-[0.05em] shadow-[3px_3px_0_rgba(0,0,0,0.25)] transition-all ${
                              activeDocPhase === p.index
                                ? 'border-[#AA7700] bg-[#FFDFA6] text-[#2D1B00]'
                                : 'border-[#654321] bg-[#EBD8B0] text-[#5D4E37] hover:-translate-y-1 hover:shadow-[5px_5px_0_rgba(0,0,0,0.3)]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-semibold">Phase {p.index + 1}</p>
                              <Badge className={`rounded-none px-3 py-1 text-[0.65rem] font-bold uppercase tracking-[0.2em] ${phaseStatusBadge[statusKey] ?? ''}`}>
                                {p.status}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-[#5D4E37]">{p.name}</p>
                            <div className="mt-3 flex items-center justify-between text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-[#5D4E37]">
                              <span>{docs.length} docs</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className={`${minecraftSubPanelClass} p-5 text-[#2D1B00]`}>
                      {(() => {
                        const activePhase = phasesDetails[activeDocPhase];
                        const docs = phaseDocuments[activeDocPhase] || [];
                        return (
                          <>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-[0.65rem] font-bold uppercase tracking-[0.3em] text-[#5D4E37]">
                                  Phase {activePhase.index + 1}
                                </p>
                                <h3 className="text-lg font-bold text-[#2D1B00]">
                                  {activePhase.name}
                                </h3>
                              </div>
                              <Badge className="rounded-none border-4 border-[#654321] bg-[#FFD700] px-4 py-1 text-xs font-bold uppercase tracking-[0.2em] text-[#2D1B00] shadow-[2px_2px_0_rgba(0,0,0,0.25)]">
                                {activePhase.status}
                              </Badge>
                            </div>

                            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                              {docs.length > 0 ? (
                                docs.map((d: any) => (
                                  <div
                                    key={d.id || d.uri}
                                    className="group flex h-full flex-col overflow-hidden rounded-lg border-4 border-[#654321] bg-[#F8E3B5] text-left shadow-[4px_4px_0_rgba(0,0,0,0.3)] transition-all hover:-translate-y-1 hover:shadow-[6px_6px_0_rgba(0,0,0,0.3)]"
                                  >
                                    <div className="relative aspect-video w-full overflow-hidden border-b-4 border-[#654321] bg-[#EBD8B0]">
                                      <div className="flex h-full w-full items-center justify-center text-[#5D4E37]">
                                        <FileText className="h-8 w-8" />
                                      </div>
                                      <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#3D2817]/40 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-80" />
                                    </div>
                                    <div className="flex flex-1 flex-col justify-between p-3">
                                      <div>
                                        <p className="truncate text-sm font-bold text-[#2D1B00]">
                                          {d.type || 'Document'}
                                        </p>
                                        <p className="mt-1 text-[0.65rem] font-bold uppercase tracking-[0.3em] text-[#5D4E37]">
                                          {d.type?.toUpperCase() || 'FILE'}
                                        </p>
                                      </div>
                                      <p className="mt-2 text-[0.65rem] text-[#5D4E37] truncate">
                                        {d.hash ? `Hash: ${d.hash.slice(0, 10)}…` : d.uri}
                                      </p>
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <div className="col-span-full flex flex-col items-center justify-center rounded-lg border-4 border-dashed border-[#654321] bg-[#F8E3B5] p-8 text-center text-sm text-[#5D4E37] shadow-[4px_4px_0_rgba(0,0,0,0.25)]">
                                  <FileText className="mb-3 h-10 w-10 text-[#3D2817]" />
                                  <p>No documents uploaded for this phase yet.</p>
                                  <p className="mt-1 text-xs text-[#3D2817]">
                                    Developer submissions will appear here once the phase closes.
                                  </p>
                                </div>
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right rail */}
            <div className="space-y-6">
              {/* Role Selector */}
              <div className="flex gap-3">
                <button
                  onClick={() => setCurrentRole('holder')}
                  className={`flex-1 rounded-lg border-4 px-4 py-3 text-center font-bold shadow-[3px_3px_0_rgba(0,0,0,0.3)] transition-all hover:-translate-y-1 hover:shadow-[5px_5px_0_rgba(0,0,0,0.3)] ${
                    currentRole === 'holder'
                      ? 'border-[#55AA55] bg-[#66BB66] text-white'
                      : 'border-[#654321] bg-[#EBD8B0] text-[#2D1B00] hover:bg-[#F8E3B5]'
                  }`}
                >
                  <div className="flex flex-col items-center gap-2">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg border-4 ${
                      currentRole === 'holder'
                        ? 'border-[#2D572D] bg-[#55AA55]'
                        : 'border-[#654321] bg-[#FFD700]'
                    }`}>
                      <Users className="h-4 w-4" />
                    </div>
                    <p className="text-sm font-bold uppercase tracking-[0.2em]">Investor</p>
                  </div>
                </button>
                
                <button
                  onClick={() => setCurrentRole('developer')}
                  className={`flex-1 rounded-lg border-4 px-4 py-3 text-center font-bold shadow-[3px_3px_0_rgba(0,0,0,0.3)] transition-all hover:-translate-y-1 hover:shadow-[5px_5px_0_rgba(0,0,0,0.3)] ${
                    currentRole === 'developer'
                      ? 'border-[#5599FF] bg-[#66AAFF] text-white'
                      : 'border-[#654321] bg-[#EBD8B0] text-[#2D1B00] hover:bg-[#F8E3B5]'
                  }`}
                >
                  <div className="flex flex-col items-center gap-2">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg border-4 ${
                      currentRole === 'developer'
                        ? 'border-[#2D5788] bg-[#5599FF]'
                        : 'border-[#654321] bg-[#FFD700]'
                    }`}>
                      <HardHat className="h-4 w-4" />
                    </div>
                    <p className="text-sm font-bold uppercase tracking-[0.2em]">Builder</p>
                  </div>
                </button>
              </div>

              {!connected ? (
                // Placeholder when wallet not connected
                <Card className={`${minecraftPanelClass} border-dashed`}>
                  <CardHeader className={`${minecraftHeaderClass} text-center`}>
                    <CardTitle className="text-lg font-bold uppercase tracking-[0.2em] text-[#2D1B00]">
                      Connect Your Identity
                    </CardTitle>
                    <CardDescription className="text-sm font-semibold text-[#5D4E37]">
                      Connect with Internet Identity to invest in this project and view your portfolio
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 text-[#2D1B00]">
                    <div className="flex flex-col items-center justify-center py-6 text-center">
                      <Wallet className="mb-4 h-16 w-16 text-[#3D2817]" />
                      <p className="mb-4 text-sm text-[#5D4E37]">
                        You need to authenticate with Internet Identity to support this project and manage your investments.
                      </p>
                      <Button onClick={connectWallet} size="lg" className={`${minecraftPrimaryButtonClass} w-full`}>
                        <Wallet className="mr-2 h-4 w-4" />
                        Connect Internet Identity
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {/* Support card (investor/holder only) */}
                  <RoleGate currentRole={currentRole} allowedRoles={['holder']}>
                    <Card className={minecraftPanelClass}>
                      <CardHeader className={minecraftHeaderClass}>
                        <CardTitle className="text-lg font-bold uppercase tracking-[0.2em] text-[#2D1B00]">Support This Project</CardTitle>
                        <CardDescription className="text-sm font-semibold text-[#5D4E37]">Invest in this project using {projectTokenConfig.symbol}</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4 p-6 text-[#2D1B00]">
                        <Dialog open={depositModalOpen} onOpenChange={(open) => {
                          if (!open) {
                            resetDepositModal();
                          }
                          setDepositModalOpen(open);
                        }}>
                          <DialogTrigger asChild>
                            <Button className={`${minecraftSuccessButtonClass} w-full h-12`} size="lg">
                              <DollarSign className="mr-2 h-4 w-4" />
                              Deposit Funds
                            </Button>
                          </DialogTrigger>
                          <DialogContent className={`${minecraftPanelClass} max-w-md`}>
                            <DialogHeader className="pb-4 border-b-4 border-[#654321]">
                              <DialogTitle className="text-xl font-bold uppercase tracking-[0.2em] text-[#2D1B00]">
                                Deposit Workflow
                              </DialogTitle>
                              <DialogDescription className="text-sm font-semibold text-[#5D4E37]">
                                {depositStep === 'amount' && 'Step 1: Enter deposit amount'}
                                {depositStep === 'deposit' && 'Step 2: Complete deposit'}
                              </DialogDescription>
                            </DialogHeader>

                            <div className="space-y-4 py-4">
                              {/* Step Progress Indicator */}
                              <div className="flex items-center justify-center mb-6">
                                {['amount', 'deposit'].map((step, index) => (
                                  <div key={step} className="flex items-center">
                                    <div className={`flex h-8 w-8 items-center justify-center rounded-full border-4 font-bold text-sm ${
                                      depositStep === step
                                        ? 'border-[#AA7700] bg-[#FFD700] text-[#2D1B00]'
                                        : ['amount', 'deposit'].indexOf(depositStep) > index
                                        ? 'border-[#2D572D] bg-[#55AA55] text-white'
                                        : 'border-[#654321] bg-[#8B7355] text-white'
                                    }`}>
                                      {index + 1}
                                    </div>
                                    {index < 1 && (
                                      <div className={`w-12 h-1 mx-1 ${
                                        ['amount', 'deposit'].indexOf(depositStep) > index
                                          ? 'bg-[#55AA55]'
                                          : 'bg-[#8B7355]'
                                      }`} />
                                    )}
                                  </div>
                                ))}
                              </div>

                              {/* Step 1: Amount Input */}
                              {depositStep === 'amount' && (
                                <div className="space-y-4">
                                  <div className={`${minecraftSubPanelClass} p-4`}>
                                    <p className="text-sm font-semibold text-[#2D1B00] mb-2">Project Info:</p>
                                    <div className="space-y-2">
                                      <div className="flex justify-between text-xs">
                                        <span className="text-[#5D4E37]">Current Raise:</span>
                                        <span className="font-bold">{format(project.raised)} {projectTokenConfig.symbol}</span>
                                      </div>
                                      <div className="flex justify-between text-xs">
                                        <span className="text-[#5D4E37]">Target:</span>
                                        <span className="font-bold">{format(project.target)} {projectTokenConfig.symbol}</span>
                                      </div>
                                      <div className="flex justify-between text-xs">
                                        <span className="text-[#5D4E37]">Progress:</span>
                                        <span className="font-bold">{raisedPercentage.toFixed(1)}%</span>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="space-y-2">
                                    <Label htmlFor="modal-support-amount" className="text-sm font-bold text-[#2D1B00]">
                                      Amount ({projectTokenConfig.symbol})
                                    </Label>
                                    <Input
                                      id="modal-support-amount"
                                      type="number"
                                      inputMode="decimal"
                                      placeholder="0.00"
                                      value={supportAmount}
                                      onChange={(e) => setSupportAmount(e.target.value)}
                                      className="h-11 rounded-none border-4 border-[#654321] bg-[#FFF3C4] font-semibold text-[#2D1B00] placeholder:text-[#5D4E37] focus-visible:ring-[#FFD700]"
                                    />
                                    <p className="text-xs text-[#5D4E37]">
                                      Note: In ICP, you must first transfer {projectTokenConfig.symbol} tokens to the project canister, then call deposit. This demo simplifies the flow.
                                    </p>
                                  </div>
                                  <Button
                                    className={`${minecraftPrimaryButtonClass} w-full h-12`}
                                    disabled={!supportAmount || Number(supportAmount) <= 0}
                                    onClick={() => setDepositStep('deposit')}
                                  >
                                    Continue
                                  </Button>
                                </div>
                              )}

                              {/* Step 2: Final Deposit */}
                              {depositStep === 'deposit' && (
                                <div className="space-y-4">
                                  <div className={`${minecraftSubPanelClass} p-4 space-y-3`}>
                                    <div className="flex justify-between items-center">
                                      <p className="text-sm font-semibold text-[#5D4E37]">Amount:</p>
                                      <p className="text-xl font-bold text-[#2D1B00]">
                                        {supportAmount} {projectTokenConfig.symbol}
                                      </p>
                                    </div>
                                    <div className="flex justify-between items-center">
                                      <p className="text-sm font-semibold text-[#5D4E37]">Destination:</p>
                                      <p className="text-sm font-bold text-[#2D1B00]">
                                        Project Canister
                                      </p>
                                    </div>
                                    <div className="h-px bg-[#654321]" />
                                    <div className="flex justify-between items-center">
                                      <p className="text-sm font-semibold text-[#5D4E37]">Your New Balance:</p>
                                      <p className="text-lg font-bold text-[#2D1B00]">
                                        {format((projectData?.userMetrics?.balance ? Number(fromStablecoin(projectData.userMetrics.balance)) : 0) + Number(supportAmount))} {projectTokenConfig.symbol}
                                      </p>
                                    </div>
                                  </div>
                                  
                                  <div className="rounded-lg border-4 border-blue-600 bg-blue-50 p-3">
                                    <div className="flex items-start gap-2">
                                      <DollarSign className="h-5 w-5 text-blue-700 flex-shrink-0 mt-0.5" />
                                      <div>
                                        <p className="text-sm font-bold text-blue-900">ICP Transaction Flow</p>
                                        <p className="text-xs text-blue-800 mt-1">
                                          This will call the deposit function on the project canister. In a production setup, you would first transfer tokens to the canister using ICRC-1 standard.
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex gap-2">
                                    <Button
                                      variant="outline"
                                      className={`${minecraftNeutralButtonClass} flex-1 h-12`}
                                      onClick={() => setDepositStep('amount')}
                                    >
                                      Back
                                    </Button>
                                    <Button
                                      className={`${minecraftSuccessButtonClass} flex-1 h-12`}
                                      disabled={isDepositing}
                                      onClick={async () => {
                                        try {
                                          if (!canisterId) {
                                            toast.error('Project canister not found');
                                            return;
                                          }
                                          
                                          const amt = supportAmount.trim();
                                          if (!amt || Number(amt) <= 0) {
                                            toast.error('Enter valid amount');
                                            return;
                                          }
                                          
                                          setIsDepositing(true);
                                          
                                          // Convert amount to bigint with proper decimals
                                          const amountBigInt = toStablecoin(amt);
                                          
                                          // Call deposit on project canister
                                          await deposit(canisterId, amountBigInt);
                                          
                                          toast.success('Deposit successful!');
                                          
                                          // Check if this is first deposit to increment supporters
                                          const isFirstDeposit = !projectData?.userMetrics?.balance || projectData.userMetrics.balance === 0n;
                                          if (isFirstDeposit) {
                                            setSupporters(prev => prev + 1);
                                          }
                                          
                                          resetDepositModal();
                                          await refresh();
                                        } catch (e: any) {
                                          console.error('Deposit error:', e);
                                          toast.error('Deposit failed', {
                                            description: e?.message || 'Transaction could not be completed'
                                          });
                                        } finally {
                                          setIsDepositing(false);
                                        }
                                      }}
                                    >
                                      {isDepositing ? 'Depositing...' : 'Confirm Deposit'}
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </DialogContent>
                        </Dialog>

                        <p className="text-xs text-[#5D4E37] text-center">
                          Click the button above to start the guided deposit process
                        </p>
                      </CardContent>
                    </Card>
                  </RoleGate>

                  {/* Holder investment overview */}
                  <RoleGate currentRole={currentRole} allowedRoles={['holder']}>
                    <Card className={minecraftPanelClass}>
                      <CardHeader className={minecraftHeaderClass}>
                        <CardTitle className="text-lg font-bold uppercase tracking-[0.2em] text-[#2D1B00]">Your Investment</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3 text-sm text-[#2D1B00] p-6">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[#5D4E37]">Your Balance</span>
                          <span className="font-bold">
                            {loading ? (
                              <Skeleton className="inline-block h-4 w-20" />
                            ) : (
                              `${projectData?.userMetrics?.balance ? Number(fromStablecoin(projectData.userMetrics.balance)).toLocaleString('en-US') : 0} ${projectTokenConfig.symbol}`
                            )}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[#5D4E37]">Claimable Interest</span>
                          <span className="font-bold">
                            {loading ? (
                              <Skeleton className="inline-block h-4 w-20" />
                            ) : (() => {
                                const interestValue = Number(fromStablecoin(projectData?.userMetrics?.claimableInterest || 0n));
                                let displayValue;

                                if (interestValue === 0) {
                                  displayValue = "0";
                                } else if (interestValue < 0.001) {
                                  displayValue = "<0.001";
                                } else {
                                  displayValue = interestValue.toLocaleString('en-US', {
                                    minimumFractionDigits: 3,
                                    maximumFractionDigits: 3,
                                  });
                                }

                                return `${displayValue} ${projectTokenConfig.symbol}`;
                              })()
                            }
                          </span>
                        </div>
                        <Button 
                          variant="outline" 
                          className={`${minecraftNeutralButtonClass} w-full mt-1`} 
                          disabled={isClaimingInterest || !projectData?.userMetrics?.claimableInterest || projectData.userMetrics.claimableInterest === 0n}
                          onClick={async () => {
                            try {
                              if (!canisterId) {
                                toast.error('Project canister not found');
                                return;
                              }
                              
                              const claimableAmount = projectData?.userMetrics?.claimableInterest;
                              if (!claimableAmount || claimableAmount === 0n) {
                                toast.error('Nothing to claim');
                                return;
                              }
                              
                              setIsClaimingInterest(true);
                              
                              // Call claimInterest on project canister
                              const claimedAmount = await claimInterest(canisterId, claimableAmount);
                              
                              toast.success('Interest claimed successfully!', {
                                description: `Claimed ${Number(fromStablecoin(claimedAmount)).toFixed(2)} ${projectTokenConfig.symbol}`
                              });
                              
                              await refresh();
                            } catch (e: any) {
                              console.error('Claim interest error:', e);
                              toast.error('Claim failed', {
                                description: e?.message || 'Could not claim interest'
                              });
                            } finally {
                              setIsClaimingInterest(false);
                            }
                          }}
                        >
                          {isClaimingInterest ? 'Claiming...' : 'Claim Interest'}
                        </Button>

                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[#5D4E37]">Claimable Revenue</span>
                          <span className="font-bold">
                            {loading ? (
                              <Skeleton className="inline-block h-4 w-20" />
                            ) : (() => {
                                const revenueValue = Number(fromStablecoin(projectData?.userMetrics?.claimableRevenue || 0n));
                                let displayValue;

                                if (revenueValue === 0) {
                                  displayValue = "0";
                                } else if (revenueValue < 0.001) {
                                  displayValue = "<0.001";
                                } else {
                                  displayValue = revenueValue.toLocaleString('en-US', {
                                    minimumFractionDigits: 3,
                                    maximumFractionDigits: 3,
                                  });
                                }

                                return `${displayValue} ${projectTokenConfig.symbol}`;
                              })()
                            }
                          </span>
                        </div>
                        
                        <div className={`${minecraftSubPanelClass} p-3 mt-4`}>
                          <p className="text-xs text-[#5D4E37] font-semibold mb-2">Withdrawal History</p>
                          <div className="space-y-1 text-xs">
                            <div className="flex justify-between">
                              <span className="text-[#5D4E37]">Interest Withdrawn:</span>
                              <span className="font-bold">
                                {loading ? (
                                  <Skeleton className="inline-block h-3 w-16" />
                                ) : (
                                  `${Number(fromStablecoin(projectData?.userMetrics?.interestWithdrawn || 0n)).toFixed(2)} ${projectTokenConfig.symbol}`
                                )}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-[#5D4E37]">Revenue Withdrawn:</span>
                              <span className="font-bold">
                                {loading ? (
                                  <Skeleton className="inline-block h-3 w-16" />
                                ) : (
                                  `${Number(fromStablecoin(projectData?.userMetrics?.revenueWithdrawn || 0n)).toFixed(2)} ${projectTokenConfig.symbol}`
                                )}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Principal Redemption Section */}
                        <div className={`${minecraftSubPanelClass} p-4 mt-4 space-y-3`}>
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-bold text-[#2D1B00]">Principal Redemption</p>
                              <p className="text-xs text-[#5D4E37] mt-1">Available when project proceeds are submitted</p>
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            <div className="flex justify-between text-xs">
                              <span className="text-[#5D4E37]">Principal Buffer Available:</span>
                              <span className="font-bold">
                                {loading ? (
                                  <Skeleton className="inline-block h-3 w-16" />
                                ) : (
                                  `${Number(fromStablecoin(realtimeData?.principalBuffer || 0n)).toLocaleString('en-US')} ${projectTokenConfig.symbol}`
                                )}
                              </span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-[#5D4E37]">Your Redeemable Amount:</span>
                              <span className="font-bold">
                                {loading ? (
                                  <Skeleton className="inline-block h-3 w-16" />
                                ) : (() => {
                                    const userBalance = projectData?.userMetrics?.balance || 0n;
                                    const principalBuffer = realtimeData?.principalBuffer || 0n;
                                    const redeemable = userBalance < principalBuffer ? userBalance : principalBuffer;
                                    return `${Number(fromStablecoin(redeemable)).toLocaleString('en-US')} ${projectTokenConfig.symbol}`;
                                  })()
                                }
                              </span>
                            </div>
                          </div>

                          <Button 
                            variant="outline" 
                            className={`${minecraftNeutralButtonClass} w-full`} 
                            disabled={
                              isRedeemingPrincipal || 
                              !realtimeData?.principalBuffer || 
                              realtimeData.principalBuffer === 0n ||
                              !projectData?.userMetrics?.balance ||
                              projectData.userMetrics.balance === 0n
                            }
                            onClick={async () => {
                              try {
                                if (!canisterId) {
                                  toast.error('Project canister not found');
                                  return;
                                }
                                
                                const userBalance = projectData?.userMetrics?.balance || 0n;
                                const principalBuffer = realtimeData?.principalBuffer || 0n;
                                
                                if (principalBuffer === 0n) {
                                  toast.error('No principal available for redemption yet');
                                  return;
                                }
                                
                                if (userBalance === 0n) {
                                  toast.error('You have no shares to redeem');
                                  return;
                                }
                                
                                // Calculate redeemable amount (minimum of user balance and principal buffer)
                                const sharesToRedeem = userBalance < principalBuffer ? userBalance : principalBuffer;
                                
                                setIsRedeemingPrincipal(true);
                                
                                // Call withdrawPrincipal on project canister
                                const redeemedAmount = await withdrawPrincipal(canisterId, sharesToRedeem);
                                
                                toast.success('Principal redeemed successfully!', {
                                  description: `Redeemed ${Number(fromStablecoin(redeemedAmount)).toLocaleString('en-US')} ${projectTokenConfig.symbol}`
                                });
                                
                                // If user redeemed all their balance, decrement supporters count
                                if (sharesToRedeem === userBalance) {
                                  setSupporters(prev => Math.max(0, prev - 1));
                                }
                                
                                await refresh();
                              } catch (e: any) {
                                console.error('Redeem principal error:', e);
                                toast.error('Redemption failed', {
                                  description: e?.message || 'Could not redeem principal'
                                });
                              } finally {
                                setIsRedeemingPrincipal(false);
                              }
                            }}
                          >
                            {isRedeemingPrincipal ? 'Redeeming...' : 'Redeem Principal'}
                          </Button>

                          {realtimeData?.principalBuffer && realtimeData.principalBuffer > 0n && (
                            <div className="rounded-lg border-2 border-green-600 bg-green-50 p-2">
                              <p className="text-xs text-green-800">
                                <span className="font-bold">Available!</span> Sales proceeds have been submitted. You can now redeem your principal investment.
                              </p>
                            </div>
                          )}
                        </div>
                        
                        <p className="text-xs text-[#5D4E37] italic pt-2">
                          Principal redemption becomes available when the developer submits sales proceeds from the completed project.
                        </p>
                      </CardContent>
                    </Card>
                  </RoleGate>
                </>
              )}

              {/* Developer actions */}
              <RoleGate currentRole={currentRole} allowedRoles={['developer']}>
                <Card className={minecraftPanelClass}>
                  <CardHeader className={minecraftHeaderClass}>
                    <CardTitle className="text-lg font-bold uppercase tracking-[0.2em] text-[#2D1B00]">Developer Actions</CardTitle>
                    <CardDescription className="text-sm font-semibold text-[#5D4E37]">Fund reserve, close phase, withdraw</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6 text-[#2D1B00] p-6">
                    
                    {/* Fund Reserve */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Banknote className="h-4 w-4 text-[#3D2817]" />
                        <span className="text-sm font-bold text-[#2D1B00]">Fund Reserve</span>
                      </div>
                      
                      <Dialog open={fundReserveModalOpen} onOpenChange={(open) => {
                        if (!open) resetFundReserveModal();
                        setFundReserveModalOpen(open);
                      }}>
                        <DialogTrigger asChild>
                          <Button size="sm" className={`${minecraftPrimaryButtonClass} w-full h-10`}>
                            <Banknote className="mr-2 h-4 w-4" />
                            Fund Reserve
                          </Button>
                        </DialogTrigger>
                        <DialogContent className={`${minecraftPanelClass} max-w-md`}>
                          <DialogHeader className="pb-4 border-b-4 border-[#654321]">
                            <DialogTitle className="text-xl font-bold uppercase tracking-[0.2em] text-[#2D1B00]">
                              Fund Reserve
                            </DialogTitle>
                            <DialogDescription className="text-sm font-semibold text-[#5D4E37]">
                              {fundReserveStep === 'amount' && 'Step 1: Enter reserve amount'}
                              {fundReserveStep === 'fund' && 'Step 2: Confirm funding'}
                            </DialogDescription>
                          </DialogHeader>

                          <div className="space-y-4 py-4">
                            {fundReserveStep === 'amount' && (
                              <div className="space-y-4">
                                <div className={`${minecraftSubPanelClass} p-4`}>
                                  <p className="text-sm font-semibold text-[#2D1B00] mb-2">Current Reserve Balance:</p>
                                  <p className="text-2xl font-bold text-[#2D1B00]">
                                    {loading ? <Skeleton className="h-8 w-32" /> : `${format(project.escrow)} ${projectTokenConfig.symbol}`}
                                  </p>
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="modal-reserve-amount" className="text-sm font-bold text-[#2D1B00]">
                                    Amount to Add ({projectTokenConfig.symbol})
                                  </Label>
                                  <Input
                                    id="modal-reserve-amount"
                                    type="number"
                                    inputMode="decimal"
                                    placeholder="e.g. 50000"
                                    value={reserveAmount}
                                    onChange={(e) => setReserveAmount(e.target.value)}
                                    className="h-11 rounded-none border-4 border-[#654321] bg-[#FFF3C4] font-semibold text-[#2D1B00] placeholder:text-[#5D4E37] focus-visible:ring-[#FFD700]"
                                  />
                                  <p className="text-xs text-[#5D4E37]">
                                    The interest reserve ensures timely payments to investors during project phases.
                                  </p>
                                </div>
                                <Button
                                  className={`${minecraftPrimaryButtonClass} w-full h-12`}
                                  disabled={!reserveAmount || Number(reserveAmount) <= 0}
                                  onClick={() => setFundReserveStep('fund')}
                                >
                                  Continue
                                </Button>
                              </div>
                            )}

                            {fundReserveStep === 'fund' && (
                              <div className="space-y-4">
                                <div className={`${minecraftSubPanelClass} p-4 space-y-3`}>
                                  <div className="flex justify-between items-center">
                                    <p className="text-sm font-semibold text-[#5D4E37]">Current Reserve:</p>
                                    <p className="text-lg font-bold text-[#2D1B00]">
                                      {format(project.escrow)} {projectTokenConfig.symbol}
                                    </p>
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <p className="text-sm font-semibold text-[#5D4E37]">Adding:</p>
                                    <p className="text-xl font-bold text-[#2D1B00]">
                                      +{reserveAmount} {projectTokenConfig.symbol}
                                    </p>
                                  </div>
                                  <div className="h-px bg-[#654321]" />
                                  <div className="flex justify-between items-center">
                                    <p className="text-sm font-semibold text-[#5D4E37]">New Reserve:</p>
                                    <p className="text-2xl font-bold text-[#2D1B00]">
                                      {format(project.escrow + Number(reserveAmount))} {projectTokenConfig.symbol}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    variant="outline"
                                    className={`${minecraftNeutralButtonClass} flex-1 h-12`}
                                    onClick={() => setFundReserveStep('amount')}
                                  >
                                    Back
                                  </Button>
                                  <Button
                                    className={`${minecraftSuccessButtonClass} flex-1 h-12`}
                                    disabled={isFundingReserve}
                                    onClick={async () => {
                                      try {
                                        if (!canisterId) {
                                          toast.error('Project canister not found');
                                          return;
                                        }
                                        const amt = toStablecoin(reserveAmount);
                                        setIsFundingReserve(true);
                                        await fundReserve(canisterId, amt);
                                        toast.success('Reserve funded successfully!');
                                        resetFundReserveModal();
                                        await refresh();
                                      } catch (e: any) {
                                        toast.error('Fund failed', {
                                          description: e?.message || 'Could not fund reserve'
                                        });
                                      } finally {
                                        setIsFundingReserve(false);
                                      }
                                    }}
                                  >
                                    {isFundingReserve ? 'Funding...' : 'Confirm Funding'}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>

                    {/* Close Phase */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <DoorClosed className="h-4 w-4 text-[#3D2817]" />
                        <span className="text-sm font-bold text-[#2D1B00]">Close Phase</span>
                      </div>
                      <div className="grid gap-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-semibold text-[#5D4E37]">Current Phase</span>
                          <span className="font-bold">
                            {loading ? <Skeleton className="inline-block h-4 w-32" /> : project.currentPhase}
                          </span>
                        </div>
                        <div className="grid gap-1">
                          <Label htmlFor="phaseDocs" className="text-sm font-bold text-[#2D1B00]">Upload Documents</Label>
                          <Input
                            id="phaseDocs"
                            type="file"
                            multiple
                            onChange={(e) => setUploadedDocs(Array.from(e.target.files || []))}
                            className="rounded-none border-4 border-dashed border-[#654321] bg-[#FFF3C4] text-[#2D1B00] file:mr-4 file:rounded-none file:border-0 file:bg-[#8B7355] file:px-4 file:py-2 file:font-bold file:uppercase file:text-white hover:file:bg-[#715b3f]"
                          />
                          <p className="text-xs text-[#5D4E37]">Attach evidence to close the current phase.</p>
                        </div>
                        <Button 
                          size="sm" 
                          className={`${minecraftPrimaryButtonClass} justify-start px-4 h-10`} 
                          disabled={isClosingPhase || !uploadedDocs.length}
                          onClick={async () => {
                            try {
                              if (!canisterId) {
                                toast.error('Project canister not found');
                                return;
                              }
                              if (!uploadedDocs.length) {
                                toast.error('Please upload at least one document');
                                return;
                              }
                              setIsClosingPhase(true);
                              
                              const phaseId = projectData?.project?.currentPhase ?? 0;
                              
                              // Upload files to ICP asset canister
                              toast.info('Uploading documents to ICP storage...');
                              const uploadResults = await icpUpload(uploadedDocs);
                              
                              // Create document records from upload results
                              const docTypes: string[] = [];
                              const docHashes: string[] = [];
                              const metadataURIs: string[] = [];
                              
                              for (const result of uploadResults) {
                                // Extract file extension or use the original path
                                const fileExt = result.path.split('.').pop() || 'file';
                                docTypes.push(fileExt);
                                // Use the CID (which is the key in ICP) as the hash
                                docHashes.push(result.cid);
                                // Use the full URI for metadata
                                metadataURIs.push(result.uri);
                              }
                              
                              const docs: DocRecord = {
                                doc_types: docTypes,
                                doc_hashes: docHashes,
                                metadata_uris: metadataURIs,
                                submitted_at: BigInt(Date.now() * 1000000), // Convert to nanoseconds
                              };
                              
                              toast.info('Closing phase with uploaded documents...');
                              await closePhase(canisterId, phaseId, docs);
                              
                              toast.success(`Phase ${phaseId} closed successfully with ${uploadResults.length} document(s)!`);
                              setUploadedDocs([]);
                              await refresh();
                            } catch (e: any) {
                              console.error('Close phase error:', e);
                              toast.error('Close phase failed', {
                                description: e?.message || 'Could not close phase'
                              });
                            } finally {
                              setIsClosingPhase(false);
                            }
                          }}
                        >
                          <DoorClosed className="mr-2 h-4 w-4" /> 
                          {isClosingPhase ? 'Closing...' : 'Close Phase'}
                        </Button>
                      </div>
                    </div>

                    {/* Withdraw Phase Funds */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-[#3D2817]" />
                        <span className="text-sm font-bold text-[#2D1B00]">Withdraw Phase Funds</span>
                      </div>
                      
                      <Dialog open={withdrawFundsModalOpen} onOpenChange={(open) => {
                        if (!open) resetWithdrawFundsModal();
                        setWithdrawFundsModalOpen(open);
                      }}>
                        <DialogTrigger asChild>
                          <Button size="sm" className={`${minecraftPrimaryButtonClass} w-full h-10`}>
                            <DollarSign className="mr-2 h-4 w-4" />
                            Withdraw Funds
                          </Button>
                        </DialogTrigger>
                        <DialogContent className={`${minecraftPanelClass} max-w-md`}>
                          <DialogHeader className="pb-4 border-b-4 border-[#654321]">
                            <DialogTitle className="text-xl font-bold uppercase tracking-[0.2em] text-[#2D1B00]">
                              Withdraw Phase Funds
                            </DialogTitle>
                            <DialogDescription className="text-sm font-semibold text-[#5D4E37]">
                              {withdrawFundsStep === 'amount' && 'Step 1: Enter withdrawal amount'}
                              {withdrawFundsStep === 'withdraw' && 'Step 2: Confirm withdrawal'}
                            </DialogDescription>
                          </DialogHeader>

                          <div className="space-y-4 py-4">
                            {withdrawFundsStep === 'amount' && (
                              <div className="space-y-4">
                                <div className={`${minecraftSubPanelClass} p-4`}>
                                  <p className="text-sm font-semibold text-[#2D1B00] mb-2">Withdrawable Now:</p>
                                  <p className="text-2xl font-bold text-[#2D1B00]">
                                    {loading ? <Skeleton className="h-8 w-32" /> : `${withdrawableNow.toLocaleString('en-US')} ${projectTokenConfig.symbol}`}
                                  </p>
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="modal-withdraw-amount" className="text-sm font-bold text-[#2D1B00]">
                                    Amount to Withdraw ({projectTokenConfig.symbol})
                                  </Label>
                                  <Input
                                    id="modal-withdraw-amount"
                                    type="number"
                                    inputMode="decimal"
                                    placeholder="e.g. 10000"
                                    value={withdrawAmount}
                                    onChange={(e) => setWithdrawAmount(e.target.value)}
                                    className="h-11 rounded-none border-4 border-[#654321] bg-[#FFF3C4] font-semibold text-[#2D1B00] placeholder:text-[#5D4E37] focus-visible:ring-[#FFD700]"
                                  />
                                  <p className="text-xs text-[#5D4E37]">
                                    Withdraw phase funds unlocked based on project progress and phase completion.
                                  </p>
                                </div>
                                <Button
                                  className={`${minecraftPrimaryButtonClass} w-full h-12`}
                                  disabled={!withdrawAmount || Number(withdrawAmount) <= 0 || Number(withdrawAmount) > withdrawableNow}
                                  onClick={() => setWithdrawFundsStep('withdraw')}
                                >
                                  Continue
                                </Button>
                                {Number(withdrawAmount) > withdrawableNow && withdrawAmount && (
                                  <p className="text-xs text-red-600 font-semibold">
                                    Amount exceeds withdrawable balance
                                  </p>
                                )}
                              </div>
                            )}

                            {withdrawFundsStep === 'withdraw' && (
                              <div className="space-y-4">
                                <div className={`${minecraftSubPanelClass} p-4 space-y-3`}>
                                  <div className="flex justify-between items-center">
                                    <p className="text-sm font-semibold text-[#5D4E37]">Withdrawable:</p>
                                    <p className="text-lg font-bold text-[#2D1B00]">
                                      {withdrawableNow.toLocaleString('en-US')} {projectTokenConfig.symbol}
                                    </p>
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <p className="text-sm font-semibold text-[#5D4E37]">Withdrawing:</p>
                                    <p className="text-xl font-bold text-[#2D1B00]">
                                      {withdrawAmount} {projectTokenConfig.symbol}
                                    </p>
                                  </div>
                                  <div className="h-px bg-[#654321]" />
                                  <div className="flex justify-between items-center">
                                    <p className="text-sm font-semibold text-[#5D4E37]">Remaining:</p>
                                    <p className="text-2xl font-bold text-[#2D1B00]">
                                      {(withdrawableNow - Number(withdrawAmount)).toLocaleString('en-US')} {projectTokenConfig.symbol}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    variant="outline"
                                    className={`${minecraftNeutralButtonClass} flex-1 h-12`}
                                    onClick={() => setWithdrawFundsStep('amount')}
                                  >
                                    Back
                                  </Button>
                                  <Button
                                    className={`${minecraftSuccessButtonClass} flex-1 h-12`}
                                    disabled={isWithdrawingFunds}
                                    onClick={async () => {
                                      try {
                                        if (!canisterId) {
                                          toast.error('Project canister not found');
                                          return;
                                        }
                                        const amt = toStablecoin(withdrawAmount);
                                        setIsWithdrawingFunds(true);
                                        await withdrawPhaseFunds(canisterId, amt);
                                        toast.success('Funds withdrawn successfully!');
                                        resetWithdrawFundsModal();
                                        await refresh();
                                      } catch (e: any) {
                                        toast.error('Withdrawal failed', {
                                          description: e?.message || 'Could not withdraw funds'
                                        });
                                      } finally {
                                        setIsWithdrawingFunds(false);
                                      }
                                    }}
                                  >
                                    {isWithdrawingFunds ? 'Withdrawing...' : 'Confirm Withdrawal'}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>

                    {/* Submit Sales Proceeds */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-[#3D2817]" />
                        <span className="text-sm font-bold text-[#2D1B00]">Submit Sales Proceeds</span>
                      </div>
                      
                      <Dialog open={submitProceedsModalOpen} onOpenChange={(open) => {
                        if (!open) resetSubmitProceedsModal();
                        setSubmitProceedsModalOpen(open);
                      }}>
                        <DialogTrigger asChild>
                          <Button size="sm" className={`${minecraftPrimaryButtonClass} w-full h-10`}>
                            <DollarSign className="mr-2 h-4 w-4" />
                            Submit Proceeds
                          </Button>
                        </DialogTrigger>
                        <DialogContent className={`${minecraftPanelClass} max-w-md`}>
                          <DialogHeader className="pb-4 border-b-4 border-[#654321]">
                            <DialogTitle className="text-xl font-bold uppercase tracking-[0.2em] text-[#2D1B00]">
                              Submit Sales Proceeds
                            </DialogTitle>
                            <DialogDescription className="text-sm font-semibold text-[#5D4E37]">
                              {submitProceedsStep === 'amount' && 'Step 1: Enter proceeds amount'}
                              {submitProceedsStep === 'submit' && 'Step 2: Confirm submission'}
                            </DialogDescription>
                          </DialogHeader>

                          <div className="space-y-4 py-4">
                            {submitProceedsStep === 'amount' && (
                              <div className="space-y-4">
                                <div className={`${minecraftSubPanelClass} p-4`}>
                                  <p className="text-sm font-semibold text-[#2D1B00] mb-2">Principal Buffer Available:</p>
                                  <p className="text-2xl font-bold text-[#2D1B00]">
                                    {loading ? <Skeleton className="h-8 w-32" /> : `${Number(fromStablecoin(realtimeData?.principalBuffer || 0n)).toLocaleString('en-US')} ${projectTokenConfig.symbol}`}
                                  </p>
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="modal-proceeds-amount" className="text-sm font-bold text-[#2D1B00]">
                                    Sales Proceeds Amount ({projectTokenConfig.symbol})
                                  </Label>
                                  <Input
                                    id="modal-proceeds-amount"
                                    type="number"
                                    inputMode="decimal"
                                    placeholder="e.g. 25000"
                                    value={proceedsAmount}
                                    onChange={(e) => setProceedsAmount(e.target.value)}
                                    className="h-11 rounded-none border-4 border-[#654321] bg-[#FFF3C4] font-semibold text-[#2D1B00] placeholder:text-[#5D4E37] focus-visible:ring-[#FFD700]"
                                  />
                                  <p className="text-xs text-[#5D4E37]">
                                    Submit proceeds from property sales or revenue. These funds will be available for investor redemptions.
                                  </p>
                                </div>
                                <Button
                                  className={`${minecraftPrimaryButtonClass} w-full h-12`}
                                  disabled={!proceedsAmount || Number(proceedsAmount) <= 0}
                                  onClick={() => setSubmitProceedsStep('submit')}
                                >
                                  Continue
                                </Button>
                              </div>
                            )}

                            {submitProceedsStep === 'submit' && (
                              <div className="space-y-4">
                                <div className={`${minecraftSubPanelClass} p-4 space-y-3`}>
                                  <div className="flex justify-between items-center">
                                    <p className="text-sm font-semibold text-[#5D4E37]">Current Buffer:</p>
                                    <p className="text-lg font-bold text-[#2D1B00]">
                                      {Number(fromStablecoin(realtimeData?.principalBuffer || 0n)).toLocaleString('en-US')} {projectTokenConfig.symbol}
                                    </p>
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <p className="text-sm font-semibold text-[#5D4E37]">Adding Proceeds:</p>
                                    <p className="text-xl font-bold text-[#2D1B00]">
                                      +{proceedsAmount} {projectTokenConfig.symbol}
                                    </p>
                                  </div>
                                  <div className="h-px bg-[#654321]" />
                                  <div className="flex justify-between items-center">
                                    <p className="text-sm font-semibold text-[#5D4E37]">New Buffer:</p>
                                    <p className="text-2xl font-bold text-[#2D1B00]">
                                      {format((Number(fromStablecoin(realtimeData?.principalBuffer || 0n)) + Number(proceedsAmount)))} {projectTokenConfig.symbol}
                                    </p>
                                  </div>
                                </div>
                                <div className="rounded-lg border-4 border-blue-600 bg-blue-50 p-3">
                                  <div className="flex items-start gap-2">
                                    <DollarSign className="h-5 w-5 text-blue-700 flex-shrink-0 mt-0.5" />
                                    <div>
                                      <p className="text-sm font-bold text-blue-900">Investor Redemptions</p>
                                      <p className="text-xs text-blue-800 mt-1">
                                        These proceeds will be available for investors to redeem their principal investments.
                                      </p>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    variant="outline"
                                    className={`${minecraftNeutralButtonClass} flex-1 h-12`}
                                    onClick={() => setSubmitProceedsStep('amount')}
                                  >
                                    Back
                                  </Button>
                                  <Button
                                    className={`${minecraftSuccessButtonClass} flex-1 h-12`}
                                    disabled={isSubmittingProceeds}
                                    onClick={async () => {
                                      try {
                                        if (!canisterId) {
                                          toast.error('Project canister not found');
                                          return;
                                        }
                                        const amt = toStablecoin(proceedsAmount);
                                        setIsSubmittingProceeds(true);
                                        await submitSalesProceeds(canisterId, amt);
                                        toast.success('Proceeds submitted successfully!');
                                        resetSubmitProceedsModal();
                                        await refresh();
                                      } catch (e: any) {
                                        toast.error('Submit failed', {
                                          description: e?.message || 'Could not submit proceeds'
                                        });
                                      } finally {
                                        setIsSubmittingProceeds(false);
                                      }
                                    }}
                                  >
                                    {isSubmittingProceeds ? 'Submitting...' : 'Confirm Submission'}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>

                  </CardContent>
                </Card>
              </RoleGate>

              {/* Project facts */}
              <Card className={minecraftPanelClass}>
                <CardHeader className={minecraftHeaderClass}>
                  <CardTitle className="text-lg font-bold uppercase tracking-[0.2em] text-[#2D1B00]">Project Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-[#2D1B00] p-6">
                  <div>
                    <p className="font-semibold text-[#5D4E37]">Owner</p>
                    <p className="font-mono text-xs text-[#2D1B00] break-all">
                      {loading ? <Skeleton className="h-4 w-full" /> : project.owner}
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-[#5D4E37]">Interest Reserve</p>
                    <p className="font-bold">
                      {loading ? <Skeleton className="h-4 w-24" /> : `${project.escrow} ${projectTokenConfig.symbol}`}
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-[#5D4E37]">Current Phase</p>
                    <p className="font-bold">
                      {loading ? <Skeleton className="h-4 w-32" /> : project.currentPhase}
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-[#5D4E37]">Supporters</p>
                    <p className="font-bold">
                      {loading ? <Skeleton className="h-4 w-16" /> : project.supporters}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Tabs */}
              <div className="flex flex-wrap items-center gap-3 rounded-none border-4 border-[#654321] bg-[#C4A484] p-2 shadow-[6px_6px_0_rgba(0,0,0,0.35)]">
                {[
                  { id: 'milestones', label: 'Phases' },
                  { id: 'verification', label: 'Documents' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`${minecraftTabButtonBase} ${
                      activeTab === tab.id
                        ? 'bg-[#FFD700] text-[#2D1B00] border-[#AA7700] shadow-[4px_4px_0_rgba(0,0,0,0.35)]'
                        : 'bg-[#8B7355] text-white border-[#3D2817] hover:-translate-y-0.5 hover:shadow-[4px_4px_0_rgba(0,0,0,0.35)]'
                    }`}
                  >
                    <span className="relative z-10 tracking-[0.25em]">{tab.label}</span>
                  </button>
                ))}
              </div>

              {/* Milestones/Phases Tab */}
              {activeTab === 'milestones' && (
                <div className={`${minecraftPanelClass} p-6`}>
                  <div className="relative text-[#2D1B00]">
                    <div className="absolute left-6 top-0 h-full w-px bg-gradient-to-b from-[#3D2817] via-[#8B7355] to-transparent" />
                    <div className="space-y-8">
                      {phasesDetails.map((p, idx) => {
                        const statusKey = p.status as keyof typeof phaseStatusDot;
                        const dotTone = phaseStatusDot[statusKey] ?? 'bg-slate-300';
                        const badgeTone = phaseStatusBadge[statusKey] ?? 'bg-muted text-foreground';
                        const progressWidth = `${Math.min(100, Math.round(p.withdrawnPctOfCap))}%`;
                        const infoBlocks: Array<{ label: string; value: string }> = [
                          { label: 'APR', value: `${p.apr}%` },
                          p.showCumulativeCap
                            ? {
                                label: 'Cumulative Cap',
                                value: `${p.capBps.toFixed(1)}% (${format(Math.round(p.capAmount))} ${projectTokenConfig.symbol})`,
                              }
                            : {
                                label: 'Phase Cap',
                                value: `${format(Math.round(p.capAmount))} ${projectTokenConfig.symbol}`,
                              },
                          p.showWithdrawn
                            ? { label: 'Withdrawn', value: `${format(Math.round(p.withdrawn))} ${projectTokenConfig.symbol}` }
                            : null,
                        ].filter(Boolean) as Array<{ label: string; value: string }>;

                        return (
                          <div key={p.index} className="relative flex gap-6 pl-12 md:pl-16">
                            <div className="absolute left-4 top-6 z-10 flex h-4 w-4 items-center justify-center rounded-full border-4 border-[#3D2817] bg-[#F8E3B5] shadow-[3px_3px_0_rgba(0,0,0,0.3)]">
                              <span className={`h-2.5 w-2.5 rounded-full ${dotTone}`} />
                            </div>
                            <div
                              className={`w-full rounded-lg border-4 border-[#654321] p-5 shadow-[4px_4px_0_rgba(0,0,0,0.3)] transition-all hover:-translate-y-1 hover:shadow-[6px_6px_0_rgba(0,0,0,0.3)] ${
                                idx === currentPhaseIndex ? 'bg-[#FFDFA6]' : 'bg-[#F8E3B5]'
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <p className="text-xs font-bold uppercase tracking-[0.35em] text-[#5D4E37]">
                                    Phase {p.index + 1}
                                  </p>
                                  <h3 className="text-lg font-bold text-[#2D1B00]">{p.name}</h3>
                                </div>
                                <Badge className={`rounded-none px-4 py-1 text-xs font-bold uppercase tracking-[0.25em] ${badgeTone}`}>
                                  {p.status}
                                </Badge>
                              </div>

                              <div className="mt-4 grid gap-4 md:grid-cols-3">
                                {infoBlocks.map((block) => (
                                  <div key={block.label}>
                                    <p className="text-[0.65rem] font-bold uppercase tracking-[0.3em] text-[#5D4E37]">
                                      {block.label}
                                    </p>
                                    <p className="text-sm font-bold text-[#2D1B00]">
                                      {loading ? <Skeleton className="h-4 w-20" /> : block.value}
                                    </p>
                                  </div>
                                ))}
                              </div>

                              {p.showWithdrawn && (
                                <>
                                  <div className="mt-5 space-y-2">
                                    <div className="flex items-center justify-between text-xs font-semibold text-[#5D4E37]">
                                      <span>Cap Unlock Progress</span>
                                      <span>{progressWidth}</span>
                                    </div>
                                    <div className="relative h-2 w-full overflow-hidden rounded-none border-4 border-[#654321] bg-[#B08D69]">
                                      <div
                                        className="absolute inset-y-0 left-0 bg-[#5599FF]"
                                        style={{ width: progressWidth }}
                                      />
                                    </div>
                                  </div>
                                  <p className="mt-3 text-xs text-[#5D4E37]">
                                    Phase cap unlocked and included in cumulative developer withdrawals.
                                  </p>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Documents/Verification Tab */}
              {activeTab === 'verification' && (
                <div className={`${minecraftPanelClass} p-6`}>
                  <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
                    <div className="space-y-3">
                      {phasesDetails.map((p) => {
                        const statusKey = p.status as keyof typeof phaseStatusBadge;
                        const docs = phaseDocuments[p.index] || [];
                        return (
                          <button
                            key={`docs-nav-${p.index}`}
                            type="button"
                            onClick={() => setActiveDocPhase(p.index)}
                            className={`w-full rounded-lg border-4 px-4 py-3 text-left font-semibold tracking-[0.05em] shadow-[3px_3px_0_rgba(0,0,0,0.25)] transition-all ${
                              activeDocPhase === p.index
                                ? 'border-[#AA7700] bg-[#FFDFA6] text-[#2D1B00]'
                                : 'border-[#654321] bg-[#EBD8B0] text-[#5D4E37] hover:-translate-y-1 hover:shadow-[5px_5px_0_rgba(0,0,0,0.3)]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-semibold">Phase {p.index + 1}</p>
                              <Badge className={`rounded-none px-3 py-1 text-[0.65rem] font-bold uppercase tracking-[0.2em] ${phaseStatusBadge[statusKey] ?? ''}`}>
                                {p.status}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-[#5D4E37]">{p.name}</p>
                            <div className="mt-3 flex items-center justify-between text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-[#5D4E37]">
                              <span>{docs.length} docs</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className={`${minecraftSubPanelClass} p-5 text-[#2D1B00]`}>
                      {(() => {
                        const activePhase = phasesDetails[activeDocPhase];
                        const docs = phaseDocuments[activeDocPhase] || [];
                        return (
                          <>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-[0.65rem] font-bold uppercase tracking-[0.3em] text-[#5D4E37]">
                                  Phase {activePhase.index + 1}
                                </p>
                                <h3 className="text-lg font-bold text-[#2D1B00]">
                                  {activePhase.name}
                                </h3>
                              </div>
                              <Badge className="rounded-none border-4 border-[#654321] bg-[#FFD700] px-4 py-1 text-xs font-bold uppercase tracking-[0.2em] text-[#2D1B00] shadow-[2px_2px_0_rgba(0,0,0,0.25)]">
                                {activePhase.status}
                              </Badge>
                            </div>

                            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                              {docs.length > 0 ? (
                                docs.map((d: any) => (
                                  <div
                                    key={d.id || d.uri}
                                    className="group flex h-full flex-col overflow-hidden rounded-lg border-4 border-[#654321] bg-[#F8E3B5] text-left shadow-[4px_4px_0_rgba(0,0,0,0.3)] transition-all hover:-translate-y-1 hover:shadow-[6px_6px_0_rgba(0,0,0,0.3)]"
                                  >
                                    <div className="relative aspect-video w-full overflow-hidden border-b-4 border-[#654321] bg-[#EBD8B0]">
                                      <div className="flex h-full w-full items-center justify-center text-[#5D4E37]">
                                        <FileText className="h-8 w-8" />
                                      </div>
                                      <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#3D2817]/40 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-80" />
                                    </div>
                                    <div className="flex flex-1 flex-col justify-between p-3">
                                      <div>
                                        <p className="truncate text-sm font-bold text-[#2D1B00]">
                                          {d.type || 'Document'}
                                        </p>
                                        <p className="mt-1 text-[0.65rem] font-bold uppercase tracking-[0.3em] text-[#5D4E37]">
                                          {d.type?.toUpperCase() || 'FILE'}
                                        </p>
                                      </div>
                                      <p className="mt-2 text-[0.65rem] text-[#5D4E37] truncate">
                                        {d.hash ? `Hash: ${d.hash.slice(0, 10)}…` : d.uri}
                                      </p>
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <div className="col-span-full flex flex-col items-center justify-center rounded-lg border-4 border-dashed border-[#654321] bg-[#F8E3B5] p-8 text-center text-sm text-[#5D4E37] shadow-[4px_4px_0_rgba(0,0,0,0.25)]">
                                  <FileText className="mb-3 h-10 w-10 text-[#3D2817]" />
                                  <p>No documents uploaded for this phase yet.</p>
                                  <p className="mt-1 text-xs text-[#3D2817]">
                                    Developer submissions will appear here once the phase closes.
                                  </p>
                                </div>
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectDetails;