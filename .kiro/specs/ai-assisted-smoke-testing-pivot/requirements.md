# Requirements Document: AI-Assisted Smoke Testing Pivot

## Introduction

This document specifies the functional and non-functional requirements for transforming Tezzy from a fully autonomous AI exploration agent into an AI-assisted smoke testing tool. The system will enable users to define test scenarios with explicit goals while preserving the multi-agent system's intelligence for screen understanding, UI adaptation, and defect detection.

The requirements are organized by feature area and follow the EARS (Easy Approach to Requirements Syntax) pattern for clarity and testability.

## Glossary

- **System**: The Tezzy AI-assisted smoke testing application (desktop UI + AI engine + device bridge)
- **Scenario**: A user-defined test specification containing sequential goals, credentials, and success criteria
- **Goal**: A single test objective within a scenario (e.g., "login", "navigate to settings")
- **Success_Criteria**: Conditions that must be met for a goal to be considered complete
- **Multi_Agent_System**: The 8-phase AI pipeline (Session Bootstrap, Screen Analyst, Planner, Critic, Vision Analyst, Triage, Advisor, Report)
- **Scenario_Engine**: The orchestration layer that executes scenarios and tracks goal progress
- **UI_Snapshot**: The current state of the mobile device screen (XML hierarchy + screenshot)
- **Action**: A single interaction with the device (tap, swipe, input_text, back)
- **Phase_A**: Session Bootstrap agent
- **Phase_B**: Screen Analyst agent
- **Phase_C**: Planner agent
- **Phase_D**: Critic Gate agent
- **Phase_E**: Vision Analyst agent
- **Phase_F**: Issue Triage agent
- **Phase_G**: Improvement Advisor agent
- **Phase_H**: Final Report agent
- **Goal_Progress**: Tracking state for a goal including steps taken, criteria met, and findings
- **Execution_State**: The complete runtime state including memory tracking, action history, and goal progress
- **Desktop_UI**: The Tauri-based desktop application frontend
- **AI_Engine**: The Python FastAPI backend running the multi-agent system
- **Device_Bridge**: The Appium/ADB layer for device communication

---

## Requirements

### Requirement 1: Scenario Definition System

**User Story:** As a QA engineer, I want to define test scenarios in a structured format, so that I can specify exactly what flows the AI should test.

#### Acceptance Criteria

1. WHEN a user creates a scenario, THE System SHALL accept a JSON structure containing id, name, description, app_name, optional credentials, and a list of goals
2. WHEN a scenario includes credentials, THE System SHALL store email and password fields securely
3. WHEN a user defines a goal, THE System SHALL accept goal id, description, type, success_criteria array, optional hints, and optional form_data
4. THE System SHALL support goal types: login, navigate, form_fill, verify, explore_section, and custom
5. WHEN a goal includes hints, THE System SHALL accept expected_screens, required_actions, and avoid_actions arrays
6. WHEN a goal type is form_fill, THE System SHALL accept form_data as a key-value map of field names to values
7. THE System SHALL store scenarios as JSON files in a designated directory
8. WHEN a user saves a scenario, THE System SHALL persist it to disk immediately

### Requirement 2: Scenario Validation

**User Story:** As a QA engineer, I want scenarios to be validated before execution, so that I can catch configuration errors early.

#### Acceptance Criteria

1. WHEN a user attempts to save a scenario, THE System SHALL validate that all required fields are present
2. IF a scenario has a goal of type login and no credentials are provided, THEN THE System SHALL return a validation error
3. IF a scenario has a goal of type form_fill and no form_data is provided, THEN THE System SHALL return a validation error
4. WHEN validating a scenario, THE System SHALL check that all goal IDs are unique within the scenario
5. WHEN validating a scenario, THE System SHALL check that success_criteria arrays are non-empty for all goals
6. IF validation fails, THEN THE System SHALL return a list of specific error messages indicating which fields are invalid
7. WHEN validation succeeds, THE System SHALL return estimated steps and estimated duration for the scenario

### Requirement 3: Enhanced State Management

**User Story:** As a developer, I want proper state tracking during scenario execution, so that memory issues and loop detection work correctly.

#### Acceptance Criteria

