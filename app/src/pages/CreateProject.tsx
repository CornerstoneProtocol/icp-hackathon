import { useMemo, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, ArrowRight, Check, Wallet } from 'lucide-react';
import { getAccount, login, isAuthenticated, registerProject, ProjectParams, Address, toStablecoin } from '@/lib/icp';
import { canistersConfig, SUPPORTED_TOKENS, getTokenConfigBySymbol } from '@/config/canisters';
import { toast } from '@/components/ui/sonner';

interface Milestone {
  id: string;
  title: string;
  summary: string;
  payout: string; // percent of max raise
  apr: string; // percent APR for this phase
  dueDate: string;
}

const CreateProject = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const [account, setAccount] = useState<Address | null>(null);
  const [connected, setConnected] = useState(false);
  const [milestones, setMilestones] = useState<Milestone[]>([
    {
      id: '1',
      title: 'Fundraising and Acquisition (No Interest)',
      summary:
        'Closes when plot reflects new owner and title docs provided. No interest during this stage; early entrants get a future interest bonus.',
      payout: '50',
      apr: '0',
      dueDate: '',
    },
    {
      id: '2',
      title: 'Design and Architectural',
      summary:
        'Closes when design PDFs are submitted.',
      payout: '5',
      apr: '15',
      dueDate: '',
    },
    {
      id: '3',
      title: 'Permitting',
      summary:
        'Closes when permits are submitted (HPO registration, warranty, demo/abatement).',
      payout: '5',
      apr: '12',
      dueDate: '',
    },
    {
      id: '4',
      title: 'Abatement/Demolition',
      summary:
        'Closes when abatement, demolition permits and the building permit is submitted.',
      payout: '10',
      apr: '9',
      dueDate: '',
    },
    {
      id: '5',
      title: 'Construction',
      summary:
        'Appraisal reports unlock mid-phase payouts; final closure with occupancy permit.',
      payout: '30',
      apr: '5',
      dueDate: '',
    },
    {
      id: '6',
      title: 'Revenue and Sales',
      summary: 'Final phase; sales proceeds distribute principal first, then revenue pro‑rata.',
      payout: '0',
      apr: '3',
      dueDate: '',
    },
  ]);

  const steps = [
    { id: 0, title: 'Basics', description: 'Project information' },
    { id: 1, title: 'Funding', description: 'Financial details' },
    { id: 2, title: 'Phases', description: 'Project roadmap' },
    { id: 3, title: 'Links', description: 'Social & resources' },
    { id: 4, title: 'Preview', description: 'Review & publish' },
  ];

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [minRaise, setMinRaise] = useState('');
  const [maxRaise, setMaxRaise] = useState('');
  const [fundingDurationDays, setFundingDurationDays] = useState('30');
  const [selectedToken, setSelectedToken] = useState<'ckUSDC' | 'ckUSDT'>('ckUSDC');
  const [logoUrl, setLogoUrl] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [website, setWebsite] = useState('');
  const [github, setGithub] = useState('');
  const [twitter, setTwitter] = useState('');
  const [discord, setDiscord] = useState('');

  const tokenName = useMemo(() => `Cornerstone-${name || 'Project'}`, [name]);
  const tokenSymbol = useMemo(() => {
    const base = (name || 'CST').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    return `CST-${base || 'PRJ'}`;
  }, [name]);

  const [deployInfo, setDeployInfo] = useState<{ 
    id: string; 
    projectCanister?: string; 
    tokenCanister?: string;
  } | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  useEffect(() => {
    checkConnection();
  }, []);

  async function checkConnection() {
    const authenticated = await isAuthenticated();
    if (authenticated) {
      const addr = await getAccount();
      if (addr) {
        setAccount(addr);
        setConnected(true);
      }
    }
  }

  async function connectWallet() {
    try {
      await login('bitfinity');
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

  async function handlePublish() {
    setIsPublishing(true);
    try {
      // Validate registry canister is configured
      if (!canistersConfig.registry) {
        toast.error('Registry canister not configured (VITE_REGISTRY_CANISTER_ID)');
        setIsPublishing(false);
        return;
      }

      // Get token canister ID
      const tokenConfig = getTokenConfigBySymbol(selectedToken);
      if (!tokenConfig) {
        toast.error(`${selectedToken} configuration not found`);
        setIsPublishing(false);
        return;
      }

      const tokenCanisterId = selectedToken === 'ckUSDC' 
        ? canistersConfig.ckusdc 
        : canistersConfig.ckusdt;

      if (!tokenCanisterId) {
        toast.error(`${selectedToken} canister ID not configured`);
        setIsPublishing(false);
        return;
      }

      // Validate inputs
      if (!name || !minRaise || !maxRaise) {
        toast.error('Fill in name, min and max raise');
        setIsPublishing(false);
        return;
      }

      // Check if wallet is connected
      if (!connected) {
        toast.error('Please connect your wallet first');
        setIsPublishing(false);
        return;
      }

      // Calculate deadline (Unix timestamp in nanoseconds for ICP)
      const now = Math.floor(Date.now() / 1000);
      const deadline = now + (parseInt(fundingDurationDays || '0', 10) * 86400);
      const deadlineNanos = BigInt(deadline) * BigInt(1_000_000_000);

      // Prepare phase data
      const allMilestones = milestones;
      const phaseAPRs = allMilestones.map(m => Math.round(parseFloat(m.apr || '0') * 100)); // % → bps
      const phaseCaps = allMilestones.map(m => Math.round(parseFloat(m.payout || '0') * 100)); // % → bps
      
      if (phaseAPRs.length !== 6 || phaseCaps.length !== 6) {
        toast.error('Exactly 6 phases required (including fundraising phase 0)');
        setIsPublishing(false);
        return;
      }

      // Validate total caps don't exceed 100%
      const sumCaps = phaseCaps.slice(1).reduce((a, b) => a + b, 0); // only development phases count
      if (sumCaps > 10000) {
        toast.error('Phase caps exceed 100% total');
        setIsPublishing(false);
        return;
      }

      // Phase durations (informational, set to 0 for now)
      const phaseDurations = new Array(6).fill(0n);

      // Convert raise amounts to token units (with decimals)
      const minRaiseAmount = toStablecoin(minRaise);
      const maxRaiseAmount = toStablecoin(maxRaise);

      // Create metadata JSON
      const metadata = {
        name,
        description,
        logo: logoUrl,
        banner: bannerUrl,
        website,
        github,
        twitter,
        discord,
        phases: milestones.map((m, i) => ({
          id: i,
          title: m.title,
          summary: m.summary,
          dueDate: m.dueDate,
        })),
      };

      // For now, store metadata as JSON string
      // In production, you'd upload this to IPFS or a storage canister
      // Use TextEncoder and base64 for Unicode-safe encoding
      // New Unicode-safe code:
      const metadataJson = JSON.stringify(metadata);
      const uint8Array = new TextEncoder().encode(metadataJson);

      // Convert uint8Array to base64 in a Unicode-safe way
      let binaryString = '';
      for (let i = 0; i < uint8Array.length; i++) {
        binaryString += String.fromCharCode(uint8Array[i]);
      }
      const base64String = btoa(binaryString);
      const metadataUri = `data:application/json;base64,${base64String}`;

      // Prepare project parameters
      const params: ProjectParams = {
        stablecoin: tokenCanisterId,
        min_raise: minRaiseAmount,
        max_raise: maxRaiseAmount,
        fundraise_deadline: deadlineNanos,
        phase_aprs_bps: phaseAPRs,
        phase_durations: phaseDurations,
        phase_withdraw_caps_bps: phaseCaps,
        token_name: tokenName,
        token_symbol: tokenSymbol,
      };

      console.log('[CreateProject] Registering project with params:', {
        ...params,
        min_raise: params.min_raise.toString(),
        max_raise: params.max_raise.toString(),
        fundraise_deadline: params.fundraise_deadline.toString(),
      });

      toast.info('Registering project on registry...');

      // Call registry to register project
      const listing = await registerProject(params, metadataUri);

      console.log('[CreateProject] Project registered - raw listing:', listing);
      console.log('[CreateProject] project_canister type:', typeof listing.project_canister);
      console.log('[CreateProject] project_canister value:', listing.project_canister);

      // Handle Principal objects that might be returned as strings, objects, or arrays
      let projectCanisterStr: string | undefined;
      let tokenCanisterStr: string | undefined;
      let creatorStr: string;

      // Handle project_canister
      if (listing.project_canister) {
        if (typeof listing.project_canister === 'string') {
          projectCanisterStr = listing.project_canister;
        } else if (Array.isArray(listing.project_canister) && listing.project_canister.length > 0) {
          // Candid Option types can be represented as arrays [value] or []
          const val = listing.project_canister[0];
          projectCanisterStr = typeof val === 'string' ? val : val?.toText?.();
        } else if (listing.project_canister.toText) {
          projectCanisterStr = listing.project_canister.toText();
        }
      }

      // Handle token_canister
      if (listing.token_canister) {
        if (typeof listing.token_canister === 'string') {
          tokenCanisterStr = listing.token_canister;
        } else if (Array.isArray(listing.token_canister) && listing.token_canister.length > 0) {
          const val = listing.token_canister[0];
          tokenCanisterStr = typeof val === 'string' ? val : val?.toText?.();
        } else if (listing.token_canister.toText) {
          tokenCanisterStr = listing.token_canister.toText();
        }
      }

      // Handle creator
      if (typeof listing.creator === 'string') {
        creatorStr = listing.creator;
      } else if (listing.creator?.toText) {
        creatorStr = listing.creator.toText();
      } else {
        creatorStr = 'unknown';
      }

      console.log('[CreateProject] Project registered:', {
        id: listing.id.toString(),
        creator: creatorStr,
        project_canister: projectCanisterStr,
        token_canister: tokenCanisterStr,
      });

      setDeployInfo({
        id: listing.id.toString(),
        projectCanister: projectCanisterStr,
        tokenCanister: tokenCanisterStr,
      });

      toast.success('Project registered successfully!');
      
      if (!projectCanisterStr) {
        toast.info('Project and token canisters will be assigned by the system.');
      }

    } catch (e: any) {
      console.error('[CreateProject] Error:', e);
      const message = e?.message || 'Failed to register project';
      toast.error(message);
    } finally {
      setIsPublishing(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold mb-1">Create New Project</h1>
              <p className="text-muted-foreground">Build and fund your next big idea</p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant={connected ? 'secondary' : 'default'}
                size="sm"
                className="gap-2"
                onClick={connectWallet}
              >
                <Wallet className="w-4 h-4" />
                {connected && account 
                  ? `${account.slice(0, 8)}...${account.slice(-6)}` 
                  : 'Connect Wallet'}
              </Button>
              <Button variant="outline" onClick={() => window.history.back()}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Stepper */}
        <div className="mb-8">
          <div className="flex items-center justify-between relative">
            {/* Progress line */}
            <div className="absolute top-5 left-0 right-0 h-0.5 bg-border -z-10">
              <div 
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${(currentStep / (steps.length - 1)) * 100}%` }}
              />
            </div>

            {steps.map((step, index) => (
              <div key={step.id} className="flex flex-col items-center">
                <button
                  onClick={() => setCurrentStep(index)}
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-colors mb-2 ${
                    index === currentStep
                      ? 'bg-primary text-primary-foreground ring-4 ring-primary/20'
                      : index < currentStep
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {index < currentStep ? <Check className="w-5 h-5" /> : index + 1}
                </button>
                <div className="text-center hidden md:block">
                  <p className="text-sm font-medium">{step.title}</p>
                  <p className="text-xs text-muted-foreground">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Step content */}
        <Card>
          <CardHeader>
            <CardTitle>{steps[currentStep].title}</CardTitle>
            <CardDescription>{steps[currentStep].description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Step 0: Basics */}
            {currentStep === 0 && (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="name">Project Name</Label>
                  <Input 
                    id="name" 
                    placeholder="Enter your project name" 
                    value={name} 
                    onChange={(e) => setName(e.target.value)} 
                  />
                </div>
                <div>
                  <Label htmlFor="description">Short Description</Label>
                  <Textarea 
                    id="description" 
                    placeholder="Describe your project in a few sentences"
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="logo">Logo URL</Label>
                    <Input 
                      id="logo" 
                      placeholder="https://..." 
                      value={logoUrl}
                      onChange={(e) => setLogoUrl(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="banner">Banner URL</Label>
                    <Input 
                      id="banner" 
                      placeholder="https://..." 
                      value={bannerUrl}
                      onChange={(e) => setBannerUrl(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Step 1: Funding */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="tokenSelect">Investment Token</Label>
                  <Select 
                    value={selectedToken} 
                    onValueChange={(v) => setSelectedToken(v as 'ckUSDC' | 'ckUSDT')}
                  >
                    <SelectTrigger id="tokenSelect">
                      <SelectValue placeholder="Select token" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ckUSDC">ckUSDC</SelectItem>
                      <SelectItem value="ckUSDT">ckUSDT</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-sm text-muted-foreground mt-1">
                    Choose the stablecoin investors will use to fund this project
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="minRaise">Minimum Raise ({selectedToken})</Label>
                    <Input 
                      id="minRaise" 
                      type="number" 
                      placeholder="1000000" 
                      value={minRaise} 
                      onChange={(e) => setMinRaise(e.target.value)} 
                    />
                  </div>
                  <div>
                    <Label htmlFor="maxRaise">Maximum Raise ({selectedToken})</Label>
                    <Input 
                      id="maxRaise" 
                      type="number" 
                      placeholder="5000000" 
                      value={maxRaise} 
                      onChange={(e) => setMaxRaise(e.target.value)} 
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="fundingDuration">Funding Duration (days)</Label>
                    <Input 
                      id="fundingDuration" 
                      type="number" 
                      placeholder="30" 
                      value={fundingDurationDays} 
                      onChange={(e) => setFundingDurationDays(e.target.value)} 
                    />
                    <p className="text-sm text-muted-foreground mt-1">
                      Only the duration for the initial funding stage is required.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: Phases */}
            {currentStep === 2 && (
              <div className="space-y-6">
                <div className="p-3 rounded-md bg-muted text-sm text-muted-foreground">
                  There are 6 fixed phases (1–6). Final phase payout is fixed; others are editable.
                </div>
                {milestones.map((milestone, index) => (
                  <Card key={milestone.id} className="border-2">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">Phase {index + 1}: {milestone.title}</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">{milestone.summary}</p>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor={`milestone-payout-${index}`}>Payout (% of Max Raise)</Label>
                          <Input 
                            id={`milestone-payout-${index}`}
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={100}
                            step={0.1}
                            placeholder="e.g., 15"
                            value={milestone.payout}
                            disabled={index === milestones.length - 1}
                            onChange={(e) => {
                              const v = e.target.value;
                              setMilestones(prev => prev.map((m, i) => (i === index ? { ...m, payout: v } : m)));
                            }}
                          />
                          {index === milestones.length - 1 && (
                            <p className="text-xs text-muted-foreground mt-1">Final phase payout is fixed.</p>
                          )}
                        </div>
                        <div>
                          <Label htmlFor={`milestone-apr-${index}`}>APR (%)</Label>
                          <Input
                            id={`milestone-apr-${index}`}
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={100}
                            step={0.1}
                            placeholder="e.g., 8"
                            value={milestone.apr}
                            onChange={(e) => {
                              const v = e.target.value;
                              setMilestones(prev => prev.map((m, i) => (i === index ? { ...m, apr: v } : m)));
                            }}
                          />
                        </div>
                        <div>
                          <Label htmlFor={`milestone-date-${index}`}>Due Date</Label>
                          <Input 
                            id={`milestone-date-${index}`}
                            type="date"
                            value={milestone.dueDate}
                            onChange={(e) => {
                              const v = e.target.value;
                              setMilestones(prev => prev.map((m, i) => (i === index ? { ...m, dueDate: v } : m)));
                            }}
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Step 3: Links */}
            {currentStep === 3 && (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="website">Website</Label>
                  <Input 
                    id="website" 
                    placeholder="https://your-project.com" 
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="github">GitHub</Label>
                  <Input 
                    id="github" 
                    placeholder="https://github.com/username/repo" 
                    value={github}
                    onChange={(e) => setGithub(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="twitter">X (Twitter)</Label>
                  <Input 
                    id="twitter" 
                    placeholder="https://x.com/username" 
                    value={twitter}
                    onChange={(e) => setTwitter(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="discord">Discord</Label>
                  <Input 
                    id="discord" 
                    placeholder="https://discord.gg/invite" 
                    value={discord}
                    onChange={(e) => setDiscord(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Step 4: Preview */}
            {currentStep === 4 && (
              <div className="space-y-6">
                <div className="p-6 bg-muted rounded-lg">
                  <h3 className="font-semibold text-lg mb-4">Project Summary</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Project Name:</span>
                      <span className="font-semibold">{name || 'Not set'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Token:</span>
                      <span className="font-semibold">{selectedToken}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Min/Max Raise:</span>
                      <span className="font-semibold">{minRaise || '0'} / {maxRaise || '0'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Phases:</span>
                      <span className="font-semibold">{milestones.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Funding Duration:</span>
                      <span className="font-semibold">{fundingDurationDays} days</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-900 rounded-lg">
                  <h4 className="font-semibold text-yellow-800 dark:text-yellow-200 mb-2">Before Publishing</h4>
                  <ul className="text-sm space-y-1 text-yellow-800 dark:text-yellow-200">
                    <li>• Ensure all phase details are accurate</li>
                    <li>• Make sure funding min/max and duration are correct</li>
                    <li>• Verify your wallet is connected</li>
                    <li>• Double-check token selection ({selectedToken})</li>
                  </ul>
                </div>

                <div className="flex gap-3">
                  <Button 
                    className="flex-1" 
                    onClick={handlePublish} 
                    disabled={isPublishing || !connected}
                  >
                    {isPublishing ? 'Registering...' : 'Register Project'}
                  </Button>
                </div>

                {deployInfo && (
                  <div className="p-4 mt-4 rounded border bg-muted/50">
                    <div className="text-sm font-medium mb-2">Project Registered!</div>
                    <div className="text-xs space-y-1">
                      <div>Registry ID: <span className="font-mono">{deployInfo.id}</span></div>
                      {deployInfo.projectCanister && (
                        <div>Project Canister: <span className="font-mono">{deployInfo.projectCanister}</span></div>
                      )}
                      {deployInfo.tokenCanister && (
                        <div>Token Canister: <span className="font-mono">{deployInfo.tokenCanister}</span></div>
                      )}
                      {!deployInfo.projectCanister && (
                        <div className="text-muted-foreground mt-2">
                          Canisters will be assigned by the system administrator.
                        </div>
                      )}
                    </div>
                    <div className="mt-3">
                      <Button asChild size="sm">
                        <a href="/projects">View All Projects</a>
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Navigation */}
        <div className="flex justify-between mt-6">
          <Button
            variant="outline"
            onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
            disabled={currentStep === 0}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          
          <div className="flex gap-2">
            <Button
              onClick={() => setCurrentStep(Math.min(steps.length - 1, currentStep + 1))}
              disabled={currentStep === steps.length - 1}
            >
              Continue
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateProject;