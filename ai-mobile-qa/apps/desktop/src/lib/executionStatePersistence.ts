/**
 * Execution State Persistence
 * 
 * Provides functions to save, load, and delete scenario execution state.
 * Enables resuming interrupted test runs after crashes or restarts.
 * 
 * State files are stored in ~/.tezzy/state/{run_id}.json
 * 
 * Implements requirements 30.1, 30.2, 30.5 from the requirements document.
 */

import { invoke } from "@tauri-apps/api/tauri";
import type { ScenarioExecutionState, GoalProgress } from "../types/scenario";

/**
 * Save execution state to disk
 * 
 * Persists the current execution state to ~/.tezzy/state/{run_id}.json
 * This allows resuming execution after crashes or restarts.
 * 
 * @param runId - Unique identifier for the execution run
 * @param state - The execution state to save
 * @throws Error if save operation fails
 */
export async function saveExecutionState(
  runId: string,
  state: ScenarioExecutionState
): Promise<void> {
  try {
    // Convert Map and Set objects to serializable formats
    const serializableState = {
      ...state,
      goal_progress: Array.from(state.goal_progress.entries()).map(([goalId, progress]) => ({
        goalId,
        progress,
      })),
      seen_element_keys: Array.from(state.seen_element_keys),
      seen_hash_counts: Array.from(state.seen_hash_counts.entries()),
      completed_screens: Array.from(state.completed_screens),
    };

    await invoke("save_execution_state", { runId, state: serializableState });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to save execution state ${runId}:`, errorMessage);
    throw new Error(`Failed to save execution state: ${errorMessage}`);
  }
}

/**
 * Load execution state from disk
 * 
 * Reads the execution state from ~/.tezzy/state/{run_id}.json
 * Returns null if the state file doesn't exist (not an error).
 * 
 * @param runId - Unique identifier for the execution run
 * @returns The loaded execution state, or null if not found
 * @throws Error if load operation fails (other than not found)
 */
export async function loadExecutionState(
  runId: string
): Promise<ScenarioExecutionState | null> {
  try {
    const result = await invoke<any>("load_execution_state", { runId });

    if (result === null || result === undefined) {
      return null;
    }

    // Convert serialized arrays back to Map and Set objects
    const state: ScenarioExecutionState = {
      ...result,
      goal_progress: new Map(
        result.goal_progress.map((item: { goalId: string; progress: GoalProgress }) => [
          item.goalId,
          item.progress,
        ])
      ),
      seen_element_keys: new Set(result.seen_element_keys),
      seen_hash_counts: new Map(result.seen_hash_counts),
      completed_screens: new Set(result.completed_screens),
    };

    return state;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to load execution state ${runId}:`, errorMessage);
    throw new Error(`Failed to load execution state: ${errorMessage}`);
  }
}

/**
 * Delete execution state from disk
 * 
 * Removes the execution state file from ~/.tezzy/state/{run_id}.json
 * This should be called when a run completes successfully.
 * 
 * @param runId - Unique identifier for the execution run
 * @throws Error if delete operation fails
 */
export async function deleteExecutionState(runId: string): Promise<void> {
  try {
    await invoke("delete_execution_state", { runId });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to delete execution state ${runId}:`, errorMessage);
    throw new Error(`Failed to delete execution state: ${errorMessage}`);
  }
}

/**
 * Check if execution state exists for a run
 * 
 * @param runId - Unique identifier for the execution run
 * @returns true if state file exists, false otherwise
 */
export async function executionStateExists(runId: string): Promise<boolean> {
  try {
    const state = await loadExecutionState(runId);
    return state !== null;
  } catch {
    return false;
  }
}

/**
 * List all incomplete execution runs
 * 
 * Returns an array of run IDs that have state files in ~/.tezzy/state/
 * These represent runs that were interrupted and can potentially be resumed.
 * 
 * @returns Array of run IDs with incomplete executions
 * @throws Error if list operation fails
 */
export async function listIncompleteRuns(): Promise<string[]> {
  try {
    const runIds = await invoke<string[]>("list_incomplete_runs");
    return runIds;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Failed to list incomplete runs:", errorMessage);
    throw new Error(`Failed to list incomplete runs: ${errorMessage}`);
  }
}

/**
 * Get metadata about an incomplete run without loading full state
 * 
 * Loads the execution state and extracts key metadata.
 * Useful for displaying a list of resumable runs to the user.
 * 
 * @param runId - Unique identifier for the execution run
 * @returns Metadata object with run details
 */
export async function getIncompleteRunMetadata(runId: string): Promise<{
  run_id: string;
  scenario_name: string;
  scenario_id: string;
  current_goal_index: number;
  total_goals: number;
  goals_completed: number;
  goals_failed: number;
  started_at: number;
  elapsed_seconds: number;
} | null> {
  try {
    const state = await loadExecutionState(runId);
    
    if (!state) {
      return null;
    }

    const elapsedSeconds = state.completed_at
      ? Math.floor((state.completed_at - state.started_at) / 1000)
      : Math.floor((Date.now() - state.started_at) / 1000);

    return {
      run_id: state.run_id,
      scenario_name: state.scenario.name,
      scenario_id: state.scenario.id,
      current_goal_index: state.current_goal_index,
      total_goals: state.scenario.goals.length,
      goals_completed: state.goals_completed,
      goals_failed: state.goals_failed,
      started_at: state.started_at,
      elapsed_seconds: elapsedSeconds,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to get metadata for run ${runId}:`, errorMessage);
    return null;
  }
}

