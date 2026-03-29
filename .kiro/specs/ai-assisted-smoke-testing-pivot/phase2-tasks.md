# Phase 2 Tasks: Multi-Agent Integration

## Overview
Phase 2 enhances the multi-agent system (8-phase AI pipeline) to consume scenario context. The AI agents will receive goal information and make goal-directed decisions while maintaining their intelligence for screen understanding, UI adaptation, and defect detection.

## Prerequisites
- Phase 1 must be complete (all foundation tasks done)
- All Phase 1 tests passing (79 tests)
- Scenario types, validation, storage, and state management working

## Phase 2 Goals
1. Enhance Phase A (Session Bootstrap) to accept scenario input
2. Enhance Phase C (Planner) to make goal-directed action proposals
3. Enhance Phase D (Critic) to validate against goal constraints
4. Enhance Phase F (Triage) to tag findings with goal context
5. Enhance Phase H (Report) to generate scenario-based reports
6. Add goal progress evaluation logic (success criteria checking)
7. Create scenario execution orchestration layer

---

## Tasks

### 1. Enhance Phase A (Session Bootstrap) to consume scenario context

#### 1.1 Update session bootstrap schema
- [ ] Open `ai-mobile-qa/apps/ai-engine/app/schemas/session_bootstrap.py`
- [ ] Add optional `scenario` field to SessionBootstrapInput schema
- [ ] Add scenario fields: id, name, description, goals array, credentials
- [ ] Add goal schema: id, description, type, success_criteria, hints, form_data
- [ ] Ensure backward compatibility (scenario is optional)
- [ ] **Requirements**: 5.1, 5.7, 19.1, 19.2

#### 1.2 Update Phase A graph to extract scenario context
- [ ] Open `ai-mobile-qa/apps/ai-engine/app/graphs/session_manager.py`
- [ ] When scenario is provided, extract credentials from scenario.credentials
- [ ] If first goal type is "login", set initial mode to "reach_home"
- [ ] If first goal type is not "login", set initial mode to "explore"
- [ ] Extract home_markers from first goal's expected_screens (if present in hints)
- [ ] Extract flow_hints from all goals' descriptions
- [ ] Set run_goal to "Execute scenario: {scenario.name} - {scenario.description}"
- [ ] When no scenario provided, maintain existing autonomous mode initialization
- [ ] **Requirements**: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 19.3, 19.4

#### 1.3 Test Phase A scenario integration
- [ ] Create test scenario with login goal
- [ ] Call Phase A with scenario, verify credentials extracted
- [ ] Verify mode set to "reach_home" for login goal
- [ ] Create test scenario with navigate goal
- [ ] Verify mode set to "explore" for non-login goal
- [ ] Call Phase A without scenario, verify autonomous mode
- [ ] **Requirements**: 5.1, 5.2, 5.3, 5.7

---

### 2. Enhance Phase C (Planner) to make goal-directed decisions

#### 2.1 Update planner schema
- [ ] Open `ai-mobile-qa/apps/ai-engine/app/schemas/planner.py`
- [ ] Add optional `current_goal` field to PlannerInput schema
- [ ] Add goal fields: description, type, success_criteria, hints, form_data
- [ ] Add optional `goal_progress` field to PlannerInput schema
- [ ] Add progress fields: steps_taken, criteria_met, criteria_pending
- [ ] Ensure backward compatibility (both fields optional)
- [ ] **Requirements**: 6.1, 6.2, 20.1, 20.2

#### 2.2 Update Phase C prompt with goal context
- [ ] Open `ai-mobile-qa/apps/ai-engine/app/graphs/planner.py`
- [ ] When current_goal is provided, add goal context section to prompt
- [ ] Include: goal description, type, success_criteria (met and pending)
- [ ] Include: steps_taken, hints (expected_screens, required_actions, avoid_actions)
- [ ] For goal type "login", emphasize LOGIN SCREEN RULE from existing prompts
- [ ] For goal type "form_fill", include form_data and prioritize filling unfilled fields
- [ ] For goal type "navigate", include expected_screens and prioritize navigation actions
- [ ] For goal type "verify", prioritize actions that reveal UI elements
- [ ] For goal type "explore_section", include avoid_actions
- [ ] When no current_goal, use existing autonomous exploration prompt
- [ ] **Requirements**: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 20.3, 20.4