1. WHEN an action is executed, THE System SHALL add the tapped element's unique key to seen_element_keys
2. WHEN a UI snapshot is received, THE System SHALL increment the count for that screen hash in seen_hash_counts
3. WHEN a screen hash is encountered that exists in seen_hash_counts, THE System SHALL increment loop_count
4. WHEN a new screen hash is encountered, THE System SHALL reset loop_count to zero
5. WHEN a UI snapshot contains zero interactive elements, THE System SHALL increment no_element_count
6. WHEN a UI snapshot contains one or more interactive elements, THE System SHALL reset no_element_count to zero
7. WHEN all interactive elements on a screen have been tapped, THE System SHALL add that screen hash to completed_screens
8. THE System SHALL maintain a recent_actions list containing the last 10 action records
9. WHEN an action fails, THE System SHALL increment failure_streak
10. WHEN an action succeeds, THE System SHALL reset failure_streak to zero

### Requirement 4: Goal Progress Tracking

**User Story:** As a QA engineer, I want to see real-time progress toward each goal, so that I can monitor test execution.

#### Acceptance Criteria

1. WHEN a scenario starts execution, THE System SHALL initialize goal_progress for each goal with status "not_started"
2. WHEN a goal begins execution, THE System SHALL set its status to "in_progress"
3. WHEN an action is executed during a goal, THE System SHALL increment steps_taken for that goal
4. WHEN a success criterion is satisfied, THE System SHALL move it from success_criteria_pending to success_criteria_met
5. WHEN all success criteria for a goal are met, THE System SHALL set the goal status to "completed"
6. IF max_steps_per_goal is reached before all criteria are met, THEN THE System SHALL set the goal status to "failed"
7. IF a critical error occurs during goal execution, THEN THE System SHALL set the goal status to "failed"
8. WHEN a finding is detected during a goal, THE System SHALL add it to that goal's findings array
9. WHEN a screenshot is captured during a goal, THE System SHALL add its path to that goal's screenshots array
10. THE System SHALL record each action in the goal's actions_log with step number, action details, screen hash, result, and whether it contributed to goal progress

### Requirement 5: Phase A Enhancement (Session Bootstrap)

**User Story:** As a system architect, I want Phase A to consume scenario context, so that the session is initialized with proper credentials and goals.

#### Acceptance Criteria

1. WHEN Phase_A receives a scenario, THE System SHALL extract credentials from scenario.credentials
2. WHEN Phase_A receives a scenario with a first goal of type login, THE System SHALL set initial mode to "reach_home"
3. WHEN Phase_A receives a scenario with a first goal of type other than login, THE System SHALL set initial mode to "explore"
4. WHEN Phase_A receives a scenario, THE System SHALL extract home_markers from the first goal's expected_screens
5. WHEN Phase_A receives a scenario, THE System SHALL extract flow_hints from all goals' descriptions
6. WHEN Phase_A receives a scenario, THE System SHALL set run_goal to "Execute scenario: {scenario.name} - {scenario.description}"
7. WHEN Phase_A receives no scenario, THE System SHALL initialize in autonomous exploration mode with no credentials

### Requirement 6: Phase C Enhancement (Planner)

**User Story:** As a system architect, I want Phase C to receive current goal context, so that it can plan actions that advance toward the goal.

#### Acceptance Criteria

1. WHEN Phase_C receives current_goal context, THE System SHALL include goal description, type, success_criteria, hints, and form_data in the prompt
2. WHEN Phase_C receives goal_progress, THE System SHALL include steps_taken, criteria_met, and criteria_pending in the prompt
3. WHEN current_goal type is login and credentials are provided, THE System SHALL follow the LOGIN SCREEN RULE from existing prompts
4. WHEN current_goal type is form_fill and form_data is provided, THE System SHALL prioritize input_text actions for unfilled fields matching form_data keys
5. WHEN current_goal type is navigate and hints.expected_screens is provided, THE System SHALL prioritize actions that move toward those screens
6. WHEN current_goal type is verify, THE System SHALL prioritize actions that reveal UI elements for validation
7. WHEN current_goal type is explore_section and hints.avoid_actions is provided, THE System SHALL avoid proposing those action types
8. WHEN no current_goal is provided, THE System SHALL operate in autonomous exploration mode

