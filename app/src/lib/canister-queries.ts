import { createProjectActor, createRegistryActor } from './icp';
import { ProjectState, ProjectListing, DocRecord, AppraisalRecord } from './icp';
import { Principal } from '@dfinity/principal';

// ============================================================================
// Type Definitions (for UI consumption)
// ============================================================================

export type ProjectMetrics = {
  id: string;
  canisterId: string;
  creator: string;
  createdAt: bigint;
  currentPhase: number;
  totalRaised: bigint;
  totalDevWithdrawn: bigint;
  reserveBalance: bigint;
  poolBalance: bigint;
  principalBuffer: bigint;
  fundraiseClosed: boolean;
  fundraiseSuccessful: boolean;
  phases: PhaseInfo[];
  appraisals: AppraisalRecord[];
  phaseDocuments: DocRecord[][];
};

export type PhaseInfo = {
  phaseId: number;
  aprBps: number;
  duration: bigint;
  capBps: number;
  withdrawn: bigint;
};

export type UserMetrics = {
  user: string;
  balance: bigint;
  claimableInterest: bigint;
  claimableRevenue: bigint;
  interestWithdrawn: bigint;
  revenueWithdrawn: bigint;
};

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get complete project data from canister state
 */
export async function getCompleteProjectData(
  canisterId: string,
  userPrincipal?: Principal
): Promise<{
  project: ProjectMetrics | null;
  userMetrics: UserMetrics | null;
}> {
  try {
    const actor = await createProjectActor(canisterId);
    const state = await actor.get_state() as ProjectState;

    // Build phase info
    const phases: PhaseInfo[] = [];
    for (let i = 0; i < 6; i++) {
      phases.push({
        phaseId: i,
        aprBps: state.params.phase_aprs_bps[i],
        duration: state.params.phase_durations[i],
        capBps: state.params.phase_withdraw_caps_bps[i],
        withdrawn: state.phase_withdrawn[i],
      });
    }

    const project: ProjectMetrics = {
      id: canisterId,
      canisterId,
      creator: state.owner.toText(),
      createdAt: 0n, // Not stored in project state, would need registry
      currentPhase: state.current_phase,
      totalRaised: state.total_raised,
      totalDevWithdrawn: state.total_dev_withdrawn,
      reserveBalance: state.reserve_balance,
      poolBalance: state.pool_balance,
      principalBuffer: state.principal_buffer,
      fundraiseClosed: state.fundraise_closed,
      fundraiseSuccessful: state.fundraise_successful,
      phases,
      appraisals: state.appraisals,
      phaseDocuments: state.phase_docs,
    };

    let userMetrics: UserMetrics | null = null;
    if (userPrincipal) {
      const claimableInterest = await actor.claimable_interest(userPrincipal) as bigint;
      const claimableRevenue = await actor.claimable_revenue(userPrincipal) as bigint;
      const accountState = state.accounts.get(userPrincipal.toText());

      if (accountState) {
        userMetrics = {
          user: userPrincipal.toText(),
          balance: accountState.balance,
          claimableInterest,
          claimableRevenue,
          interestWithdrawn: accountState.interest_withdrawn,
          revenueWithdrawn: accountState.revenue_withdrawn,
        };
      }
    }

    return { project, userMetrics };
  } catch (error) {
    console.error('Error fetching project data from canister:', error);
    return { project: null, userMetrics: null };
  }
}

/**
 * Get all projects from registry
 */
export async function getAllProjects(): Promise<{ projects: ProjectListing[] }> {
  try {
    const actor = await createRegistryActor();
    const listings = await actor.list_projects() as ProjectListing[];
    return { projects: listings };
  } catch (error) {
    console.error('Error fetching projects from registry:', error);
    return { projects: [] };
  }
}

/**
 * Get project with metadata from registry
 */
export async function getProjectListing(id: bigint): Promise<ProjectListing | null> {
  try {
    const actor = await createRegistryActor();
    const result = await actor.get_project(id);
    return result.length > 0 ? result[0] : null;
  } catch (error) {
    console.error('Error fetching project listing:', error);
    return null;
  }
}

/**
 * Count unique depositors (supporters) for a project
 * Note: This is derived from accounts map in project state
 */
export async function getProjectSupportersCount(canisterId: string): Promise<number> {
  try {
    const actor = await createProjectActor(canisterId);
    const state = await actor.get_state() as ProjectState;
    
    // Filter accounts with non-zero balance (active supporters)
    let count = 0;
    for (const [_, accountState] of state.accounts) {
      if (accountState.balance > 0n) {
        count++;
      }
    }
    return count;
  } catch (error) {
    console.error('Error fetching supporters count:', error);
    return 0;
  }
}