#### 2.3 Test Phase C goal-directed planning
- [ ] Create test with login goal, verify Phase C proposes login actions
- [ ] Create test with form_fill goal and form_data, verify Phase C proposes input_text for form fields
- [ ] Create test with navigate goal and expected_screens, verify Phase C proposes navigation actions
- [ ] Create test with verify goal, verify Phase C proposes validation actions
- [ ] Create test without goal, verify Phase C uses autonomous mode
- [ ] **Requirements**: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.8

---

### 3. Enhance Phase D (Critic) to validate against goal constraints

#### 3.1 Update critic schema
- [ ] Open `ai-mobile-qa/apps/ai-engine/app/schemas/critic_gate.py`
- [ ] Add optional `goal_constraints` field to CriticInput schema
- [ ] Add constraint fields: avoid_actions, required_screens, max_steps, steps_taken
- [ ] Ensure backward compatibility (goal_constraints optional)
- [ ] **Requirements**: 7.1, 7.2, 7.3, 20.1, 20.2

#### 3.2 Update Phase D validation logic
- [ ] Open `ai-mobile-qa/apps/ai-engine/app/graphs/critic_gate.py`
- [ ] When goal_constraints.avoid_actions is provided, reject actions with type in avoid_actions
- [ ] When goal_constraints.required_screens is provided, reject actions that navigate away before goal completion
- [ ] When goal_constraints.max_steps is provided and steps_taken >= max_steps, reject action
- [ ] When no goal_constraints, apply only existing rejection rules
- [ ] Include constraint violation reason in rejection message
- [ ] **Requirements**: 7.1, 7.2, 7.3, 7.4, 7.5, 20.3, 20.4

#### 3.3 Test Phase D constraint validation
- [ ] Create test with avoid_actions constraint, verify Phase D rejects those actions
- [ ] Create test with max_steps constraint, verify Phase D rejects when limit reached
- [ ] Create test with required_screens constraint, verify Phase D rejects navigation away
- [ ] Create test without constraints, verify Phase D uses existing rules only
- [ ] Verify rejection messages include constraint violation details
- [ ] **Requirements**: 7.1, 7.2, 7.3, 7.4, 7.5

---

### 4. Enhance Phase F (Triage) to tag findings with goal context

#### 4.1 Update triage schema
- [ ] Open `ai-mobile-qa/apps/ai-engine/app/schemas/issue_triage.py`
- [ ] Add optional `current_goal` field to TriageInput schema
- [ ] Add goal fields: id, description, success_criteria
- [ ] Update Finding schema to include optional goal_id and blocks_goal fields
- [ ] Ensure backward compatibility (current_goal optional)
- [ ] **Requirements**: 8.1, 8.2, 8.3, 20.1, 20.2

#### 4.2 Update Phase F to tag findings
- [ ] Open `ai-mobile-qa/apps/ai-engine/app/graphs/issue_triage.py`
- [ ] When current_goal is provided, add goal_id to each finding
- [ ] Evaluate whether finding blocks goal completion (prevents success criteria from being met)
- [ ] Set blocks_goal to true if finding prevents criterion satisfaction
- [ ] When no current_goal, process findings without goal context
- [ ] **Requirements**: 8.1, 8.2, 8.3, 8.4, 20.3, 20.4

#### 4.3 Test Phase F goal tagging
- [ ] Create test with current_goal, verify findings include goal_id
- [ ] Create test with blocking finding, verify blocks_goal is true
- [ ] Create test with non-blocking finding, verify blocks_goal is false
- [ ] Create test without current_goal, verify findings processed normally
- [ ] **Requirements**: 8.1, 8.2, 8.3, 8.4