### Requirement 7: Phase D Enhancement (Critic Gate)

**User Story:** As a system architect, I want Phase D to validate actions against goal constraints, so that invalid actions are rejected before execution.

#### Acceptance Criteria

1. WHEN Phase_D receives goal_constraints with avoid_actions, THE System SHALL reject any proposed action whose type is in avoid_actions
2. WHEN Phase_D receives goal_constraints with required_screens, THE System SHALL reject actions that would navigate away from required screens before goal completion
3. WHEN Phase_D receives goal_constraints with max_steps and steps_taken >= max_steps, THE System SHALL reject the proposed action
4. WHEN no goal_constraints are provided, THE System SHALL apply only the existing rejection rules
5. IF Phase_D rejects an action due to goal constraints, THEN THE System SHALL include the constraint violation reason in the rejection message

### Requirement 8: Phase F Enhancement (Issue Triage)

**User Story:** As a system architect, I want Phase F to tag findings with goal context, so that issues can be correlated with specific test objectives.

#### Acceptance Criteria

1. WHEN Phase_F processes a finding and current_goal is provided, THE System SHALL add goal_id to the finding
2. WHEN Phase_F processes a finding and current_goal is provided, THE System SHALL evaluate whether the finding blocks goal completion
3. IF a finding prevents a success criterion from being met, THEN THE System SHALL set blocks_goal to true
4. WHEN no current_goal is provided, THE System SHALL process findings without goal context

### Requirement 9: Phase H Enhancement (Final Report)

**User Story:** As a QA engineer, I want the final report to show goal-by-goal results, so that I can see which parts of the scenario passed or failed.

#### Acceptance Criteria

1. WHEN Phase_H receives scenario context, THE System SHALL include scenario id, name, and description in the report
2. WHEN Phase_H receives goal_results, THE System SHALL include a section for each goal showing description, status, steps_taken, criteria_met, criteria_failed, and findings
3. WHEN Phase_H generates a scenario report, THE System SHALL calculate total_goals, goals_passed, goals_failed, goals_partial, and coverage_percentage
4. WHEN Phase_H generates a scenario report, THE System SHALL set pass_fail_status to "pass" if all goals completed, "fail" if any goal failed, or "partial" if some goals completed
5. THE System SHALL format the report with an executive summary, goal results section, overall findings section, and recommendations section
6. WHEN no scenario context is provided, THE System SHALL generate a standard autonomous exploration report

### Requirement 10: Scenario Execution Engine

**User Story:** As a QA engineer, I want scenarios to execute as sequential goals, so that multi-step test flows work correctly.

#### Acceptance Criteria

1. WHEN a scenario execution starts, THE System SHALL load the scenario definition and initialize execution state
2. THE System SHALL execute goals in the order they appear in the scenario.goals array
3. WHEN a goal completes successfully, THE System SHALL advance to the next goal
4. WHEN a goal fails and stop_on_first_failure is true, THE System SHALL halt execution and generate a report
5. WHEN a goal fails and stop_on_first_failure is false, THE System SHALL continue to the next goal
6. WHEN all goals are complete, THE System SHALL call Phase_H to generate the final report
7. THE System SHALL emit progress events after each action for real-time UI updates
8. WHEN max_steps_per_goal is specified in constraints, THE System SHALL enforce it for each goal
9. WHEN timeout_seconds is specified in constraints, THE System SHALL halt goal execution if the timeout is exceeded

### Requirement 11: Success Criteria Evaluation

**User Story:** As a system architect, I want success criteria to be evaluated after each action, so that goal completion is detected promptly.

#### Acceptance Criteria

1. WHEN an action completes, THE System SHALL evaluate all pending success criteria for the current goal
2. WHEN a criterion references screen_type, THE System SHALL compare it against Phase_B output
3. WHEN a criterion references element presence, THE System SHALL check if the element exists in the current UI snapshot
4. WHEN a criterion is natural language, THE System SHALL use an LLM call to evaluate it against the current screen state
5. WHEN a criterion is satisfied, THE System SHALL move it from criteria_pending to criteria_met
6. WHEN all criteria are met, THE System SHALL mark the goal as completed
7. THE System SHALL log each criterion evaluation with timestamp and result

