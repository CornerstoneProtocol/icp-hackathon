import { useNavigate } from 'react-router-dom';
import { Users, TrendingUp, CheckCircle, Clock } from 'lucide-react';
import { ProjectListing } from '@/lib/icp';
import { Principal } from '@dfinity/principal';

// Extended type to include optional project state
type ProjectWithState = ProjectListing & {
  projectState?: {
    fundraiseClosed: boolean;
    fundraiseSuccessful: boolean;
    totalRaised: bigint;
    currentPhase: number;
  };
};

interface MinecraftProjectCardProps {
  project: ProjectWithState;
  supportersCount?: number;
}

// Helper to extract Principal from optional array format
const extractPrincipal = (optional: Principal | string | null | [Principal] | []): Principal | null => {
  if (!optional) return null;
  if (Array.isArray(optional)) {
    return optional.length > 0 ? optional[0] : null;
  }
  if (typeof optional === 'string') {
    try {
      return Principal.fromText(optional);
    } catch {
      return null;
    }
  }
  return optional;
};

export const MinecraftProjectCard = ({ project, supportersCount = 0 }: MinecraftProjectCardProps) => {
  const navigate = useNavigate();

  // Extract canister ID
  const projectCanister = extractPrincipal(project.project_canister);
  const canisterId = projectCanister?.toText() || project.id.toString();
  
  // Extract creator
  const creatorPrincipal = extractPrincipal(project.creator);
  const creator = creatorPrincipal?.toText() || 'Unknown';

  // Format raised amount (convert from e6 to readable format - USDC uses 6 decimals)
  const formatAmount = (amount: bigint) => {
    return (Number(amount) / 1e6).toFixed(2);
  };

  // Get project state or use defaults
  const fundraiseClosed = project.projectState?.fundraiseClosed ?? false;
  const fundraiseSuccessful = project.projectState?.fundraiseSuccessful ?? false;
  const totalRaised = project.projectState?.totalRaised ?? 0n;
  const currentPhase = project.projectState?.currentPhase ?? 0;

  // Calculate progress percentage
  const calculateProgress = () => {
    if (!project.projectState) {
      // If no state yet, show as just starting
      const raised = Number(totalRaised);
      const maxRaise = Number(project.params.max_raise);
      if (maxRaise === 0) return 0;
      return Math.min((raised / maxRaise) * 100, 100);
    }
    
    const raised = Number(totalRaised);
    const maxRaise = Number(project.params.max_raise);
    if (maxRaise === 0) return 0;
    return Math.min((raised / maxRaise) * 100, 100);
  };

  const progress = calculateProgress();

  return (
    <div
      onClick={() => navigate(`/projects/${canisterId}`)}
      className="group cursor-pointer transform transition-all duration-200 hover:scale-105 hover:translate-y-[-4px] w-full"
    >
      {/* Minecraft-style pixelated card */}
      <div className="relative bg-gradient-to-b from-[#8B4513] to-[#654321] p-1 w-full">
        {/* Outer pixelated border */}
        <div className="absolute inset-0 pointer-events-none">
          {/* Top-left corner pixels */}
          <div className="absolute top-0 left-0 w-2 h-2 bg-[#654321]"></div>
          <div className="absolute top-0 right-0 w-2 h-2 bg-[#654321]"></div>
          <div className="absolute bottom-0 left-0 w-2 h-2 bg-[#654321]"></div>
          <div className="absolute bottom-0 right-0 w-2 h-2 bg-[#654321]"></div>
        </div>

        {/* Card content */}
        <div className="relative bg-gradient-to-b from-[#D2B48C] via-[#C4A07A] to-[#B8956A] p-4 sm:p-6 border-4 border-[#654321] min-h-[300px] flex flex-col">
          {/* Status badge */}
          <div className="absolute top-4 right-4 z-10">
            {fundraiseClosed ? (
              fundraiseSuccessful ? (
                <div className="flex items-center gap-1 bg-[#55AA55] border-2 border-[#2D572D] px-3 py-1 text-white font-bold text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,0.3)]">
                  <CheckCircle className="w-3 h-3" />
                  ACTIVE
                </div>
              ) : (
                <div className="flex items-center gap-1 bg-[#AA5555] border-2 border-[#572D2D] px-3 py-1 text-white font-bold text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,0.3)]">
                  CLOSED
                </div>
              )
            ) : (
              <div className="flex items-center gap-1 bg-[#FFAA00] border-2 border-[#AA7700] px-3 py-1 text-white font-bold text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,0.3)]">
                <Clock className="w-3 h-3" />
                FUNDING
              </div>
            )}
          </div>

          {/* Project Icon/Avatar - Minecraft block style */}
          <div className="mb-4">
            <div className="w-20 h-20 bg-gradient-to-br from-[#55AA55] via-[#449944] to-[#338833] border-4 border-[#2D572D] shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)] flex items-center justify-center">
              <div className="text-2xl font-bold text-white">
                {project.params.token_symbol.slice(0, 2).toUpperCase()}
              </div>
            </div>
          </div>

          {/* Project Title */}
          <h3 className="text-lg sm:text-xl font-bold text-[#2D1B00] mb-2 truncate group-hover:text-[#FF6B35] transition-colors">
            {project.params.token_name}
          </h3>

          {/* Creator Address */}
          <p className="text-xs sm:text-sm text-[#5D4E37] mb-4 font-mono truncate">
            by {creator.slice(0, 6)}...{creator.slice(-4)}
          </p>

          {/* Stats Grid - Minecraft style */}
          <div className="grid grid-cols-2 gap-2 sm:gap-3 mb-4 flex-1">
            {/* Total Raised */}
            <div className="bg-[#8B7355] border-2 border-[#654321] p-2 sm:p-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.2)]">
              <div className="flex items-center gap-1 sm:gap-2 mb-1">
                <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4 text-[#FFD700]" />
                <span className="text-xs font-bold text-[#FFD700]">RAISED</span>
              </div>
              <p className="text-sm sm:text-lg font-bold text-white truncate">
                ${formatAmount(totalRaised)}
              </p>
            </div>

            {/* Supporters */}
            <div className="bg-[#8B7355] border-2 border-[#654321] p-2 sm:p-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.2)]">
              <div className="flex items-center gap-1 sm:gap-2 mb-1">
                <Users className="w-3 h-3 sm:w-4 sm:h-4 text-[#55AAFF]" />
                <span className="text-xs font-bold text-[#55AAFF]">BACKERS</span>
              </div>
              <p className="text-sm sm:text-lg font-bold text-white">{supportersCount}</p>
            </div>
          </div>

          {/* Progress Bar - Minecraft style */}
          <div className="space-y-2 mt-auto">
            <div className="flex justify-between items-center text-xs font-bold text-[#2D1B00]">
              <span>Phase {currentPhase + 1}/6</span>
              <span>{progress.toFixed(0)}%</span>
            </div>
            <div className="h-4 sm:h-6 bg-[#654321] border-2 border-[#3D2817] overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#55AA55] to-[#77CC77] transition-all duration-500 relative"
                style={{ width: `${progress}%` }}
              >
                {/* Pixelated shine effect */}
                <div className="absolute inset-0 bg-gradient-to-t from-transparent via-white/20 to-transparent"></div>
              </div>
            </div>
          </div>

          {/* Hover effect overlay */}
          <div className="absolute inset-0 border-4 border-[#FFD700] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
        </div>

        {/* Shadow effect */}
        <div className="absolute inset-0 translate-y-1 -z-10 bg-[#3D2817]"></div>
      </div>
    </div>
  );
};