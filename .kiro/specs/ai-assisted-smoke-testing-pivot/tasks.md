# Implementation Plan: AI-Assisted Smoke Testing Pivot - Phase 1 (Foundation)

## Overview

Phase 1 establishes the foundation for scenario-based testing by implementing the scenario definition system, validation logic, enhanced state management, goal progress tracking, and scenario storage. This phase focuses on TypeScript/Python infrastructure without UI components or multi-agent integration.

**Key Goals:**
- Define TypeScript interfaces and JSON schema for scenarios
- Implement scenario validation logic
- Fix critical state management issues (seen_element_keys, loop_count, no_element_count, completed_screens)
- Add goal progress tracking infrastructure
- Implement scenario storage (save/load from disk)

**Language:** TypeScript (Desktop), Python (AI Engine)

---

## Tasks

- [x] 1. Create scenario type definitions and interfaces
  - Create `ai-mobile-qa/apps/desktop/src/types/scenario.ts` with TypeScript interfaces
  - Define `SmokeScenario`, `ScenarioGoal`, `GoalType`, `GoalProgress`, `ScenarioExecutionState` interfaces
  - Define `ActionRecord` interface for action logging
  - Export all types for use across the desktop app
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 2. Implement scenario validation logic
  - [x] 2.1 Create scenario validator module
    - Create `ai-mobile-qa/apps/desktop/src/lib/scenarioValidator.ts`
    - Implement `validateScenario(scenario: SmokeScenario): ValidationResult` function
    - Check required fields (id, name, description, app_name, goals)
    - Validate goal IDs are unique within scenario
    - Validate success_criteria arrays are non-empty
    - Return specific error messages for each validation failure
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x]* 2.2 Write unit tests for scenario validator
    - Test validation of required fields
    - Test duplicate goal ID detection
    - Test empty success_criteria detection
    - Test login goal without credentials
    - Test form_fill goal without form_data
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 2.3 Add credential validation for login goals
    - Check if goal type is "login" and credentials are missing
    - Return validation error with message "Login goal requires credentials"
    - _Requirements: 2.2_

  - [x] 2.4 Add form_data validation for form_fill goals
    - Check if goal type is "form_fill" and form_data is missing
    - Return validation error with message "Form fill goal requires form_data"
    - _Requirements: 2.3_

- [x] 3. Fix state management in SmokeCheckPanel
  - [x] 3.1 Add seen_element_keys tracking
    - In `SmokeCheckPanel.tsx`, add `const seenElementKeys = useRef<string[]>([])` state
    - After each successful tap action, extract tapped element from `snap.ui_elements`
    - Generate unique key: `${element.resource_id}::${element.bounds}`
    - Add key to `seenElementKeys.current` array
    - Pass `seen_element_keys: seenElementKeys.current` in `aiRunStep` calls
    - _Requirements: 3.1, 3.9_

  - [x] 3.2 Add loop_count tracking
    - Add `const loopCount = useRef<number>(0)` state
    - After each UI snapshot, check if `seenHashCounts[currentHash] > 1`
    - If yes, increment `loopCount.current`
    - If screen hash changes (new hash), reset `loopCount.current = 0`
    - Pass `loop_count: loopCount.current` in `aiRunStep` calls
    - _Requirements: 3.3, 3.4_

  - [x] 3.3 Fix no_element_count accumulation
    - Add `const noElementCount = useRef<number>(0)` state
    - After each UI snapshot, check if `snap.ui_elements.length === 0`
    - If yes, increment `noElementCount.current`
    - If `snap.ui_elements.length > 0`, reset `noElementCount.current = 0`
    - Pass `no_element_count: noElementCount.current` in `aiRunStep` calls
    - _Requirements: 3.5, 3.6_

  - [x] 3.4 Add completed_screens tracking
    - Add `const completedScreens = useRef<Set<string>>(new Set())` state
    - After each action, check if all interactive elements on current screen have been tapped
    - Compare `snap.ui_elements.filter(el => el.clickable === 'true')` against `seenElementKeys`
    - If all clickable elements have been tapped, add screen hash to `completedScreens.current`
    - Pass `completed_screens: Array.from(completedScreens.current)` in memory snapshot
    - _Requirements: 3.7_

  - [x] 3.5 Add recent_actions tracking with proper structure
    - Add `const recentActions = useRef<ActionRecord[]>([])` state
    - After each action execution, create `ActionRecord` object with step, action, screen_hash, result
    - Append to `recentActions.current` and keep only last 10 actions
    - Pass `recent_actions: recentActions.current.slice(-10)` in `aiRunStep` calls
    - _Requirements: 3.8_

  - [x] 3.6 Fix failure_streak tracking
    - Ensure `failureStreak` increments on action execution failure (Appium errors)
    - Ensure `failureStreak` resets to 0 on successful action execution
    - Pass `failure_streak: failureStreak` in `aiRunStep` calls
    - _Requirements: 3.9, 3.10_

- [x] 4. Checkpoint - Verify state management fixes
  - Run smoke check and verify `seen_element_keys` is populated in logs
  - Verify `loop_count` increments when revisiting screens
  - Verify `no_element_count` accumulates across empty screens
  - Verify `completed_screens` tracks fully explored screens
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement goal progress tracking infrastructure
  - [x] 5.1 Create goal progress tracker module
    - Create `ai-mobile-qa/apps/desktop/src/lib/goalProgressTracker.ts`
    - Implement `initializeGoalProgress(goals: ScenarioGoal[]): Map<string, GoalProgress>` function
    - Implement `updateGoalProgress(goalId: string, update: Partial<GoalProgress>): void` function
    - Implement `evaluateSuccessCriteria(goal: ScenarioGoal, screenState: any): string[]` function
    - Track steps_taken, success_criteria_met, success_criteria_pending per goal
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 5.2 Add goal status management
    - Implement `markGoalComplete(goalId: string): void` function
    - Implement `markGoalFailed(goalId: string, reason: string): void` function
    - Update goal status based on criteria evaluation
    - Set status to "completed" when all criteria met
    - Set status to "failed" when max_steps exceeded or critical error
    - _Requirements: 4.5, 4.6, 4.7_

  - [x] 5.3 Add findings and screenshots tracking per goal
    - Add `addFinding(goalId: string, finding: SmokeFinding): void` function
    - Add `addScreenshot(goalId: string, screenshotPath: string): void` function
    - Store findings array per goal in `GoalProgress`
    - Store screenshots array per goal in `GoalProgress`
    - _Requirements: 4.8, 4.9_

  - [x] 5.4 Add action logging per goal
    - Implement `logAction(goalId: string, action: ActionRecord): void` function
    - Store action in goal's `actions_log` array
    - Include step number, action details, screen hash, result, contributed_to_goal flag
    - _Requirements: 4.10_

- [x] 6. Implement scenario storage system
  - [x] 6.1 Create Tauri commands for scenario file operations
    - Add `save_scenario` command in `ai-mobile-qa/apps/desktop/src-tauri/src/commands/scenarios.rs`
    - Add `load_scenario` command to read scenario from disk
    - Add `list_scenarios` command to list all scenarios in directory
    - Add `delete_scenario` command to remove scenario file
    - Store scenarios in `~/.tezzy/scenarios/{scenario_id}.json`
    - _Requirements: 23.1, 23.2, 23.3_

  - [x] 6.2 Create TypeScript wrapper for scenario storage
    - Create `ai-mobile-qa/apps/desktop/src/lib/scenarioStorage.ts`
    - Implement `saveScenario(scenario: SmokeScenario): Promise<void>` function
    - Implement `loadScenario(scenarioId: string): Promise<SmokeScenario>` function
    - Implement `listScenarios(): Promise<SmokeScenario[]>` function
    - Implement `deleteScenario(scenarioId: string): Promise<void>` function
    - Handle file I/O errors gracefully with try-catch
    - _Requirements: 23.1, 23.2, 23.3, 23.4_

  - [x] 6.3 Add scenario import/export functionality
    - Implement `importScenario(filePath: string): Promise<SmokeScenario>` function
    - Implement `exportScenario(scenario: SmokeScenario, filePath: string): Promise<void>` function
    - Support arbitrary file paths for import/export
    - Validate imported scenarios before saving
    - _Requirements: 23.5, 23.6_

  - [x]* 6.4 Write integration tests for scenario storage
    - Test save and load round-trip
    - Test list scenarios returns all saved scenarios
    - Test delete scenario removes file
    - Test import from external file
    - Test export to external file
    - Test error handling for malformed JSON
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5, 23.6_

- [x] 7. Add scenario execution state persistence
  - [x] 7.1 Create execution state persistence module
    - Create `ai-mobile-qa/apps/desktop/src/lib/executionStatePersistence.ts`
    - Implement `saveExecutionState(runId: string, state: ScenarioExecutionState): Promise<void>` function
    - Implement `loadExecutionState(runId: string): Promise<ScenarioExecutionState | null>` function
    - Implement `deleteExecutionState(runId: string): Promise<void>` function
    - Store state files in `~/.tezzy/state/{run_id}.json`
    - _Requirements: 30.1, 30.2, 30.5_

  - [x] 7.2 Add state persistence to scenario execution loop
    - After each action completes, call `saveExecutionState` with current state
    - Include current_goal_index, goal_progress, seen_element_keys, loop_count, etc.
    - On execution completion, call `deleteExecutionState` to clean up
    - _Requirements: 30.1, 30.2, 30.5_

  - [x] 7.3 Add incomplete run detection on startup
    - On app startup, check for state files in `~/.tezzy/state/`
    - If state files exist, detect incomplete runs
    - Store incomplete run info for UI to offer resume option (Phase 3)
    - _Requirements: 30.3, 30.4_

- [x] 8. Create scenario constraints enforcement module
  - [x] 8.1 Implement constraint checker
    - Create `ai-mobile-qa/apps/desktop/src/lib/scenarioConstraints.ts`
    - Implement `checkMaxStepsPerGoal(goalProgress: GoalProgress, maxSteps: number): boolean` function
    - Implement `checkTimeout(startTime: number, timeoutSeconds: number): boolean` function
    - Implement `shouldStopOnFailure(goalStatus: string, stopOnFirstFailure: boolean): boolean` function
    - Return constraint violation details when limits exceeded
    - _Requirements: 27.1, 27.2, 27.3, 27.4, 27.5_

  - [x] 8.2 Integrate constraint checking into execution loop
    - After each action, check max_steps_per_goal constraint
    - Check timeout_seconds constraint if specified
    - If constraint violated, halt goal execution and mark as failed
    - If stop_on_first_failure is true and goal fails, halt scenario execution
    - Log constraint violations with constraint name and value
    - _Requirements: 27.1, 27.2, 27.3, 27.4, 27.5_

- [x] 9. Final checkpoint - Integration verification
  - Verify scenario can be created, validated, saved, and loaded
  - Verify state management fixes work correctly in execution loop
  - Verify goal progress tracking updates correctly
  - Verify execution state persists and can be resumed
  - Verify constraints are enforced correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Enhance Phase F (Triage) to tag findings with goal context
  - [x] 10.1 Add goal context to IssueTriageInput schema
    - Modify `ai-mobile-qa/apps/ai-engine/app/schemas/issue_triage.py`
    - Add optional `current_goal` field to `IssueTriageInput` with goal_id, description, type, and success_criteria
    - Add optional `goal_progress` field with steps_taken, criteria_met, criteria_pending
    - _Requirements: 8.1, 8.2_

  - [x] 10.2 Add goal context to IssueTriageOutput schema
    - Modify finding structure in `IssueTriageOutput` to include optional `goal_id` and `blocks_goal` fields
    - Update `PHASE_F_ALLOWED_KEYS` to include new finding fields
    - _Requirements: 8.1, 8.3_

  - [x] 10.3 Enhance Phase F system prompt with goal-aware logic
    - Modify `_SYSTEM_PROMPT` in `ai-mobile-qa/apps/ai-engine/app/graphs/issue_triage.py`
    - Add GOAL CONTEXT RULES section explaining how to tag findings with goal_id
    - Add BLOCKS GOAL EVALUATION rules to determine if finding prevents goal completion
    - Instruct LLM to evaluate each finding against current goal's success criteria
    - If finding prevents a success criterion from being met, set `blocks_goal: true`
    - _Requirements: 8.2, 8.3, 8.4_

  - [x] 10.4 Update Phase F user prompt builder
    - Modify `build_phase_f_user_messages` function to include current_goal and goal_progress in prompt
    - Format goal context as: "Current Goal: {description} (type: {type})"
    - Include success criteria pending: "Success Criteria Pending: {criteria_pending}"
    - _Requirements: 8.1, 8.2_

  - [x] 10.5 Update run_step graph to pass goal context to Phase F
    - Modify `_triage_previous_step` in `ai-mobile-qa/apps/ai-engine/app/graphs/run_step.py`
    - Extract current_goal and goal_progress from `RunStepInput` (add these fields to RunStepInput schema)
    - Pass current_goal and goal_progress to `IssueTriageInput` when invoking triage graph
    - _Requirements: 8.1_

  - [x] 10.6 Update RunStepInput schema to accept goal context
    - Modify `ai-mobile-qa/apps/ai-engine/app/schemas/run_step.py`
    - Add optional `current_goal` field with goal_id, description, type, success_criteria
    - Add optional `goal_progress` field with steps_taken, criteria_met, criteria_pending
    - _Requirements: 8.1_

  - [x] 10.7 Update Desktop UI to pass goal context in aiRunStep calls
    - Modify `SmokeCheckPanel.tsx` to extract current goal from scenario execution state
    - Pass `current_goal` and `goal_progress` in `aiRunStep` API calls
    - Include goal_id, description, type, and success_criteria in current_goal
    - Include steps_taken, criteria_met, criteria_pending in goal_progress
    - _Requirements: 8.1_

  - [ ]* 10.8 Write integration tests for goal-aware triage
    - Create `ai-mobile-qa/apps/ai-engine/tests/test_phase_f_goal_context.py`
    - Test finding tagged with goal_id when current_goal provided
    - Test blocks_goal set to true when finding prevents success criterion
    - Test blocks_goal set to false when finding doesn't affect goal
    - Test triage works without goal context (backward compatibility)
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

---

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Phase 1 focuses on infrastructure only - no UI components or multi-agent integration
- Phase 2 will integrate scenarios into the multi-agent system
- Phase 3 will add UI components for scenario creation and execution

## Files Created/Modified

**New Files:**
- `ai-mobile-qa/apps/desktop/src/types/scenario.ts`
- `ai-mobile-qa/apps/desktop/src/lib/scenarioValidator.ts`
- `ai-mobile-qa/apps/desktop/src/lib/goalProgressTracker.ts`
- `ai-mobile-qa/apps/desktop/src/lib/scenarioStorage.ts`
- `ai-mobile-qa/apps/desktop/src/lib/executionStatePersistence.ts`
- `ai-mobile-qa/apps/desktop/src/lib/scenarioConstraints.ts`
- `ai-mobile-qa/apps/desktop/src-tauri/src/commands/scenarios.rs`

**Modified Files:**
- `ai-mobile-qa/apps/desktop/src/features/sessions/SmokeCheckPanel.tsx` (state management fixes)

## Estimated Effort

- Task 1: 2-3 hours (type definitions)
- Task 2: 4-5 hours (validation logic + tests)
- Task 3: 6-8 hours (state management fixes - critical)
- Task 4: 1 hour (checkpoint)
- Task 5: 5-6 hours (goal progress tracking)
- Task 6: 6-7 hours (scenario storage + Rust commands)
- Task 7: 4-5 hours (execution state persistence)
- Task 8: 3-4 hours (constraint enforcement)
- Task 9: 1 hour (final checkpoint)

**Total: ~32-40 hours (1-2 weeks)**
