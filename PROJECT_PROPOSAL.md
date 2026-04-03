# Tezzy: Local-First AI-Assisted Mobile QA Testing System

**Student Name:** [Your Name]  
**Student ID:** [Your Student ID]  
**Email:** [Your Email]  
**Programme:** BSc (Hons) Computer Science  
**Supervisor:** Prof. Ruvan Abeysekara  
**Contact:** ssm@nexteducationgroup.com  
**Date:** April 2, 2026

---

## Introduction and Rationale

Mobile application quality assurance presents a critical bottleneck for solo developers and startups. Hiring a dedicated QA engineer costs $50,000-$80,000 annually—an impossible expense for indie developers and early-stage startups. Manual testing by developers themselves is time-consuming, inconsistent, and prone to missing critical UI defects. These missed issues frequently result in Play Store rejections, with each rejection-fix-resubmission cycle consuming 3-7 days and delaying revenue generation.

The consequences are severe: a single Flutter overflow error or misaligned button can trigger app store rejection, forcing developers to restart the submission process. For startups operating on tight budgets and aggressive timelines, these delays can mean the difference between securing funding and running out of runway.

Tezzy addresses these challenges by providing an affordable, local-first AI-assisted mobile QA testing system specifically designed for solo developers and small teams. The system connects to Android devices via USB, autonomously navigates mobile applications, and detects visual defects including Flutter overflow errors, UI misalignments, and interaction failures—all while keeping sensitive data completely local to the developer's machine. By automating the QA process, Tezzy enables solo developers to achieve professional-grade testing quality without the cost of hiring QA staff.

The project represents a strategic pivot from fully autonomous exploration (40-50% success rate) to AI-assisted scenario-based testing (targeting >80% success rate), addressing critical reliability issues while preserving all visual defect detection capabilities. This transformation makes Tezzy production-ready for real QA teams who require predictable, reproducible test coverage.

The need for this project stems from four critical challenges faced by solo developers and startups:

1. **Cost barriers**: Hiring dedicated QA engineers is prohibitively expensive for solo developers and early-stage startups, with salaries ranging from $50,000-$80,000 annually. Most indie developers cannot afford this investment during initial development phases.

2. **Manual testing limitations**: Solo developers performing manual testing often miss critical UI issues due to testing fatigue, limited device coverage, and lack of systematic test coverage. These missed issues frequently lead to app rejections during Play Store submission, resulting in costly delays and resubmission cycles.

3. **Play Store rejection costs**: App store rejections due to UI bugs, crashes, or rendering issues can delay product launches by weeks. Each rejection-fix-resubmission cycle consumes 3-7 days, directly impacting time-to-market and revenue generation for startups operating on tight budgets.

4. **Privacy concerns for sensitive apps**: Existing cloud-based AI testing tools require uploading app data and screenshots to external servers, making them unsuitable for fintech, healthcare, and enterprise applications where data privacy is non-negotiable