### Requirement 12: Scenario Builder UI Component

**User Story:** As a QA engineer, I want a visual scenario builder, so that I can create scenarios without writing JSON manually.

#### Acceptance Criteria

1. WHEN a user opens the Scenario Builder, THE Desktop_UI SHALL display fields for scenario name, description, and app_name
2. WHEN a user adds credentials, THE Desktop_UI SHALL provide fields for email and password with password masking
3. WHEN a user adds a goal, THE Desktop_UI SHALL provide a goal type selector with all supported types
4. WHEN a user selects a goal type, THE Desktop_UI SHALL show relevant fields for that type (hints for navigate, form_data for form_fill)
5. WHEN a user adds success criteria, THE Desktop_UI SHALL provide a text input with autocomplete suggestions
6. THE Desktop_UI SHALL allow users to reorder goals via drag-and-drop
7. WHEN a user clicks Save, THE Desktop_UI SHALL validate the scenario and show errors if validation fails
8. WHEN validation succeeds, THE Desktop_UI SHALL save the scenario to disk and show a success message
9. THE Desktop_UI SHALL provide Import and Export buttons for loading/saving scenarios as JSON files

### Requirement 13: Scenario Library UI Component

**User Story:** As a QA engineer, I want a library of scenario templates, so that I can quickly create common test patterns.

#### Acceptance Criteria

1. WHEN a user opens the Scenario Library, THE Desktop_UI SHALL display a list of available templates
2. THE Desktop_UI SHALL provide templates for: Basic Login, Login + Logout, Form Submission, Navigation Tour, Settings Verification, Search Flow, Cart Checkout, Profile Update
3. WHEN a user clicks Use on a template, THE Desktop_UI SHALL load the template into the Scenario Builder
4. THE Desktop_UI SHALL display user-created scenarios in a separate "My Scenarios" section
5. WHEN a user clicks on a saved scenario, THE Desktop_UI SHALL show its last run status and timestamp
6. THE Desktop_UI SHALL provide a search field to filter scenarios by name or description
7. THE Desktop_UI SHALL provide a filter dropdown to show scenarios by goal type

### Requirement 14: Enhanced Smoke Check Panel

**User Story:** As a QA engineer, I want to execute scenarios from the Smoke Check Panel, so that I can run tests with one click.

#### Acceptance Criteria

1. WHEN a user opens the Smoke Check Panel, THE Desktop_UI SHALL display a mode selector with "Scenario-Based" and "Autonomous Explore" options
2. WHEN Scenario-Based mode is selected, THE Desktop_UI SHALL show a scenario selector dropdown
3. WHEN a scenario is selected, THE Desktop_UI SHALL display the scenario name and goal count
4. WHEN a user clicks Start, THE Desktop_UI SHALL begin scenario execution
5. WHILE a scenario is executing, THE Desktop_UI SHALL display current goal progress with a progress bar
6. WHILE a scenario is executing, THE Desktop_UI SHALL show which success criteria are met and which are pending
7. WHILE a scenario is executing, THE Desktop_UI SHALL display recent actions with their results
8. WHILE a scenario is executing, THE Desktop_UI SHALL show a live count of findings (errors and warnings)
9. WHEN Autonomous Explore mode is selected, THE Desktop_UI SHALL hide scenario-specific controls and show autonomous mode controls

### Requirement 15: Scenario Results Panel

**User Story:** As a QA engineer, I want to view detailed scenario results, so that I can analyze test outcomes.

#### Acceptance Criteria

1. WHEN a scenario execution completes, THE Desktop_UI SHALL display the Scenario Results Panel
2. THE Desktop_UI SHALL show overall status (PASS/FAIL/PARTIAL), goal completion count, and total duration
3. THE Desktop_UI SHALL display a card for each goal showing status, steps taken, duration, and criteria results
4. WHEN a user clicks View Details on a goal, THE Desktop_UI SHALL expand the card to show the action log
5. THE Desktop_UI SHALL display all findings grouped by goal
6. THE Desktop_UI SHALL provide an Export Report button that saves the report as markdown
7. THE Desktop_UI SHALL provide a Run Again button that re-executes the scenario
8. THE Desktop_UI SHALL provide an Edit Scenario button that opens the scenario in the Scenario Builder

### Requirement 16: API Endpoint for Scenario Execution

**User Story:** As a developer, I want an API endpoint to execute scenarios, so that the Desktop UI can trigger scenario runs.

#### Acceptance Criteria

1. THE AI_Engine SHALL expose a POST /v1/scenario/execute endpoint
2. WHEN the endpoint receives a scenario and device_info, THE AI_Engine SHALL initialize a scenario execution
3. THE AI_Engine SHALL return a response containing run_id, status, current_goal_index, and goal_results
4. THE AI_Engine SHALL execute the scenario asynchronously and emit progress events
5. WHEN the scenario completes, THE AI_Engine SHALL finalize the report and update the run status

### Requirement 17: API Endpoint for Scenario Validation

**User Story:** As a developer, I want an API endpoint to validate scenarios, so that the UI can show validation errors before execution.

#### Acceptance Criteria

1. THE AI_Engine SHALL expose a POST /v1/scenario/validate endpoint
2. WHEN the endpoint receives a scenario, THE AI_Engine SHALL validate all required fields
3. THE AI_Engine SHALL return a response containing valid (boolean), errors array, warnings array, estimated_steps, and estimated_duration_seconds
4. IF validation fails, THEN THE AI_Engine SHALL include specific error messages for each invalid field

### Requirement 18: API Endpoint for Scenario Templates

**User Story:** As a developer, I want an API endpoint to retrieve scenario templates, so that the UI can populate the Scenario Library.

#### Acceptance Criteria

1. THE AI_Engine SHALL expose a GET /v1/scenario/templates endpoint
2. THE AI_Engine SHALL return an array of templates with id, name, description, goal_types, and estimated_steps
3. THE AI_Engine SHALL include at least 8 predefined templates covering common test patterns

### Requirement 19: Enhanced Session Bootstrap Endpoint

**User Story:** As a developer, I want the session bootstrap endpoint to accept scenario context, so that Phase A can initialize with scenario data.

#### Acceptance Criteria

1. THE AI_Engine SHALL accept an optional scenario field in POST /v1/session/bootstrap requests
2. WHEN scenario is provided, THE AI_Engine SHALL extract credentials, home_markers, flow_hints, and constraints
3. WHEN scenario is provided, THE AI_Engine SHALL pass scenario context to Phase_A
4. WHEN scenario is not provided, THE AI_Engine SHALL initialize in autonomous mode

### Requirement 20: Enhanced Run Step Endpoint

**User Story:** As a developer, I want the run step endpoint to accept goal context, so that Phase C and Phase D can make goal-directed decisions.

#### Acceptance Criteria

1. THE AI_Engine SHALL accept optional current_goal and goal_progress fields in POST /v1/run/step requests
2. WHEN current_goal is provided, THE AI_Engine SHALL pass it to Phase_C and Phase_D
3. WHEN goal_progress is provided, THE AI_Engine SHALL include it in the Phase_C prompt
4. WHEN current_goal is not provided, THE AI_Engine SHALL operate in autonomous mode

### Requirement 21: Enhanced Report Finalization Endpoint

**User Story:** As a developer, I want the report endpoint to accept scenario results, so that Phase H can generate scenario-based reports.

#### Acceptance Criteria

1. THE AI_Engine SHALL accept optional scenario and goal_results fields in POST /v1/report/finalize requests
2. WHEN scenario is provided, THE AI_Engine SHALL pass it to Phase_H
3. WHEN goal_results is provided, THE AI_Engine SHALL include goal-by-goal results in the report
4. WHEN scenario is not provided, THE AI_Engine SHALL generate a standard autonomous report

### Requirement 22: Backward Compatibility with Autonomous Mode

**User Story:** As a user, I want autonomous exploration mode to remain available, so that I can still use Tezzy for exploratory testing.

#### Acceptance Criteria

1. WHEN no scenario is selected, THE System SHALL execute in autonomous exploration mode
2. THE Desktop_UI SHALL provide a mode toggle between "Scenario-Based" and "Autonomous Explore"
3. WHEN Autonomous Explore mode is selected, THE System SHALL use the existing autonomous exploration logic
4. THE System SHALL maintain the existing heuristic smoke check functionality
5. WHEN a user switches modes, THE Desktop_UI SHALL show/hide mode-specific controls appropriately

### Requirement 23: Scenario Storage and Retrieval

**User Story:** As a QA engineer, I want scenarios to be saved and loaded from disk, so that I can reuse scenarios across sessions.

#### Acceptance Criteria

1. THE System SHALL store scenarios in JSON format in a designated directory
2. WHEN a scenario is saved, THE System SHALL write it to {scenarios_dir}/{scenario_id}.json
3. WHEN the Scenario Library loads, THE System SHALL read all JSON files from the scenarios directory
4. IF a scenario file is malformed, THEN THE System SHALL log an error and skip that file
5. THE System SHALL support importing scenarios from arbitrary file paths
6. THE System SHALL support exporting scenarios to arbitrary file paths

### Requirement 24: Scenario Execution Metrics

**User Story:** As a QA engineer, I want to see execution metrics for scenarios, so that I can track performance over time.

#### Acceptance Criteria

1. WHEN a scenario completes, THE System SHALL record total_steps, total_duration_seconds, goals_passed, goals_failed, and findings_count
2. THE System SHALL store execution history for each scenario
3. THE Desktop_UI SHALL display the last run timestamp and status for each scenario in the library
4. THE Desktop_UI SHALL show a trend indicator (improving/degrading) based on recent runs

### Requirement 25: Error Handling for Scenario Execution

**User Story:** As a QA engineer, I want clear error messages when scenario execution fails, so that I can diagnose issues quickly.

#### Acceptance Criteria

1. IF a scenario fails to load, THEN THE System SHALL display an error message indicating which field is invalid
2. IF device connection is lost during execution, THEN THE System SHALL halt execution and display a connection error
3. IF Phase_C fails to propose an action, THEN THE System SHALL retry up to 3 times before failing the goal
4. IF Phase_D rejects all proposed actions, THEN THE System SHALL log the rejection reasons and fail the goal
5. IF a critical error occurs, THEN THE System SHALL generate a partial report with results up to the point of failure

### Requirement 26: Scenario Execution Logging

**User Story:** As a developer, I want detailed logs of scenario execution, so that I can debug issues in the multi-agent system.

#### Acceptance Criteria

1. THE System SHALL log each goal start and completion with timestamp
2. THE System SHALL log each action execution with step number, action type, parameters, and result
3. THE System SHALL log each success criterion evaluation with result
4. THE System SHALL log each Phase_C proposal and Phase_D validation result
5. THE System SHALL write logs to a file in {logs_dir}/{run_id}.log
6. THE Desktop_UI SHALL provide a "View Logs" button that opens the log file

### Requirement 27: Scenario Constraints Enforcement

**User Story:** As a QA engineer, I want scenario constraints to be enforced, so that tests don't run indefinitely.

#### Acceptance Criteria

1. WHEN max_steps_per_goal is specified, THE System SHALL halt goal execution after that many steps
2. WHEN timeout_seconds is specified, THE System SHALL halt goal execution if the timeout is exceeded
3. WHEN stop_on_first_failure is true and a goal fails, THE System SHALL halt scenario execution
4. WHEN stop_on_first_failure is false and a goal fails, THE System SHALL continue to the next goal
5. THE System SHALL log constraint violations with the constraint name and value

### Requirement 28: Form Data Handling

**User Story:** As a QA engineer, I want form_fill goals to automatically populate form fields, so that I don't have to specify every action manually.

#### Acceptance Criteria

1. WHEN a goal type is form_fill and form_data is provided, THE System SHALL pass form_data to Phase_C
2. WHEN Phase_C receives form_data, THE System SHALL prioritize input_text actions for fields matching form_data keys
3. WHEN all form fields are filled, THE System SHALL propose a tap action on the submit button
4. IF a form field in form_data does not exist in the UI, THEN THE System SHALL log a warning and continue
5. THE System SHALL match form_data keys to UI elements using fuzzy matching on resource_id, content_desc, and text

