import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWallet } from '@/hooks/use-wallet';
import {
  getCompleteProjectData,
  getProjectListingByCanisterId,
  ProjectMetrics,
  UserMetrics,
} from '@/lib/canister-queries';
import {
  fetchProjectStaticConfig,
  ProjectStaticConfig,
  fromStablecoin,
  toStablecoin,
  deposit,
  claimInterest,
  claimRevenue,
} from '@/lib/icp';
import { ProjectListing, DocRecord } from '@/lib/icp';
import { buildProjectInsightsData } from '@/lib/project-insights';
import { ProjectInsightsPanel } from '@/components/project/ProjectInsightsPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/sonner';
import {
  ArrowLeft,
  Loader2,
  TrendingUp,
  Users,
  Clock,
  CheckCircle,
  DollarSign,
  Wallet,
  BarChart3,
  FileText,
  AlertCircle,
} from 'lucide-react';

const PHASE_LABELS = [
  'Fundraising and Acquisition',
  'Design and Architectural',
  'Permitting',
  'Abatement/Demolition',
  'Construction',
  'Revenue and Sales',
];

const formatTimestamp = (seconds?: bigint | number | null) => {
  if (seconds === null || seconds === undefined) {
    return 'N/A';
  }

  const asNumber = typeof seconds === 'bigint' ? Number(seconds) : seconds;

  if (!asNumber) {
    return 'N/A';
  }

  const date = new Date(asNumber * 1000);
  if (Number.isNaN(date.getTime())) {
    return 'N/A';
  }

  return date.toLocaleString();
};

const ProjectDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { principal, isConnected } = useWallet();

  const [loading, setLoading] = useState(true);
  const [listing, setListing] = useState<ProjectListing | null>(null);
  const [project, setProject] = useState<ProjectMetrics | null>(null);
  const [staticConfig, setStaticConfig] = useState<ProjectStaticConfig | null>(null);
  const [userMetrics, setUserMetrics] = useState<UserMetrics | null>(null);

  // Deposit state
  const [depositAmount, setDepositAmount] = useState('');
  const [isDepositing, setIsDepositing] = useState(false);
  const [isClaimingInterest, setIsClaimingInterest] = useState(false);
  const [isClaimingRevenue, setIsClaimingRevenue] = useState(false);

  const tokenSymbol = listing?.params?.token_symbol || staticConfig?.tokenSymbol || 'USDC';

  const formatAmount = (amount: bigint) => {
    const numeric = Number(fromStablecoin(amount));
    if (Number.isNaN(numeric)) {
      return '0.00';
    }

    return numeric.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const formatCurrency = (amount: bigint) => `${formatAmount(amount)} ${tokenSymbol}`;

  const displayTitle =
    listing?.params?.token_name || staticConfig?.projectName || (id ? `Project ${id.slice(0, 8)}...` : 'Project');

  const fetchProjectData = async () => {
    if (!id) return;

    setLoading(true);
    try {
      // Fetch from canister
      const userPrincipal = isConnected && principal ? principal : undefined;
      const { project: projectData, userMetrics: userData } = await getCompleteProjectData(
        id,
        userPrincipal
      );

      if (!projectData) {
        toast.error('Project not found');
        navigate('/projects');
        return;
      }

      setUserMetrics(userData);

      const [configResult, registryListing] = await Promise.all([
        fetchProjectStaticConfig(id).catch((error) => {
          console.error('Error fetching project static config:', error);
          return null as ProjectStaticConfig | null;
        }),
        getProjectListingByCanisterId(id),
      ]);

      setStaticConfig(configResult ?? null);
      setListing(registryListing);

      const projectWithMetadata = registryListing
        ? { ...projectData, createdAt: registryListing.created_at }
        : projectData;

      setProject(projectWithMetadata);
    } catch (error) {
      console.error('Error fetching project:', error);
      toast.error('Failed to load project details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjectData();
  }, [id, isConnected, principal]);

  const handleDeposit = async () => {
    if (!depositAmount || !id) return;

    if (!isConnected) {
      toast.error('Connect your wallet to invest in this project');
      return;
    }

    setIsDepositing(true);
    try {
      const amount = toStablecoin(depositAmount);
      if (amount <= 0n) {
        toast.error('Enter an amount greater than zero');
        return;
      }

      await deposit(id, amount);

      toast.success(`Deposited ${formatCurrency(amount)}`);

      await fetchProjectData();
      setDepositAmount('');
    } catch (error: any) {
      console.error('Deposit error:', error);
      toast.error(error.message || 'Failed to deposit');
    } finally {
      setIsDepositing(false);
    }
  };

  const handleClaimInterest = async () => {
    if (!id || !userMetrics) return;

    try {
      const amount = userMetrics.claimableInterest;

      if (amount <= 0n) {
        toast.info('No claimable interest available right now');
        return;
      }

      setIsClaimingInterest(true);
      const claimed = await claimInterest(id, amount);
      toast.success(`Claimed ${formatCurrency(claimed)} in interest`);
      await fetchProjectData();
    } catch (error: any) {
      toast.error(error.message || 'Failed to claim interest');
    } finally {
      setIsClaimingInterest(false);
    }
  };

  const handleClaimRevenue = async () => {
    if (!id || !userMetrics) return;

    try {
      const amount = userMetrics.claimableRevenue;

      if (amount <= 0n) {
        toast.info('No claimable revenue available right now');
        return;
      }

      setIsClaimingRevenue(true);
      const claimed = await claimRevenue(id);
      toast.success(`Claimed ${formatCurrency(claimed)} in revenue`);
      await fetchProjectData();
    } catch (error: any) {
      toast.error(error.message || 'Failed to claim revenue');
    } finally {
      setIsClaimingRevenue(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#87CEEB] via-[#B0D9F0] to-[#D4E8F5] flex items-center justify-center">
        <div className="bg-gradient-to-b from-[#8B4513] to-[#654321] p-1">
          <div className="bg-[#D2B48C] p-8 border-4 border-[#654321]">
            <Loader2 className="w-12 h-12 animate-spin text-[#654321]" />
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#87CEEB] via-[#B0D9F0] to-[#D4E8F5] flex items-center justify-center">
        <div className="text-center">
          <p className="text-2xl font-bold text-[#2D1B00] mb-4">Project not found</p>
          <Button onClick={() => navigate('/projects')}>Go Back</Button>
        </div>
      </div>
    );
  }

  const insightsData = buildProjectInsightsData({
    project,
    staticConfig,
    tokenSymbol,
    now: Date.now(),
  });

  const currentPhaseData = project.phases[project.currentPhase];
  const currentPhaseApr = currentPhaseData ? `${(currentPhaseData.aprBps / 100).toFixed(2)}%` : 'N/A';

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#87CEEB] via-[#B0D9F0] to-[#D4E8F5]">
      {/* Minecraft grid background */}
      <div className="absolute inset-0 opacity-10 pointer-events-none">
        <div className="absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent,transparent_16px,rgba(0,0,0,0.1)_16px,rgba(0,0,0,0.1)_18px)]"></div>
        <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,transparent,transparent_16px,rgba(0,0,0,0.1)_16px,rgba(0,0,0,0.1)_18px)]"></div>
      </div>

      <div className="container mx-auto px-4 py-8 relative z-10 max-w-7xl">
        {/* Back Button */}
        <Button
          onClick={() => navigate('/projects')}
          variant="outline"
          className="mb-6 bg-[#8B7355] hover:bg-[#654321] text-white border-4 border-[#654321] font-bold"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Projects
        </Button>

        {/* Header Section */}
        <div className="bg-gradient-to-b from-[#654321] to-[#3D2817] p-1 mb-8">
          <div className="bg-gradient-to-b from-[#8B4513] to-[#654321] p-6 border-4 border-[#3D2817]">
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div className="flex-1">
                <h1 className="text-3xl md:text-4xl font-bold text-[#FFD700] mb-2 [text-shadow:_3px_3px_0_rgb(0_0_0_/_40%)]">
                  {displayTitle}
                </h1>
                <p className="text-white font-mono text-sm mb-4">
                  Canister: {id}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge className="bg-[#FFD700] text-[#2D1B00] border-2 border-[#AA7700]">
                    {PHASE_LABELS[project.currentPhase] || 'Unknown Phase'}
                  </Badge>
                  <Badge className="bg-[#55AAFF] text-white border-2 border-[#2D5788]">
                    Token: {tokenSymbol}
                  </Badge>
                  {project.fundraiseClosed ? (
                    project.fundraiseSuccessful ? (
                      <Badge className="bg-[#55AA55] text-white border-2 border-[#2D572D]">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Active
                      </Badge>
                    ) : (
                      <Badge className="bg-[#AA5555] text-white border-2 border-[#572D2D]">
                        Closed
                      </Badge>
                    )
                  ) : (
                    <Badge className="bg-[#FFAA00] text-white border-2 border-[#AA7700]">
                      <Clock className="w-3 h-3 mr-1" />
                      Fundraising
                    </Badge>
                  )}
                </div>
                {listing?.metadata_uri && (
                  <a
                    href={listing.metadata_uri}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-xs font-semibold text-[#FFD700] underline decoration-dotted mt-3"
                  >
                    <FileText className="w-3 h-3" />
                    View metadata
                  </a>
                )}
              </div>

              <div className="text-right">
                <p className="text-xs text-[#FFD700] mb-1">OWNER</p>
                <p className="text-white font-mono text-sm">
                  {project.creator.slice(0, 10)}...{project.creator.slice(-8)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            icon={<TrendingUp className="w-6 h-6" />}
            label="Total Raised"
            value={formatCurrency(project.totalRaised)}
            color="text-[#55AA55]"
          />
          <StatCard
            icon={<DollarSign className="w-6 h-6" />}
            label="Pool Balance"
            value={formatCurrency(project.poolBalance)}
            color="text-[#5599FF]"
          />
          <StatCard
            icon={<BarChart3 className="w-6 h-6" />}
            label="Reserve Balance"
            value={formatCurrency(project.reserveBalance)}
            color="text-[#FFAA00]"
          />
          <StatCard
            icon={<Users className="w-6 h-6" />}
            label="Current Phase"
            value={`Phase ${project.currentPhase + 1}`}
            color="text-[#FF6B35]"
          />
        </div>

        {/* Main Content Tabs */}
        <Tabs defaultValue="overview" className="mb-8">
          <TabsList className="bg-[#8B7355] border-4 border-[#654321] p-1">
            <TabsTrigger value="overview" className="data-[state=active]:bg-[#FFD700] data-[state=active]:text-[#2D1B00] font-bold">
              Overview
            </TabsTrigger>
            <TabsTrigger value="invest" className="data-[state=active]:bg-[#FFD700] data-[state=active]:text-[#2D1B00] font-bold">
              Invest
            </TabsTrigger>
            <TabsTrigger value="phases" className="data-[state=active]:bg-[#FFD700] data-[state=active]:text-[#2D1B00] font-bold">
              Phases
            </TabsTrigger>
            <TabsTrigger value="insights" className="data-[state=active]:bg-[#FFD700] data-[state=active]:text-[#2D1B00] font-bold">
              Insights
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <MinecraftCard title="Project Information">
                <div className="space-y-3">
                  <InfoRow label="Status" value={project.fundraiseClosed ? (project.fundraiseSuccessful ? 'Active' : 'Closed') : 'Fundraising'} />
                  <InfoRow label="Registry ID" value={listing ? listing.id.toString() : 'Not registered'} />
                  <InfoRow label="Current Phase" value={PHASE_LABELS[project.currentPhase]} />
                  <InfoRow label="Phase APR" value={currentPhaseApr} />
                  <InfoRow label="Total Withdrawn" value={formatCurrency(project.totalDevWithdrawn)} />
                  <InfoRow label="Principal Buffer" value={formatCurrency(project.principalBuffer)} />
                  {staticConfig && (
                    <>
                      <InfoRow label="Min Raise" value={formatCurrency(staticConfig.minRaise)} />
                      <InfoRow label="Max Raise" value={formatCurrency(staticConfig.maxRaise)} />
                    </>
                  )}
                  {project.createdAt !== 0n && (
                    <InfoRow label="Created" value={formatTimestamp(project.createdAt)} />
                  )}
                  {staticConfig?.fundraiseDeadline && (
                    <InfoRow label="Fundraise Deadline" value={formatTimestamp(staticConfig.fundraiseDeadline)} />
                  )}
                </div>
              </MinecraftCard>

              {isConnected && userMetrics && (
                <MinecraftCard title="Your Investment">
                  <div className="space-y-3">
                    <InfoRow label="Your Shares" value={`${formatAmount(userMetrics.balance)} ${tokenSymbol}`} />
                    <InfoRow
                      label="Claimable Interest"
                      value={formatCurrency(userMetrics.claimableInterest)}
                      action={
                        <Button
                          size="sm"
                          onClick={handleClaimInterest}
                          disabled={userMetrics.claimableInterest === 0n || isClaimingInterest}
                          className="bg-[#55AA55] hover:bg-[#449944] text-white border-2 border-[#2D572D] font-bold disabled:opacity-60"
                        >
                          {isClaimingInterest ? (
                            <>
                              <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                              Claiming
                            </>
                          ) : (
                            'Claim'
                          )}
                        </Button>
                      }
                    />
                    <InfoRow
                      label="Claimable Revenue"
                      value={formatCurrency(userMetrics.claimableRevenue)}
                      action={
                        <Button
                          size="sm"
                          onClick={handleClaimRevenue}
                          disabled={userMetrics.claimableRevenue === 0n || isClaimingRevenue}
                          className="bg-[#5599FF] hover:bg-[#4488EE] text-white border-2 border-[#2D5788] font-bold disabled:opacity-60"
                        >
                          {isClaimingRevenue ? (
                            <>
                              <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                              Claiming
                            </>
                          ) : (
                            'Claim'
                          )}
                        </Button>
                      }
                    />
                    <InfoRow label="Interest Withdrawn" value={formatCurrency(userMetrics.interestWithdrawn)} />
                    <InfoRow label="Revenue Withdrawn" value={formatCurrency(userMetrics.revenueWithdrawn)} />
                  </div>
                </MinecraftCard>
              )}

              {isConnected && !userMetrics && (
                <MinecraftCard title="Your Investment">
                  <div className="text-center py-8 text-sm font-semibold text-[#5D4E37]">
                    You have not invested in this project yet.
                  </div>
                </MinecraftCard>
              )}

              {project.appraisals.length > 0 && (
                <MinecraftCard title="Appraisal Updates">
                  <div className="space-y-3">
                    {project.appraisals
                      .slice()
                      .reverse()
                      .map((appraisal, index) => (
                        <div
                          key={`${appraisal.appraisal_hash}-${index}`}
                          className="flex flex-col gap-1 border-b-2 border-[#8B7355]/40 pb-3 last:border-0 last:pb-0"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-bold text-[#2D1B00]">
                              Phase progress: {appraisal.percent_complete}%
                            </p>
                            <Badge className="bg-[#FFD700] text-[#2D1B00] border-2 border-[#AA7700]">
                              {formatTimestamp(appraisal.submitted_at)}
                            </Badge>
                          </div>
                          {appraisal.appraisal_hash && (
                            <p className="text-xs font-mono text-[#5D4E37] break-all">
                              Hash: {appraisal.appraisal_hash}
                            </p>
                          )}
                        </div>
                      ))}
                  </div>
                </MinecraftCard>
              )}

              {!isConnected && (
                <MinecraftCard title="Connect Wallet">
                  <div className="text-center py-8">
                    <Wallet className="w-12 h-12 mx-auto mb-4 text-[#654321]" />
                    <p className="text-[#5D4E37] mb-4">Connect your wallet to view your investment details</p>
                  </div>
                </MinecraftCard>
              )}
            </div>
          </TabsContent>

          {/* Invest Tab */}
          <TabsContent value="invest" className="mt-6">
            <MinecraftCard title="Invest in this Project">
              {!project.fundraiseClosed ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-bold text-[#2D1B00] mb-2">Amount ({tokenSymbol})</label>
                    <Input
                      type="number"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      placeholder="0.00"
                      className="bg-[#D2B48C] border-4 border-[#654321] text-[#2D1B00] font-bold"
                      min="0"
                      disabled={!isConnected}
                    />
                  </div>

                  <Button
                    onClick={handleDeposit}
                    disabled={!isConnected || !depositAmount || isDepositing}
                    className="w-full bg-[#55AA55] hover:bg-[#449944] text-white border-4 border-[#2D572D] font-bold text-lg py-6"
                  >
                    {isDepositing ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        Depositing...
                      </>
                    ) : (
                      <>
                        <DollarSign className="w-5 h-5 mr-2" />
                        {isConnected ? 'Deposit' : 'Connect Wallet to Invest'}
                      </>
                    )}
                  </Button>

                  <div className="bg-[#FFD700]/20 border-4 border-[#FFD700] p-4">
                    <p className="text-xs text-[#2D1B00] font-semibold">
                      💡 <strong>Tip:</strong> Make sure your connected identity has sufficient {tokenSymbol} before confirming the deposit.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <AlertCircle className="w-12 h-12 mx-auto mb-4 text-[#AA5555]" />
                  <p className="text-[#5D4E37] font-bold">Fundraising has closed for this project</p>
                </div>
              )}
            </MinecraftCard>
          </TabsContent>

          {/* Phases Tab */}
          <TabsContent value="phases" className="mt-6">
            <div className="space-y-4">
              {project.phases.map((phase, index) => (
                <PhaseCard
                  key={index}
                  phase={phase}
                  index={index}
                  isActive={index === project.currentPhase}
                  isPast={index < project.currentPhase}
                  staticConfig={staticConfig}
                  documents={project.phaseDocuments[index] || []}
                  formatCurrency={formatCurrency}
                  tokenSymbol={tokenSymbol}
                />
              ))}
            </div>
          </TabsContent>

          {/* Insights Tab */}
          <TabsContent value="insights" className="mt-6">
            <MinecraftCard title="Project Insights">
              <ProjectInsightsPanel
                loading={false}
                data={insightsData}
                tokenSymbol={tokenSymbol}
              />
            </MinecraftCard>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

// Helper Components

const StatCard = ({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) => (
  <div className="bg-gradient-to-b from-[#8B4513] to-[#654321] p-1">
    <div className="bg-[#D2B48C] p-4 border-4 border-[#654321]">
      <div className="flex items-center gap-3 mb-2">
        <div className={color}>{icon}</div>
        <p className="text-xs font-bold text-[#5D4E37] uppercase">{label}</p>
      </div>
      <p className="text-xl font-bold text-[#2D1B00]">{value}</p>
    </div>
  </div>
);

const MinecraftCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="bg-gradient-to-b from-[#8B4513] to-[#654321] p-1">
    <div className="bg-[#D2B48C] border-4 border-[#654321]">
      <div className="bg-[#8B7355] border-b-4 border-[#654321] px-4 py-3">
        <h3 className="text-lg font-bold text-[#FFD700]">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  </div>
);

const InfoRow = ({
  label,
  value,
  action
}: {
  label: string;
  value: string;
  action?: React.ReactNode;
}) => (
  <div className="flex items-center justify-between py-2 border-b-2 border-[#8B7355]/30 last:border-0">
    <span className="text-sm font-bold text-[#5D4E37]">{label}</span>
    <div className="flex items-center gap-2">
      <span className="text-sm font-bold text-[#2D1B00]">{value}</span>
      {action}
    </div>
  </div>
);

const PhaseCard = ({
  phase,
  index,
  isActive,
  isPast,
  staticConfig,
  documents,
  formatCurrency,
  tokenSymbol,
}: {
  phase: any;
  index: number;
  isActive: boolean;
  isPast: boolean;
  staticConfig: ProjectStaticConfig | null;
  documents: DocRecord[];
  formatCurrency: (amount: bigint) => string;
  tokenSymbol: string;
}) => {
  const maxRaise = staticConfig?.maxRaise ?? 0n;
  const capAmount = staticConfig ? (maxRaise * BigInt(phase.capBps)) / 10000n : 0n;
  const durationDays = Number(phase.duration) / 86400;
  const formattedDuration = Number.isFinite(durationDays) ? durationDays.toFixed(1) : '0.0';

  return (
    <div className={`bg-gradient-to-b p-1 ${
      isActive
        ? 'from-[#FFD700] to-[#FFAA00]'
        : isPast
        ? 'from-[#55AA55] to-[#449944]'
        : 'from-[#8B7355] to-[#654321]'
    }`}>
      <div className="bg-[#D2B48C] border-4 border-[#654321] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
              isActive
                ? 'bg-[#FFD700] text-[#2D1B00]'
                : isPast
                ? 'bg-[#55AA55] text-white'
                : 'bg-[#8B7355] text-white'
            }`}>
              {index + 1}
            </div>
            <h4 className="text-lg font-bold text-[#2D1B00]">{PHASE_LABELS[index]}</h4>
          </div>
          {isActive && (
            <Badge className="bg-[#FFD700] text-[#2D1B00] border-2 border-[#AA7700]">
              Current
            </Badge>
          )}
          {isPast && (
            <Badge className="bg-[#55AA55] text-white border-2 border-[#2D572D]">
              <CheckCircle className="w-3 h-3 mr-1" />
              Complete
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-[#5D4E37] font-bold mb-1">APR</p>
            <p className="text-[#2D1B00] font-bold">{(phase.aprBps / 100).toFixed(2)}%</p>
          </div>
          <div>
            <p className="text-[#5D4E37] font-bold mb-1">Withdraw Cap</p>
            <p className="text-[#2D1B00] font-bold">{capAmount > 0n ? formatCurrency(capAmount) : `0 ${tokenSymbol}`}</p>
          </div>
          <div>
            <p className="text-[#5D4E37] font-bold mb-1">Duration</p>
            <p className="text-[#2D1B00] font-bold">{formattedDuration} days</p>
          </div>
          <div>
            <p className="text-[#5D4E37] font-bold mb-1">Withdrawn</p>
            <p className="text-[#2D1B00] font-bold">{formatCurrency(phase.withdrawn)}</p>
          </div>
        </div>

        {documents.length > 0 && (
          <div className="mt-4 border-t-2 border-dashed border-[#8B7355]/40 pt-4">
            <p className="text-sm font-bold text-[#5D4E37] mb-2 flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#FFD700]" /> Supporting Documents
            </p>
            <div className="space-y-3">
              {documents.map((doc, docIndex) => (
                <div
                  key={`${doc.submitted_at.toString()}-${docIndex}`}
                  className="bg-[#8B7355]/20 border-2 border-[#654321] p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#2D1B00] font-semibold">
                    <span>Submitted {formatTimestamp(doc.submitted_at)}</span>
                    <span>
                      {doc.doc_types.length} file{doc.doc_types.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {doc.doc_types.map((type, typeIndex) => {
                      const hash = doc.doc_hashes[typeIndex];
                      const uri = doc.metadata_uris[typeIndex];
                      return (
                        <li
                          key={`${type}-${typeIndex}`}
                          className="flex flex-wrap items-center gap-2 text-xs font-mono text-[#2D1B00]"
                        >
                          <span className="font-bold text-[#FFD700]">{type}</span>
                          {uri && (
                            <a
                              href={uri}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[#5599FF] underline decoration-dotted"
                            >
                              Open
                            </a>
                          )}
                          {hash && <span className="text-[#5D4E37] break-all">{hash}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectDetails;