Tezzy solves these problems by combining local-first architecture (all data stays on the developer's machine), AI-assisted testing (user defines what to test, AI figures out how), and intelligent visual defect detection (GPT-4o Vision analyzes screenshots for rendering issues).

---

## Aims and Objectives

### Project Aims

1. **Develop a production-ready AI-assisted mobile QA testing system** that achieves >80% goal completion rate while preserving all visual defect detection capabilities
2. **Implement a local-first architecture** that ensures complete data privacy for fintech and healthcare applications
3. **Create an intuitive scenario-based testing framework** that enables QA engineers to define test flows without writing code
4. **Integrate multi-agent AI systems** for intelligent screen understanding, adaptive navigation, and visual defect detection

### Project Objectives

#### Objective 1: Scenario Definition and Validation System
- Implement JSON-based scenario schema supporting login, navigation, form filling, and verification goals
- Create scenario validation logic that checks required fields, credentials, and success criteria
- Develop scenario storage and retrieval system with file-based persistence
- Implement scenario templates library with 8+ common test patterns

#### Objective 2: Enhanced State Management
- Fix broken memory tracking (seen_element_keys, loop_count, no_element_count)
- Implement goal progress tracking with real-time status updates
- Create execution state persistence for crash recovery
- Develop completed screens tracking to prevent redundant exploration

#### Objective 3: Multi-Agent System Integration
- Enhance Phase A (Session Bootstrap) to consume scenario context and initialize with credentials
- Enhance Phase C (Planner) to receive goal context and make goal-directed decisions
- Enhance Phase D (Critic Gate) to validate actions against goal constraints
- Enhance Phase F (Issue Triage) to tag findings with goal context
- Enhance Phase H (Final Report) to generate scenario-based reports with goal-by-goal results

#### Objective 4: Desktop UI Components
- Design and implement Scenario Builder UI for visual scenario creation
- Create Scenario Library UI displaying templates and saved scenarios
- Enhance Smoke Check Panel with scenario execution mode and real-time progress tracking
- Develop Scenario Results Panel showing goal completion status and findings

#### Objective 5: Testing and Validation
- Conduct integration testing with real Android applications (minimum 3 apps)
- Validate visual defect detection accuracy against manual inspection
- Measure goal completion rate and compare against 80% target
- Test with fintech and healthcare applications to validate privacy guarantees

#### Objective 6: Documentation and Deployment
- Create comprehensive technical documentation covering architecture, API endpoints, and scenario schema
- Develop user guide with scenario creation examples and best practices
- Prepare deployment package with installation instructions for Windows, macOS, and Linux
- Document CI/CD integration patterns for automated testing pipelines

---

## Expected Outcomes and Deliverables

### Primary Deliverable: Tezzy Desktop Application

A fully functional desktop application built with Tauri (Rust + React) that provides:

1. **Scenario Builder Interface**: Visual form-based scenario creation with drag-and-drop goal ordering, credential management, and success criteria definition
2. **Scenario Library**: Pre-built templates and saved scenarios with search, filtering, and last-run status display
3. **Enhanced Smoke Check Panel**: Dual-mode execution (scenario-based and autonomous) with real-time progress tracking, goal completion indicators, and live findings count
4. **Scenario Results Panel**: Detailed results view with goal-by-goal breakdown, action logs, findings grouped by goal, and markdown report export

### Secondary Deliverable: AI Engine Backend

A Python FastAPI backend implementing an 8-phase multi-agent system:

1. **Phase A - Session Bootstrap**: Initializes test runs with scenario context, credentials, and goal planning
2. **Phase B - Screen Analyst**: Classifies screen types and identifies interaction targets
3. **Phase C - Planner**: Proposes goal-directed actions with intelligent adaptation to UI changes
4. **Phase D - Critic Gate**: Validates actions against constraints and prevents loops
5. **Phase E - Vision Analyst**: Detects visual defects using GPT-4o Vision (overflow, misalignment, text errors)
6. **Phase F - Issue Triage**: Combines runtime signals with vision findings and assigns severity
7. **Phase G - Improvement Advisor**: Generates actionable recommendations for developers
8. **Phase H - Final Report**: Produces comprehensive markdown QA reports with goal results

### Technical Documentation

1. **Architecture Document**: System components, data flow diagrams, API specifications, and integration patterns
2. **Scenario Schema Reference**: Complete JSON schema with examples for all goal types
3. **User Guide**: Step-by-step instructions for creating scenarios, running tests, and interpreting results
4. **Developer Guide**: Setup instructions, API documentation, and extension points for custom goal types

### Testing Artifacts

1. **Integration Test Suite**: Automated tests covering scenario validation, goal execution, and state management
2. **Test Reports**: Results from testing with 3+ real Android applications showing goal completion rates and defect detection accuracy
3. **Performance Benchmarks**: Execution time, token usage, and success rate metrics

### Research Outputs

1. **Comparative Analysis**: Evaluation of fully autonomous vs AI-assisted approaches with quantitative metrics
2. **Prompt Engineering Documentation**: Analysis of multi-agent prompt quality and optimization recommendations
3. **Privacy Architecture Report**: Documentation of local-first design decisions and security guarantees

---

## Methodology

This project follows an iterative Agile software development methodology combined with research-driven prompt engineering and multi-agent system design.

### Development Approach

**Agile Methodology with 2-Week Sprints:**
- Sprint planning sessions to define user stories and acceptance criteria
- Daily progress tracking with task completion updates
- Sprint reviews to demonstrate working features
- Sprint retrospectives to identify improvements

**Spec-Driven Development:**
- Requirements document defining functional and non-functional requirements (35 requirements documented)
- Design document specifying architecture, data models, and API contracts
- Task breakdown with property-based testing for correctness validation
- Iterative refinement based on testing feedback

### Research Methodology

**Literature Review:**
- Survey of existing mobile testing frameworks (Appium, Espresso, XCUITest)
- Analysis of AI agent architectures (LangGraph, AutoGPT, BabyAGI)
- Study of prompt engineering techniques for multi-agent systems
- Review of visual defect detection methods using computer vision and LLMs

**Comparative Analysis:**
- Quantitative comparison of autonomous vs scenario-based approaches
- Success rate measurement across different application types
- Token usage and cost analysis for different LLM configurations
- Performance benchmarking against traditional automation frameworks

**Iterative Prompt Engineering:**
- Systematic evaluation of each agent phase's prompt quality
- A/B testing of prompt variations with real test scenarios
- Optimization based on failure pattern analysis
- Documentation of prompt design principles and best practices

### Implementation Phases

**Phase 1 - Foundation (Weeks 1-2):**
- Implement scenario type definitions and JSON schema
- Create scenario validation logic
- Fix state management issues (seen_element_keys, loop_count, completed_screens)
- Develop goal progress tracking system
- Implement scenario storage and retrieval

**Phase 2 - Multi-Agent Integration (Weeks 3-5):**
- Enhance Phase A to consume scenario context
- Enhance Phase C with goal-directed planning
- Enhance Phase D with constraint validation
- Enhance Phase F with goal tagging
- Enhance Phase H with scenario-based reporting
- Fix prompt quality issues in all phases

**Phase 3 - Desktop UI Components (Weeks 6-8):**
- Design and implement Scenario Builder UI
- Create Scenario Library with templates
- Enhance Smoke Check Panel with scenario mode
- Develop Scenario Results Panel
- Implement real-time progress tracking

**Phase 4 - Testing and Refinement (Weeks 9-11):**
- Integration testing with real Android applications
- Visual defect detection accuracy validation
- Goal completion rate measurement
- Performance optimization (reduce token usage, eliminate duplicate calls)
- User experience refinement based on testing feedback

**Phase 5 - Documentation and Deployment (Weeks 12-13):**
- Write comprehensive technical documentation
- Create user guide with examples
- Prepare deployment packages for multiple platforms
- Document CI/CD integration patterns
- Finalize project report and presentation

### Testing Strategy

**Unit Testing:**
- Scenario validation logic
- State management functions
- Success criteria evaluation
- Constraint enforcement

**Integration Testing:**
- End-to-end scenario execution with mock device
- Multi-agent pipeline with test scenarios
- API endpoint testing with various inputs
- Error handling and recovery paths

**System Testing:**
- Real device testing with 3+ Android applications
- Visual defect detection accuracy measurement
- Goal completion rate validation
- Performance and reliability testing

**Property-Based Testing:**
- Scenario validation properties (all valid scenarios pass, all invalid scenarios fail)
- State management properties (seen_element_keys never contains duplicates, loop_count increments correctly)
- Goal progress properties (status transitions are valid, criteria_met + criteria_pending = total criteria)

---

## Resource Requirements

### Hardware Resources

1. **Development Machine**: Windows PC with 16GB+ RAM for running Tauri development environment, Python backend, and Android emulator
2. **Android Test Devices**: Minimum 2 physical Android devices (Android 8.0+) for testing different screen sizes and OS versions
3. **USB Cables**: High-quality USB cables for stable device connections during extended test runs

### Software Resources

1. **Development Tools**:
   - Visual Studio Code or similar IDE
   - Git for version control
   - Node.js 18+ and npm for frontend development
   - Python 3.12+ and pip for backend development
   - Rust toolchain for Tauri development

2. **Mobile Testing Infrastructure**:
   - Android SDK and ADB (Android Debug Bridge)
   - Appium 2.x server for device automation
   - scrcpy for screen mirroring
   - Android emulator for initial testing

3. **AI Services**:
   - OpenAI API access for GPT-4.1-mini (text) and GPT-4o (vision)
   - API credits budget: Estimated $50-100 for development and testing

4. **Libraries and Frameworks**:
   - Tauri 1.x for desktop application shell
   - React 18 + TypeScript for frontend UI
   - FastAPI for Python backend
   - LangGraph for multi-agent orchestration
   - Pydantic for data validation

### Access Requirements

1. **Test Applications**: Access to 3+ Android applications for testing:
   - One open-source app for initial development
   - One fintech/banking app (with test credentials) for privacy validation
   - One healthcare/medical app for compliance testing

2. **Documentation Access**:
   - Appium documentation and API reference
   - OpenAI API documentation
   - LangGraph documentation
   - Android UI Automator documentation

3. **Research Publications**:
   - IEEE Xplore for papers on automated testing
   - ACM Digital Library for AI agent research
   - arXiv for recent LLM and vision model papers

---

## Bibliography & References

1. Dawson, C. (2015). *Projects in Computing and Information Systems: A Student Guide* (3rd ed.). Pearson Education. [Project management and planning methodology]

2. Gamma, E., Helm, R., Johnson, R., & Vlissides, J. (1994). *Design Patterns: Elements of Reusable Object-Oriented Software*. Addison-Wesley. [Software architecture patterns]

3. Wohlin, C., Runeson, P., Höst, M., Ohlsson, M. C., Regnell, B., & Wesslén, A. (2012). *Experimentation in Software Engineering*. Springer. [Research methodology for software engineering]

4. OpenAI. (2024). *GPT-4 Technical Report*. arXiv:2303.08774. [Foundation for vision-based defect detection]

5. Chase, H. (2023). *LangChain: Building Applications with LLMs*. LangChain Documentation. https://python.langchain.com/docs/ [Multi-agent system architecture]

6. Appium Project. (2024). *Appium Documentation*. http://appium.io/docs/en/latest/ [Mobile automation framework]

7. Memon, A., Banerjee, I., & Nagarajan, A. (2003). "GUI Testing: Pitfalls and Process." *IEEE Computer*, 36(4), 87-88. [Automated UI testing challenges]

---

## Project Plan

### Work Breakdown Structure

The project is organized into 4 major work areas, each broken down into concrete activities with estimated durations and descriptions.


| No. | Activities | Estimate Duration | Activity Description |
|-----|------------|-------------------|----------------------|
| **Area 1: Foundation and State Management** | | | |
| 1 | Literature Review | 2 weeks | Survey existing mobile testing frameworks (Appium, Espresso), AI agent architectures (LangGraph, AutoGPT), and prompt engineering techniques. Critical review of 5-7 authoritative sources on automated testing and multi-agent systems. |
| 2 | Scenario Schema Design | 2 weeks | Design JSON schema for scenario definition including goals, credentials, success criteria, and constraints. Implement validation logic and create 8+ scenario templates. |
| 3 | State Management Refactoring | 2 weeks | Fix broken memory tracking (seen_element_keys, loop_count, no_element_count). Implement completed_screens tracking and execution state persistence for crash recovery. |
| **Area 2: Multi-Agent System Enhancement** | | | |
| 4 | Phase A Enhancement | 2 weeks | Modify Session Bootstrap agent to consume scenario context, extract credentials, and initialize with proper mode (reach_home vs explore). |
| 5 | Phase C & D Enhancement | 3 weeks | Enhance Planner to receive goal context and make goal-directed decisions. Enhance Critic Gate to validate actions against goal constraints. Fix prompt quality issues. |
| 6 | Phase F & H Enhancement | 2 weeks | Enhance Issue Triage to tag findings with goal context. Enhance Final Report to generate scenario-based reports with goal-by-goal results. Fix user prompt templates. |
| 7 | API Endpoint Development | 2 weeks | Implement /v1/scenario/execute, /v1/scenario/validate, and /v1/scenario/templates endpoints. Update existing endpoints to accept scenario context. |
| **Area 3: Desktop UI Development** | | | |
| 8 | Scenario Builder UI | 3 weeks | Design and implement visual scenario builder with form fields, goal management, drag-and-drop reordering, and validation feedback. |
| 9 | Scenario Library UI | 2 weeks | Create scenario library displaying templates and saved scenarios with search, filtering, and last-run status. Implement import/export functionality. |
| 10 | Enhanced Smoke Check Panel | 2 weeks | Add scenario execution mode with real-time progress tracking, goal completion indicators, and live findings display. Maintain backward compatibility with autonomous mode. |
| 11 | Scenario Results Panel | 2 weeks | Develop results view with goal-by-goal breakdown, action logs, findings grouped by goal, and markdown report export. |
| **Area 4: Testing, Optimization, and Documentation** | | | |
| 12 | Integration Testing | 2 weeks | Test with 3+ real Android applications (open-source, fintech, healthcare). Validate visual defect detection accuracy and goal completion rates. |
| 13 | Performance Optimization | 2 weeks | Eliminate duplicate vision calls, optimize token usage, implement adaptive step delays, and parallelize vision and UI snapshot operations. |
| 14 | Documentation and Deployment | 2 weeks | Write technical documentation, user guide, and developer guide. Prepare deployment packages and finalize project report. |
| | **Total Duration** | **28 weeks** | |

### Project Milestones

The project includes 5 major milestones aligned with the work breakdown structure:

**Milestone 1 (Week 4): Foundation Complete**
- Scenario schema designed and validated
- State management issues fixed
- Scenario storage system implemented
- Deliverable: Working scenario validation and storage system

**Milestone 2 (Week 9): Multi-Agent Integration Complete**
- All 8 phases enhanced with scenario support
- API endpoints implemented and tested
- Prompt quality issues resolved
- Deliverable: Functional scenario execution via API

**Milestone 3 (Week 16): Desktop UI Complete**
- All UI components implemented
- Scenario Builder and Library functional
- Real-time progress tracking working
- Deliverable: End-to-end scenario creation and execution via UI

**Milestone 4 (Week 20): Testing and Optimization Complete**
- Integration testing with real apps completed
- Goal completion rate >80% achieved
- Performance optimizations implemented
- Deliverable: Production-ready system with validated metrics

**Milestone 5 (Week 28): Project Finalization**
- All documentation completed
- Deployment packages prepared
- Final report and presentation ready
- Deliverable: Complete project submission

```
                                    M5 (Ultimate Aim)
                                         ○
                                        /
                                       /
                          M4          /
                           ○─────────/
                          /
                         /
            M3         /
             ○────────/
            /
           /
   M2     /
    ○────/
   /
  /
 ○ Start
M1

Milestone 1: Foundation Complete (Week 4)
Milestone 2: Multi-Agent Integration Complete (Week 9)
Milestone 3: Desktop UI Complete (Week 16)
Milestone 4: Testing and Optimization Complete (Week 20)
Milestone 5: Project Finalization (Week 28)
```

### Project Activity Sequencing

The activities follow a logical sequence with some parallel work:

**Sequential Dependencies:**
- Activity 1 (Literature Review) must complete before Activity 2 (Scenario Schema Design)
- Activity 3 (State Management) must complete before Activity 4-6 (Multi-Agent Enhancement)
- Activities 4-7 (Multi-Agent System) must complete before Activities 8-11 (Desktop UI)
- Activities 8-11 (Desktop UI) must complete before Activity 12 (Integration Testing)
- Activity 12 (Integration Testing) must complete before Activity 13 (Performance Optimization)

**Parallel Opportunities:**
- Activities 4, 5, 6 (Phase enhancements) can be developed concurrently after Activity 3 completes
- Activities 8, 9, 10, 11 (UI components) can be developed concurrently after Activity 7 completes
- Activity 7 (API Endpoints) can start while Activities 5-6 are in progress

**Concurrent Work:**
- Literature review (Activity 1) continues throughout the project as new research emerges
- Documentation (Activity 14) begins in Week 1 and continues incrementally throughout

### Project Gantt Chart

```
Activity                          | Weeks
                                  | 1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28
----------------------------------|-----------------------------------------------------------------------------------------
1. Literature Review              |████████                                                                              M1
2. Scenario Schema Design         |    ████████                                                                           
3. State Management Refactoring   |        ████████                                                                       
4. Phase A Enhancement            |            ████████                                                                   
5. Phase C & D Enhancement        |            ████████████████                                                           M2
6. Phase F & H Enhancement        |                    ████████                                                           
7. API Endpoint Development       |                        ████████                                                       
8. Scenario Builder UI            |                            ████████████████                                           
9. Scenario Library UI            |                                    ████████                                           
10. Enhanced Smoke Check Panel    |                                        ████████                                       M3
11. Scenario Results Panel        |                                            ████████                                   
12. Integration Testing           |                                                    ████████                           
13. Performance Optimization      |                                                            ████████                   M4
14. Documentation and Deployment  |                                                                    ████████████████   M5
                                  |
Milestones:                       |    M1          M2                  M3              M4                              M5
```

**Legend:**
- `████` = Active work period
- `M1-M5` = Milestone markers
- Weeks measured from project start date

**Key Observations:**
- Total project duration: 28 weeks (approximately 7 months)
- Critical path: Activities 1→2→3→5→7→10→12→13→14
- Parallel work opportunities in Weeks 9-16 (multi-agent and UI development)
- Buffer time included in testing and documentation phases for unexpected issues

---

## Risk Assessment and Mitigation

### Technical Risks

**Risk 1: OpenAI API Rate Limits or Cost Overruns**
- **Likelihood**: Medium
- **Impact**: High
- **Mitigation**: Implement token usage monitoring, use smaller models for simple tasks (Critic, Triage), cache repeated screen analyses, set daily spending limits

**Risk 2: Device Connection Instability**
- **Likelihood**: Medium
- **Impact**: Medium
- **Mitigation**: Implement automatic session recovery, add connection health checks, provide clear error messages, test with multiple USB cables and ports

**Risk 3: Prompt Engineering Challenges**
- **Likelihood**: High
- **Impact**: Medium
- **Mitigation**: Systematic prompt evaluation framework, A/B testing of variations, maintain prompt version history, document failure patterns

### Project Management Risks

**Risk 4: Scope Creep**
- **Likelihood**: Medium
- **Impact**: High
- **Mitigation**: Strict adherence to requirements document, phase-based delivery with clear acceptance criteria, regular supervisor check-ins

**Risk 5: Timeline Delays**
- **Likelihood**: Medium
- **Impact**: Medium
- **Mitigation**: 2-week buffer built into schedule, parallel work where possible, weekly progress tracking, early identification of blockers

### Academic Risks

**Risk 6: Insufficient Differentiation from Existing Tools**
- **Likelihood**: Low
- **Impact**: High
- **Mitigation**: Emphasize local-first architecture (unique in market), document comparative analysis with existing tools, highlight AI-assisted approach vs fully autonomous

---

## Ethical Considerations

### Data Privacy

The local-first architecture ensures that all test data, screenshots, and credentials remain on the user's machine. No data is transmitted to cloud services except OpenAI API calls for vision analysis (screenshots only, no credentials). This design is essential for testing fintech and healthcare applications with sensitive user data.

### AI Usage and Academic Integrity

This project uses AI (GPT-4o, GPT-4.1-mini) as the subject of study and as a component of the system being built. All AI-generated code and content is properly attributed, and the project represents original research in applying multi-agent AI systems to mobile QA testing. The use of AI tools (including Kiro IDE) for development assistance is documented and referenced appropriately.

### Responsible Testing

The system is designed for testing applications in development environments, not production systems. Users are responsible for ensuring they have proper authorization to test applications and that test credentials are used only in appropriate environments.

---

## Success Criteria

The project will be considered successful if:

1. **Goal Completion Rate**: Achieves >80% goal completion rate across 10+ test scenarios with 3+ real Android applications
2. **Visual Defect Detection**: Maintains 100% of existing defect detection capabilities (overflow, misalignment, text errors, dead buttons)
3. **State Management**: Eliminates navigation loops and memory tracking issues (zero loop failures in 20+ test runs)
4. **User Experience**: QA engineers can create and execute scenarios without writing code or reading technical documentation
5. **Privacy Guarantee**: All test data remains local with zero cloud storage dependencies (verified through network traffic analysis)
6. **Documentation Quality**: Technical documentation, user guide, and developer guide are complete and enable independent use of the system

---

## Alignment with Programme Learning Outcomes

This project directly addresses the BSc Computer Science programme learning outcomes:

**LO1 - Knowledge and Understanding**: Demonstrates deep understanding of AI agent systems, multi-agent coordination, software architecture, and mobile automation frameworks

**LO2 - Cognitive Skills**: Applies critical thinking to evaluate autonomous vs assisted approaches, analyzes trade-offs, and makes evidence-based architectural decisions

**LO3 - Practical Skills**: Implements complex software system integrating multiple technologies (Rust, Python, React, AI APIs, mobile automation)

**LO4 - Transferable Skills**: Develops project management skills through Agile methodology, technical communication through documentation, and problem-solving through iterative development

**LO9 - Project Management**: Applies SMART objectives, WBS, Gantt charts, milestone tracking, and risk management throughout the project lifecycle

---

## Conclusion

Tezzy represents a novel approach to mobile QA testing that combines the intelligence of multi-agent AI systems with the reliability and privacy of local-first architecture. The strategic pivot from fully autonomous to AI-assisted testing addresses critical reliability issues while preserving all visual defect detection capabilities, making the system production-ready for real QA teams.

The project demonstrates advanced technical skills across multiple domains (AI, mobile automation, desktop development, backend systems), applies rigorous software engineering methodology, and delivers practical value for fintech and healthcare sectors where data privacy is paramount.

With a clear 28-week plan, well-defined milestones, and comprehensive risk mitigation strategies, this project is feasible, achievable, and aligned with the BSc Computer Science programme requirements.

---

**End of Proposal**
