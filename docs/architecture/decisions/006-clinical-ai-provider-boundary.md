# ADR-006: Clinical AI behind a provider interface, never in the decision path

- **Status:** Proposed. No clinical AI service exists.
- **Date:** 2026-11-03
- **Deciders:** Architecture, Clinical safety, Security
- **Related:** `apps/clinical-ai/AGENTS.md`, `infrastructure/AGENTS.md`

## Context

Almonac intends to offer clinical AI: summarisation, drafting, coding suggestions, chart search. The current directory structure anticipates an `apps/clinical-ai` service.

This area carries risks that ordinary features do not: PHI leaving the platform, model providers retaining data, non-deterministic output being mistaken for a clinical determination, and vendor lock-in at the moment the provider changes pricing. It is also unbuilt, so any decision here is a constraint on the future, not a description.

## Decision

- **No model provider is chosen yet.** The service is defined by an interface, and the provider is an implementation detail behind it.
- **The AI service is a separate deployable**, with its own credentials. It has no direct database access; it receives a scoped, minimal payload from the API and returns a structured suggestion.
- **PHI minimisation at the boundary**: send the least data needed, prefer identifiers over full records, and never send a whole chart because it is convenient.
- **No PHI to a third-party provider without a signed agreement** covering processing, retention and location. Until that exists, only synthetic or de-identified data may be sent to an external model.
- **Output is a suggestion, never an autonomous action.** Every AI output is attributed, labelled as AI-generated, and requires an explicit human action to enter the record. The UI must not pre-fill a signed field.
- **Audit every invocation**: who asked, what context was sent (by reference, not content), which model and version, what was returned, and whether it was accepted.
- **Deterministic fallback**: clinical workflows must remain fully usable with the AI service unavailable. No workflow may block on a model call.

## Consequences

Positive:

- The provider can be swapped (or self-hosted) without touching clinical features.
- PHI exposure is a reviewable boundary rather than an implicit consequence of a feature.
- Clinicians see provenance and remain the decision-makers.

Negative:

- An extra service to operate, monitor and secure, for a capability that may not ship for some time.
- The interface must be designed before the use cases are fully known; expect revision.
- Latency and cost of model calls are outside the request path and require async handling for anything slow.

## Alternatives considered

- **Call the model directly from the API.** Fewer moving parts, but mixes PHI handling, rate limiting and prompt logic into the transactional service, and makes it impossible to scale or restrict the AI workload independently. Rejected.
- **Embed a vendor SDK in the frontend.** Would expose credentials and send PHI from the browser. Rejected outright.

## Follow-ups

- Decide the first concrete use case (summarisation is the least risky) and design the interface around it.
- Legal review of provider agreements and data residency before any real PHI is processed.
- Define the evaluation and red-team process for clinical suggestions, and what "acceptable" means.
- Decide retention of prompts and outputs — they can themselves contain PHI.