---

### 5. Enhance Phase H (Report) to generate scenario-based reports

#### 5.1 Update report schema
- [ ] Open `ai-mobile-qa/apps/ai-engine/app/schemas/final_report.py`
- [ ] Add optional `scenario` field to ReportInput schema
- [ ] Add scenario fields: id, name, description
- [ ] Add optional `goal_results` field (array of GoalProgress objects)
- [ ] Add GoalProgress schema: goal_id, description, status, steps_taken, criteria_met, criteria_failed, findings, screenshots
- [ ] Update ReportOutput schema to include scenario_summary
- [ ] Add scenario_summary fields: total_goals, goals_passed, goals_failed, goals_partial, coverage_percentage, pass_fail_status
- [ ] Ensure backward compatibility (scenario and goal_results optional)
- [ ] **Requirements**: 9.1, 9.2, 9.3, 9.4, 21.1, 21.2

#### 5.2 Update Phase H to generate scenario reports
- [ ] Open `ai-mobile-qa/apps/ai-engine/app/graphs/final_report.py`
- [ ] When scenario is provided, include scenario id, name, description in report
- [ ] When goal_results is provided, add goal-by-goal results section
- [ ] For each goal, show: description, status, steps_taken, criteria_met, criteria_failed, findings
- [ ] Calculate: total_goals, goals_passed, goals_failed, goals_partial, coverage_percentage
- [ ] Set pass_fail_status: "pass" if all goals completed, "fail" if any failed, "partial" if some completed
- [ ] Format report with: executive summary, goal results section, overall findings, recommendations
- [ ] When no scenario provided, generate standard autonomous exploration report
- [ ] **Requirements**: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 21.3, 21.4

#### 5.3 Test Phase H scenario reporting
- [ ] Create test with all goals passed, verify pass_fail_status is "pass"
- [ ] Create test with one goal failed, verify pass_fail_status is "fail"
- [ ] Create test with partial completion, verify pass_fail_status is "partial"
- [ ] Verify goal-by-goal results section includes all required fields
- [ ] Verify coverage_percentage calculated correctly
- [ ] Create test without scenario, verify standard autonomous report generated
- [ ] **Requirements**: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6

---

### 6. Implement success criteria evaluation logic

#### 6.1 Create success criteria evaluator module
- [ ] Create `ai-mobile-qa/apps/ai-engine/app/evaluators/success_criteria.py`
- [ ] Implement `evaluate_criterion(criterion: str, screen_state: dict, phase_b_output: dict) -> bool`
- [ ] For screen_type criteria, compare against phase_b_output.screen_type
- [ ] For element presence criteria, check if element exists in screen_state.ui_elements
- [ ] For natural language criteria, use LLM call to evaluate against screen state
- [ ] Return True if criterion satisfied, False otherwise
- [ ] Log each evaluation with timestamp and result
- [ ] **Requirements**: 11.1, 11.2, 11.3, 11.4, 11.7

#### 6.2 Implement criteria evaluation orchestration
- [ ] In success_criteria.py, implement `evaluate_all_criteria(criteria_pending: list, screen_state: dict, phase_b_output: dict) -> tuple[list, list]`
- [ ] Evaluate each pending criterion
- [ ] Return tuple of (criteria_met, criteria_still_pending)
- [ ] Handle evaluation errors gracefully (log and treat as not met)
- [ ] **Requirements**: 11.1, 11.5, 11.6, 11.7

#### 6.3 Test success criteria evaluation
- [ ] Test screen_type criterion evaluation (e.g., "Reach home screen")
- [ ] Test element presence criterion evaluation (e.g., "User profile visible")
- [ ] Test natural language criterion evaluation (e.g., "All settings options present")
- [ ] Test evaluation with missing screen state, verify graceful handling
- [ ] Test evaluation with invalid criterion format, verify error handling
- [ ] **Requirements**: 11.1, 11.2, 11.3, 11.4, 11.7