/**
 * Clean up old execution state files
 * 
 * Deletes execution state files older than the specified age.
 * Useful for cleaning up abandoned runs that will never be resumed.
 * 
 * @param maxAgeSeconds - Maximum age in seconds (default: 7 days)
 * @returns Number of state files deleted
 */
export async function cleanupOldExecutionStates(
  maxAgeSeconds: number = 7 * 24 * 60 * 60
): Promise<number> {
  try {
    const runIds = await listIncompleteRuns();
    const now = Date.now();
    let deletedCount = 0;

    for (const runId of runIds) {
      try {
        const state = await loadExecutionState(runId);
        
        if (!state) {
          continue;
        }

        const ageSeconds = Math.floor((now - state.started_at) / 1000);
        
        if (ageSeconds > maxAgeSeconds) {
          await deleteExecutionState(runId);
          deletedCount++;
          console.log(`Deleted old execution state: ${runId} (age: ${ageSeconds}s)`);
        }
      } catch (error) {
        console.error(`Failed to process run ${runId}:`, error);
        // Continue with next run
      }
    }

    return deletedCount;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Failed to cleanup old execution states:", errorMessage);
    throw new Error(`Failed to cleanup old execution states: ${errorMessage}`);
  }
}

/**
 * Create a checkpoint of execution state
 * 
 * Saves the current execution state with a timestamp.
 * Useful for debugging or creating restore points during long runs.
 * 
 * @param runId - Unique identifier for the execution run
 * @param state - The execution state to checkpoint
 * @param checkpointLabel - Optional label for the checkpoint
 */
export async function createExecutionCheckpoint(
  runId: string,
  state: ScenarioExecutionState,
  checkpointLabel?: string
): Promise<void> {
  const timestamp = Date.now();
  const checkpointId = checkpointLabel
    ? `${runId}_checkpoint_${checkpointLabel}_${timestamp}`
    : `${runId}_checkpoint_${timestamp}`;

  await saveExecutionState(checkpointId, state);
  console.log(`Created execution checkpoint: ${checkpointId}`);
}

/**
 * Validate execution state integrity
 * 
 * Checks if the execution state is valid and consistent.
 * Useful for detecting corrupted state files.
 * 
 * @param state - The execution state to validate
 * @returns Validation result with errors if any
 */
export function validateExecutionState(state: ScenarioExecutionState): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check required fields
  if (!state.run_id) {
    errors.push("Missing run_id");
  }
  if (!state.scenario) {
    errors.push("Missing scenario");
  }
  if (state.current_goal_index < 0) {
    errors.push("Invalid current_goal_index (negative)");
  }
  if (state.scenario && state.current_goal_index >= state.scenario.goals.length) {
    errors.push("current_goal_index exceeds number of goals");
  }
  if (!state.goal_progress) {
    errors.push("Missing goal_progress");
  }
  if (!state.started_at || state.started_at <= 0) {
    errors.push("Invalid started_at timestamp");
  }

  // Check data structure types
  if (!(state.goal_progress instanceof Map)) {
    errors.push("goal_progress must be a Map");
  }
  if (!(state.seen_element_keys instanceof Set)) {
    errors.push("seen_element_keys must be a Set");
  }
  if (!(state.seen_hash_counts instanceof Map)) {
    errors.push("seen_hash_counts must be a Map");
  }
  if (!(state.completed_screens instanceof Set)) {
    errors.push("completed_screens must be a Set");
  }
  if (!Array.isArray(state.recent_actions)) {
    errors.push("recent_actions must be an array");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Export execution state to JSON string
 * 
 * Useful for debugging or manual inspection of state.
 * 
 * @param state - The execution state to export
 * @returns JSON string representation
 */
export function exportExecutionStateToJson(state: ScenarioExecutionState): string {
  const serializableState = {
    ...state,
    goal_progress: Array.from(state.goal_progress.entries()).map(([goalId, progress]) => ({
      goalId,
      progress,
    })),
    seen_element_keys: Array.from(state.seen_element_keys),
    seen_hash_counts: Array.from(state.seen_hash_counts.entries()),
    completed_screens: Array.from(state.completed_screens),
  };

  return JSON.stringify(serializableState, null, 2);
}

/**
 * Import execution state from JSON string
 * 
 * Parses a JSON string and reconstructs the execution state.
 * 
 * @param jsonString - JSON string representation of execution state
 * @returns The reconstructed execution state
 * @throws Error if JSON is invalid
 */
export function importExecutionStateFromJson(jsonString: string): ScenarioExecutionState {
  try {
    const parsed = JSON.parse(jsonString);

    const state: ScenarioExecutionState = {
      ...parsed,
      goal_progress: new Map(
        parsed.goal_progress.map((item: { goalId: string; progress: GoalProgress }) => [
          item.goalId,
          item.progress,
        ])
      ),
      seen_element_keys: new Set(parsed.seen_element_keys),
      seen_hash_counts: new Map(parsed.seen_hash_counts),
      completed_screens: new Set(parsed.completed_screens),
    };

    return state;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to import execution state from JSON: ${errorMessage}`);
  }
}