### Requirement 29: Scenario Hints Processing

**User Story:** As a QA engineer, I want hints to guide the AI without being prescriptive, so that the AI can adapt to UI changes.

#### Acceptance Criteria

1. WHEN hints.expected_screens is provided, THE System SHALL pass it to Phase_C as context
2. WHEN hints.required_actions is provided, THE System SHALL pass it to Phase_C as suggested actions
3. WHEN hints.avoid_actions is provided, THE System SHALL pass it to Phase_D for validation
4. THE System SHALL treat hints as suggestions, not strict requirements
5. IF the AI cannot follow a hint, THEN THE System SHALL log a warning and continue with an alternative action

### Requirement 30: Scenario Execution State Persistence

**User Story:** As a developer, I want scenario execution state to be persisted, so that runs can be resumed after crashes.

#### Acceptance Criteria

1. WHEN a scenario execution starts, THE System SHALL create a state file in {state_dir}/{run_id}.json
2. WHEN an action completes, THE System SHALL update the state file with current goal progress
3. IF the system crashes during execution, THEN THE System SHALL detect the incomplete run on restart
4. THE Desktop_UI SHALL offer to resume incomplete runs
5. WHEN a run completes, THE System SHALL delete the state file

---

## Non-Functional Requirements

### Requirement 31: Performance

**User Story:** As a QA engineer, I want scenarios to execute efficiently, so that I can run tests quickly.

#### Acceptance Criteria

1. THE System SHALL execute actions with a maximum delay of 2 seconds between steps
2. THE System SHALL evaluate success criteria in less than 500ms per criterion
3. THE System SHALL generate final reports in less than 5 seconds
4. THE System SHALL support concurrent execution of multiple scenarios on different devices

### Requirement 32: Reliability

**User Story:** As a QA engineer, I want scenario execution to be reliable, so that I can trust the results.

#### Acceptance Criteria

1. THE System SHALL achieve a goal completion rate of at least 80% for well-formed scenarios
2. THE System SHALL detect and recover from transient device communication errors
3. THE System SHALL avoid navigation loops by respecting seen_element_keys and loop_count
4. THE System SHALL handle app crashes gracefully and report them as findings

### Requirement 33: Usability

**User Story:** As a QA engineer, I want the UI to be intuitive, so that I can create and run scenarios without extensive training.

#### Acceptance Criteria

1. THE Desktop_UI SHALL provide tooltips for all scenario builder fields
2. THE Desktop_UI SHALL show validation errors inline as the user types
3. THE Desktop_UI SHALL provide keyboard shortcuts for common actions (Ctrl+S to save, Ctrl+R to run)
4. THE Desktop_UI SHALL remember the last selected scenario and mode across sessions

### Requirement 34: Security

**User Story:** As a QA engineer, I want credentials to be stored securely, so that sensitive data is protected.

#### Acceptance Criteria

1. THE System SHALL encrypt credentials at rest using AES-256
2. THE System SHALL never log credentials in plain text
3. THE System SHALL mask password fields in the UI
4. THE System SHALL support environment variable substitution for credentials (e.g., ${TEST_PASSWORD})

### Requirement 35: Extensibility

**User Story:** As a developer, I want the scenario schema to be extensible, so that new goal types can be added easily.

#### Acceptance Criteria

1. THE System SHALL support adding new goal types without modifying existing code
2. THE System SHALL allow custom success criteria evaluators to be registered
3. THE System SHALL support plugin-based scenario templates
4. THE System SHALL provide a JSON schema for scenario validation

---

## Phase 1 (Foundation) Requirements Summary

For Phase 1 implementation, the following requirements are in scope:

- **Requirement 1**: Scenario Definition System
- **Requirement 2**: Scenario Validation
- **Requirement 3**: Enhanced State Management
- **Requirement 4**: Goal Progress Tracking
- **Requirement 23**: Scenario Storage and Retrieval
- **Requirement 27**: Scenario Constraints Enforcement
- **Requirement 30**: Scenario Execution State Persistence

These requirements establish the foundation for scenario-based testing without requiring UI or multi-agent changes. They fix critical state management issues and enable scenario definition and validation.

