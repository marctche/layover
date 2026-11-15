# Layover: Product

## Problem

Planning a multi-city international trip with friends happens in group chats. Preferences get lost in scrollback, nobody knows which routes are actually feasible, costs are guesses, and private budget limits are either overshared or ignored.

## What Layover is

A shared planning workspace for group trips. The group:
- proposes destinations;
- states preferences and constraints;
- compares feasible itineraries with cost and time trade-offs;
- keeps each traveler's budget private.

It is not a chatbot, a recommendation generator, or a static itinerary builder.

## Reference scenario

Four friends plan an Asia trip. Candidate cities: Tokyo, Seoul, Beijing, Chongqing, Shenzhen, Hong Kong. Each traveler has a private budget and limited dates. A fixed event in Hong Kong anchors the itinerary.

Questions the route engine answers for this group:

- Which routes are feasible under the constraints?
- What is the cheapest sensible sequence?
- What changes if we drop a city?

## Roles

- **Coordinator:** creates the trip, invites members, sets trip dates, constraints and manual quotes. Has no special access to private budgets.
- **Member (traveler):** suggests destinations, sets preferences, sets their own private budget and availability.

## Features

- **Sign-in.** Google or an emailed 6-digit code, with a required display name.
- **Trips and invitations.** A coordinator creates a trip and shares a reusable invite link. The link previews the trip name, the inviter and the member count, and joining requires explicit confirmation. Links can be revoked, and the coordinator can remove a member.
- **Destinations and preferences.** Members add candidate cities from a searchable catalog and score each from -2 to 2. Scores are visible to the group.
- **Constraints.** Confirmed trip dates or an approximate window with a length range, start and end city, departure airport, minimum and maximum nights per city, must-visit cities, locked order, fixed events, and each member's availability.
- **Budgets and bands.** Each traveler enters an exact budget privately. The rest of the group sees only the band it falls in: under 2,000, 2,000 to 3,000, 3,000 to 4,000, or 4,000 or more.
- **Quotes.** Leg and long-haul fares carry their source (live, manual, estimate or synthetic) and an expiry. The coordinator can add manual quotes.
- **Route engine and saved scenarios.** The engine generates feasible routes under the hard constraints, compares them on cost, travel time, transfers and satisfaction, labels meaningfully different options, and simulates dropping a city. Runs are saved with their exact input.
- **Plan services.** Server-side services for trip constraints, candidate cities, availability, quotes and scenarios, with coordinator-only writes where the data is shared.

## Product rules

- **Private budgets:** the exact amount is visible only to its owner. Other members, including the coordinator, see only the band.
- **Hard constraints first:** fixed events, minimum stays and trip dates are never silently relaxed.
- **Price sources:** every price carries its source and age. Estimates and synthetic prices are never labeled as live.
