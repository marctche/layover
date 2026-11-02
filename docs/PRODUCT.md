# Layover: Product

## Problem

Planning a multi-city international trip with friends happens in group chats. Preferences get lost in scrollback, nobody knows which routes are actually feasible, costs are guesses, and private budget limits are either overshared or ignored. Decisions stall because no one can see what is blocking them.

## What Layover is

A shared planning workspace. The group:
- proposes destinations;
- states preferences and constraints;
- compares feasible itineraries with real cost and time trade-offs;
- resolves disagreements through structured decisions;
- approves a versioned trip plan.

Core loop: **Propose → Compare → Understand → Discuss → Decide → Recalculate → Approve**

It is not a chatbot, a recommendation generator, or a static itinerary builder.

## Reference scenario

Four friends plan an Asia trip. Candidate cities: Tokyo, Seoul, Beijing, Chongqing, Shenzhen, Hong Kong. Each traveler has a private budget ceiling and limited dates. A fixed event in Hong Kong anchors the itinerary.

Questions Layover answers for this group:

- Which destinations does everyone actually want?
- Which routes are feasible under the constraints?
- What is the cheapest sensible sequence?
- What changes if we add or drop a city?
- What does each traveler pay?
- Is a destination worth its marginal cost and travel time?
- Which open decisions are blocking finalization?

## Roles

- **Coordinator:** creates the trip and invites members. Has no special access to private budgets.
- **Member (traveler):** suggests destinations, sets preferences, sets their own private budget, answers decision cards, approves proposals.

## Features

### Core loop
1. Shared trip creation and invitations.
2. Destination suggestions and per-traveler preferences.
3. Constraints: trip window, fixed events, minimum stays, and private per-traveler budgets.
4. Route generation and side-by-side comparison with per-person costs.
5. Group proposal and unanimous approval, with versioned itineraries.
6. Persistent decision history.

### Differentiators
- **AI decision cards:** questions grounded in the calculated marginal cost and time of a choice.
- **Scenario simulation:** "what if we drop Seoul?"
- **Private budget signals:** each traveler sees their own budget fit; the group sees only an anonymous count.
- **Natural-language constraints:** "I can't leave before the 12th" becomes a validated, structured constraint.

## Product rules

- **Private budgets:** visible only to their owner. Other members, including the coordinator, never see the number.
- **Budget signals:** each traveler sees their own fit. The group sees only a count of travelers over budget per route, and only when the group has 3 or more members.
- **Unanimous approval:** major itinerary commitments require approval from every affected traveler.
- **Versioning:** approved itineraries are versioned, and proposals never overwrite them.
- **AI proposes, humans decide:** the AI never approves, edits another traveler's data, or raises budgets.
- **Price sources:** every price shows its source (live, manual, estimate, synthetic) and its age.
