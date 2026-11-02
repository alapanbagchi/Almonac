# Almonac Clinical AI — FastAPI on Python

**Status: not implemented.** `apps/clinical-ai` has no `pyproject.toml`, no source and no installed FastAPI version. Everything here is the intended architecture. When you implement it, pin versions in `pyproject.toml`, read the docs for those versions, and replace any example below that does not match. Do not copy FastAPI tutorials written for Pydantic v1.

This service handles specialised workloads only: clinical NLP, document extraction, model inference and data processing. Elysia remains the primary backend and the only service that talks to hospital databases.

## 1. Boundaries

- Python is **not** a second source of truth. It does not own patients, encounters, orders or any hospital record.
- It does not connect to hospital databases by default. If a workload ever needs direct access, it requires an ADR and a read-only, purpose-built interface — not a copy of the hospital schema.
- It does not access the terminology database directly; terminology lookups go through the API.
- Elysia authenticates and authorises the original user request, then calls this service with the minimum data needed: the text, the document, or the identifiers required for the task. Do not send an entire patient record because it is convenient.
- The browser does not call this service directly. Calls are service-to-service.

## 2. Layout

```text
apps/clinical-ai/
├── pyproject.toml
├── src/almonac_ai/
│   ├── main.py              app factory, lifespan, router mounting
│   ├── api/                 routers and endpoint functions
│   │   └── v1/
│   ├── schemas/             Pydantic request/response models
│   ├── services/            use-case orchestration, no FastAPI types
│   ├── domain/              pure logic: parsing, rules, scoring
│   ├── pipelines/           multi-step processing (extract → normalise → code)
│   ├── infrastructure/      model registry, storage, HTTP clients
│   ├── core/                settings, logging, auth dependencies, errors
│   └── tests/
```

| Layer | May import | Must not |
| --- | --- | --- |
| `api/` | schemas, services, core | domain internals, model libraries directly |
| `services/` | domain, pipelines, infrastructure interfaces | `fastapi`, `Request`, `Depends`, HTTP types |
| `domain/` | stdlib, Pydantic models, pure libraries | FastAPI, database, network, filesystem |
| `pipelines/` | domain, infrastructure | request context, auth |
| `infrastructure/` | third-party SDKs, model runtimes | FastAPI routing, business rules |

The rule that matters: `domain/` is pure and unit-testable without a running server, and `services/` never receives a `Request`. Pass explicit typed arguments.

## 3. Application entry point

- Create the app with a factory (`create_app()`) so tests can build an isolated instance with overridden dependencies.
- Load models, tokenizers and heavy clients in the `lifespan` context manager, not at import time and not per request. Import-time loading breaks tests and multiplies memory under workers.
- Mount versioned routers under an explicit prefix. The final public path is decided with the API (unresolved); keep the version in one constant, not scattered through decorators.
- Register exception handlers and middleware in the factory. Configure CORS only for known origins; service-to-service calls do not need permissive CORS.
- Run with a production server (uvicorn/gunicorn workers as appropriate) and a health endpoint that reports readiness only after models load.

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI

from almonac_ai.api.v1 import router as v1_router
from almonac_ai.core.settings import Settings
from almonac_ai.infrastructure.models import ModelRegistry

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.models = ModelRegistry.load(Settings().model_config)
    yield
    app.state.models.close()

def create_app() -> FastAPI:
    app = FastAPI(title="Almonac Clinical AI", version="0.1.0", lifespan=lifespan)
    app.include_router(v1_router, prefix="/v1")
    return app

app = create_app()
```

## 4. Schemas

- Pydantic models for every request and response. `response_model` on every endpoint; never return a bare `dict`.
- Separate models for create, update, read and internal results. Do not expose the persistence model or a model's internal fields by accident.
- Use `Field(...)` for constraints and descriptions; use `model_config = ConfigDict(extra="forbid")` on inputs so unexpected fields fail loudly.
- Use enums and constrained types (`Literal`, `Annotated[str, StringConstraints(...)]`) instead of free-text statuses.
- IDs are opaque strings, not integers assumed to be sequential.
- Never model PHI as an unconstrained `str` blob when structure is known; be explicit about which fields are identifiers.
- Validation errors are translated to the shared error envelope (section 7), not leaked as FastAPI's default body.

```python
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field

class ExtractRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: Annotated[str, Field(min_length=1, max_length=20_000)]
    task: Literal["entities", "sections", "codes"]

class ExtractResponse(BaseModel):
    spans: list[ExtractedSpan]
    model_version: str