---

### 7. Create scenario execution orchestration layer

#### 7.1 Create scenario executor module
- [ ] Create `ai-mobile-qa/apps/ai-engine/app/executors/scenario_executor.py`
- [ ] Implement `ScenarioExecutor` class with `execute(scenario: SmokeScenario, device_info: dict) -> ScenarioResult`
- [ ] Initialize execution state: current_goal_index = 0, goal_progress = {}
- [ ] Load scenario definition and validate
- [ ] Initialize state management (seen_element_keys, loop_count, etc.)
- [ ] **Requirements**: 10.1, 10.7

#### 7.2 Implement goal execution loop
- [ ] In ScenarioExecutor, implement `execute_goal(goal: ScenarioGoal, state: ExecutionState) -> GoalProgress`
- [ ] Initialize goal progress: status = "in_progress", steps_taken = 0, criteria_met = [], criteria_pending = goal.success_criteria
- [ ] Loop: get UI snapshot → call Phase B → call Phase C with goal context → call Phase D with constraints → execute action
- [ ] After each action, evaluate success criteria using evaluator from Task 6
- [ ] Move satisfied criteria from criteria_pending to criteria_met
- [ ] Increment steps_taken, update goal_progress
- [ ] If all criteria met, set status = "completed" and return
- [ ] If max_steps_per_goal reached, set status = "failed" and return
- [ ] If timeout exceeded, set status = "failed" and return
- [ ] If critical error, set status = "failed" and return
- [ ] **Requirements**: 10.2, 10.7, 10.8, 10.9, 11.1, 11.5, 11.6

#### 7.3 Implement scenario-level orchestration
- [ ] In ScenarioExecutor.execute(), loop through goals in order
- [ ] For each goal, call execute_goal()
- [ ] When goal completes successfully, advance to next goal
- [ ] When goal fails and stop_on_first_failure is true, halt execution and generate report
- [ ] When goal fails and stop_on_first_failure is false, continue to next goal
- [ ] When all goals complete, call Phase H to generate final report
- [ ] Emit progress events after each action for real-time UI updates
- [ ] **Requirements**: 10.2, 10.3, 10.4, 10.5, 10.6, 10.7

#### 7.4 Integrate execution state persistence
- [ ] In execute_goal(), after each action, call executionStatePersistence.saveExecutionState()
- [ ] Include: current_goal_index, goal_progress, seen_element_keys, loop_count, no_element_count, completed_screens, recent_actions, failure_streak
- [ ] On execution completion, call executionStatePersistence.deleteExecutionState()
- [ ] On execution start, check for existing state file and offer resume (Phase 3 feature, log for now)
- [ ] **Requirements**: 30.1, 30.2, 30.5

#### 7.5 Test scenario executor
- [ ] Test single-goal scenario execution, verify goal completes
- [ ] Test multi-goal scenario execution, verify goals execute in order
- [ ] Test scenario with stop_on_first_failure=true, verify halts on first failure
- [ ] Test scenario with stop_on_first_failure=false, verify continues after failure
- [ ] Test scenario with max_steps_per_goal constraint, verify enforced
- [ ] Test scenario with timeout constraint, verify enforced
- [ ] Test execution state persistence, verify state saved after each action
- [ ] **Requirements**: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9

---

### 8. Create API endpoint for scenario execution

#### 8.1 Implement scenario execution endpoint
- [ ] Open `ai-mobile-qa/apps/ai-engine/app/api/v1.py`
- [ ] Add POST /v1/scenario/execute endpoint
- [ ] Accept request body: scenario (SmokeScenario), device_info (dict)
- [ ] Validate scenario using validator from Phase 1
- [ ] Generate run_id (UUID)
- [ ] Call ScenarioExecutor.execute() asynchronously
- [ ] Return response: run_id, status="running", current_goal_index=0, goal_results=[]
- [ ] **Requirements**: 16.1, 16.2, 16.3, 16.4