```

## 5. Routers and endpoints

- Thin endpoints: validate, call one service function, return the response model. No loops, no model calls, no SQL in the route.
- Depend on things through `Depends`: settings, the model registry, the authenticated service principal, a request ID. Do not reach into `app.state` from deep code.
- One router per resource or task family, with tags and summaries so OpenAPI is usable.
- `async def` only when the work is genuinely async (HTTP, async model client). CPU-bound inference runs in a worker thread or a separate process, never blocking the event loop.
- Enforce timeouts on every outbound call. An endpoint that can run for minutes needs an async job pattern, not a hanging request.

```python
@router.post("/extract", response_model=ExtractResponse, tags=["extraction"])
async def extract(
    payload: ExtractRequest,
    models: ModelRegistry = Depends(get_models),
    principal: ServicePrincipal = Depends(require_service_principal),
) -> ExtractResponse:
    return await extraction_service.run(payload, models, principal)
```

## 6. Services, pipelines, models

- Services orchestrate: authorise the service principal, choose the pipeline, enforce input limits, call domain logic, assemble the response.
- Pipelines are explicit stages with typed inputs and outputs. Each stage is independently testable; failures identify the stage.
- Model loading is centralised in one registry. Pin model identifiers and versions; record the version used in every response that returns model output.
- Inference must be deterministic where possible (fixed seed, documented decoding parameters). Store the parameters alongside the result.
- Never treat generated text as a verified medical fact. Outputs are suggestions with provenance; a licensed user accepts or rejects them. Clinical decision support requires explicit safety review before release.
- Guard against prompt injection and document-borne instructions: clinical text is data, never instructions to the model. Do not give a model tool access to records or the network.
- Limit input size and concurrency; one oversized document must not exhaust memory for every tenant.

## 7. Service communication

- REST + JSON only. No gRPC. Contracts are defined by this service's OpenAPI document.
- Elysia is the only caller (plus approved batch jobs). Authenticate service calls with a dedicated service credential — mTLS or a signed service token, not a user token and not a shared static API key committed to a file. The exact mechanism is unresolved; do not invent one silently.
- Timeouts on the caller side, bounded retries with backoff for idempotent reads, no blind retry for inference jobs that cost money or mutate state.
- Idempotency: accept an `Idempotency-Key` (or a stable request hash) for anything that creates a stored artifact, and return the same result for a replay.
- Errors use the same envelope as the API: `{ "error": { "code", "message", "requestId" } }`. Translate model and library exceptions into codes; never return a stack trace or a model's raw error.
- Propagate a request ID from the caller and log it on every line for that request.

## 8. Security and PHI

- Every request carries a service principal and, where relevant, the originating user and hospital as *context for audit* — not as authorisation this service re-derives. Authorisation happened in Elysia; if this service needs to re-check, it calls the API.
- Do not persist PHI by default. If a workload must store an artifact temporarily, use an encrypted, access-controlled store with a defined TTL, and delete on completion and on failure.
- No PHI in logs, metrics labels, trace attributes, exception messages or model prompts sent to third parties. Log identifiers and lengths, not content.
- No external AI APIs or third-party model providers without an explicit, documented decision covering data processing terms, residency and retention. Default is self-hosted or no call.
- Do not write clinical text to unencrypted temp files. If a library requires a file path, use a private temp directory, restrict permissions and remove it in a `finally`.
- Sanitise filenames and never construct a path from a client-supplied name.
- Secrets come from the environment/secret manager at startup, never from source. Fail fast if a required secret is missing; never fall back to a default credential.

## 9. Configuration and observability

- Settings via `pydantic-settings` with typed fields and no defaults for secrets. One `Settings` object, injected, not imported at module scope in domain code.
- Structured JSON logs with request ID, service, route, duration and outcome. No PHI, no prompts, no document text.
- Metrics: request count, latency, error rate, queue/backlog and model load time. Labels must be low-cardinality — never a patient or hospital name.
- Traces may carry route and timing; they must not carry clinical payloads.
- Health endpoints: `/health/live` (process up) and `/health/ready` (models loaded). Do not report ready before the service can serve.

## 10. Testing

- Unit tests for domain logic and pipelines — no server, no model download where avoidable; use small fakes.
- Schema tests: valid payloads accepted, unknown fields rejected, limits enforced.
- Route tests with `TestClient`/`httpx.ASGITransport` and dependency overrides; assert status, envelope and `response_model` shape.
- Contract test: the OpenAPI document generates, and the generated client used by Elysia compiles.
- Security tests: missing/invalid service credential → 401/403; oversized input → 422; PHI absent from logs in a capture assertion.
- Model-dependent tests are marked and run in CI only where the model is available; otherwise use a pinned stub with the same interface.

## 11. Before you finish

`ruff`/formatter, type checker (mypy or pyright, whichever the repo adopts), and tests pass. OpenAPI regenerates and its diff is reviewed. No PHI in logs or fixtures; fixtures are synthetic and clearly labelled. Report anything you could not verify, including any behaviour that depends on a model you could not run.