#### 8.2 Implement scenario execution status endpoint
- [ ] Add GET /v1/scenario/execute/{run_id}/status endpoint
- [ ] Return current execution status: run_id, status, current_goal_index, goal_results, findings_count
- [ ] If execution complete, include final report
- [ ] **Requirements**: 16.5

#### 8.3 Test scenario execution API
- [ ] Test POST /v1/scenario/execute with valid scenario, verify run_id returned
- [ ] Test GET /v1/scenario/execute/{run_id}/status, verify status updates
- [ ] Test execution with invalid scenario, verify validation error returned
- [ ] Test execution completion, verify final report included in status
- [ ] **Requirements**: 16.1, 16.2, 16.3, 16.4, 16.5

---

### 9. Create API endpoint for scenario validation

#### 9.1 Implement scenario validation endpoint
- [ ] Open `ai-mobile-qa/apps/ai-engine/app/api/v1.py`
- [ ] Add POST /v1/scenario/validate endpoint
- [ ] Accept request body: scenario (SmokeScenario)
- [ ] Call validator from Phase 1
- [ ] Return response: valid (bool), errors (array), warnings (array), estimated_steps (int), estimated_duration_seconds (int)
- [ ] If validation fails, include specific error messages for each invalid field
- [ ] **Requirements**: 17.1, 17.2, 17.3, 17.4

#### 9.2 Test scenario validation API
- [ ] Test with valid scenario, verify valid=true and estimates returned
- [ ] Test with invalid scenario (missing required fields), verify errors returned
- [ ] Test with login goal but no credentials, verify validation error
- [ ] Test with form_fill goal but no form_data, verify validation error
- [ ] **Requirements**: 17.1, 17.2, 17.3, 17.4

---

### 10. Create API endpoint for scenario templates

#### 10.1 Create scenario templates
- [ ] Create `ai-mobile-qa/apps/ai-engine/app/templates/scenarios.json`
- [ ] Define at least 8 templates: Basic Login, Login + Logout, Form Submission, Navigation Tour, Settings Verification, Search Flow, Cart Checkout, Profile Update
- [ ] Each template includes: id, name, description, goals array, estimated_steps
- [ ] **Requirements**: 18.3

#### 10.2 Implement templates endpoint
- [ ] Open `ai-mobile-qa/apps/ai-engine/app/api/v1.py`
- [ ] Add GET /v1/scenario/templates endpoint
- [ ] Load templates from scenarios.json
- [ ] Return array of templates with: id, name, description, goal_types, estimated_steps
- [ ] **Requirements**: 18.1, 18.2

#### 10.3 Test templates API
- [ ] Test GET /v1/scenario/templates, verify at least 8 templates returned
- [ ] Verify each template has required fields
- [ ] Verify templates are valid scenarios (can be validated)
- [ ] **Requirements**: 18.1, 18.2, 18.3

---

### 11. Update Desktop UI to call scenario execution API

#### 11.1 Update SmokeCheckPanel to support scenario mode
- [ ] Open `ai-mobile-qa/apps/desktop/src/features/sessions/SmokeCheckPanel.tsx`
- [ ] Add mode selector: "Scenario-Based" vs "Autonomous Explore"
- [ ] When Scenario-Based mode selected, show scenario selector dropdown
- [ ] Load scenarios from scenarioStorage (Phase 1)
- [ ] When scenario selected, display scenario name and goal count
- [ ] When Start clicked, call POST /v1/scenario/execute with selected scenario
- [ ] Store run_id from response
- [ ] **Requirements**: 14.1, 14.2, 14.3, 14.4

#### 11.2 Add real-time goal progress display
- [ ] In SmokeCheckPanel, poll GET /v1/scenario/execute/{run_id}/status every 2 seconds
- [ ] Display current goal progress with progress bar
- [ ] Show which success criteria are met (✓) and which are pending (○)
- [ ] Display recent actions with their results
- [ ] Show live count of findings (errors and warnings)
- [ ] **Requirements**: 14.5, 14.6, 14.7, 14.8

#### 11.3 Handle scenario execution completion
- [ ] When status returns "completed", stop polling
- [ ] Display final results: pass/fail status, goals completed, total duration
- [ ] Show "View Report" button that opens Scenario Results Panel (Phase 3)
- [ ] **Requirements**: 14.5, 14.6, 14.7, 14.8

#### 11.4 Maintain autonomous mode support
- [ ] When Autonomous Explore mode selected, hide scenario-specific controls
- [ ] Show autonomous mode controls (existing handleStartAi logic)
- [ ] Ensure backward compatibility with existing autonomous mode
- [ ] **Requirements**: 14.9, 22.1, 22.2, 22.3, 22.5

---

### 12. Final integration verification

#### 12.1 End-to-end scenario execution test
- [ ] Create a test scenario with 2 goals (login + navigate)
- [ ] Execute scenario through Desktop UI
- [ ] Verify Phase A receives scenario context
- [ ] Verify Phase C makes goal-directed decisions
- [ ] Verify Phase D validates against constraints
- [ ] Verify Phase F tags findings with goal_id
- [ ] Verify Phase H generates scenario-based report
- [ ] Verify success criteria evaluated correctly
- [ ] Verify goal progress tracked correctly
- [ ] Verify execution state persisted

#### 12.2 Test constraint enforcement
- [ ] Create scenario with max_steps_per_goal=5
- [ ] Execute and verify goal fails after 5 steps if not completed
- [ ] Create scenario with timeout_seconds=30
- [ ] Execute and verify goal fails after 30 seconds if not completed
- [ ] Create scenario with stop_on_first_failure=true
- [ ] Execute and verify execution halts after first goal failure

#### 12.3 Test backward compatibility
- [ ] Execute autonomous mode (no scenario), verify works as before
- [ ] Verify heuristic smoke check still works
- [ ] Verify existing API endpoints work without scenario context
- [ ] Verify Phase A, C, D, F, H work in autonomous mode

#### 12.4 Run all tests
- [ ] Run all Phase 1 tests, verify still passing
- [ ] Run all Phase 2 tests, verify passing
- [ ] Run Python backend tests: `cd ai-mobile-qa/apps/ai-engine && pytest`
- [ ] Run TypeScript tests: `cd ai-mobile-qa/apps/desktop && npm test`
- [ ] Fix any failing tests

#### 12.5 Manual testing with real app
- [ ] Test with a real Android app (e.g., sample login app)
- [ ] Create scenario with login goal
- [ ] Execute and verify login completes successfully
- [ ] Verify success criteria evaluated correctly
- [ ] Verify report shows goal completion
- [ ] Test with multi-goal scenario (login + navigate + verify)
- [ ] Verify all goals execute in order
- [ ] Verify final report shows all goal results

---

## Success Criteria

Phase 2 is complete when:
- [ ] All 12 tasks completed
- [ ] All Phase 1 tests still passing (79 tests)
- [ ] All Phase 2 tests passing
- [ ] Multi-agent system (Phases A, C, D, F, H) enhanced with scenario context
- [ ] Scenario execution orchestration layer working
- [ ] API endpoints for scenario execution, validation, and templates working
- [ ] Desktop UI can execute scenarios and display real-time progress
- [ ] Backward compatibility maintained (autonomous mode still works)
- [ ] End-to-end scenario execution tested with real app
- [ ] Success criteria evaluation working correctly
- [ ] Goal progress tracking working correctly
- [ ] Execution state persistence working correctly
- [ ] Constraint enforcement working correctly

## Notes

- Phase 2 does NOT include UI components (Scenario Builder, Scenario Library, Scenario Results Panel) - those are Phase 3
- Phase 2 focuses on backend integration and basic execution UI
- All visual defect detection capabilities must be preserved
- Autonomous mode must remain fully functional
- All changes must be backward compatible
