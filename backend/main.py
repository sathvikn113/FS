from datetime import datetime, timezone

import os

import httpx
import jwt
from jwt import PyJWKClient
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from database import engine, get_db
from models import (
    Allocation,
    AllocationIn,
    Base,
    Feature,
    FeatureIn,
    FeatureUpdate,
    Project,
    ProjectIn,
    Response,
    ResponseIn,
    new_id,
)

Base.metadata.create_all(bind=engine)

# Authentication settings. Override these with environment variables outside local development.
OAUTH2_PROXY_AUTH_URL = os.getenv("OAUTH2_PROXY_AUTH_URL", "http://localhost:4180/oauth2/auth")
KEYCLOAK_ISSUER_URL = os.getenv("KEYCLOAK_ISSUER_URL", "http://localhost:8081/realms/test-realm")
KEYCLOAK_CLIENT_ID = os.getenv("KEYCLOAK_CLIENT_ID", "Features_Selector")
KEYCLOAK_JWKS_URL = os.getenv(
    "KEYCLOAK_JWKS_URL",
    f"{KEYCLOAK_ISSUER_URL}/protocol/openid-connect/certs",
)
_jwks_client = PyJWKClient(KEYCLOAK_JWKS_URL, cache_keys=True)

app = FastAPI(title="Feature Prioritizer API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



def get_current_user(request: Request) -> dict:
    """Authenticate the browser's OAuth2 Proxy session, then validate its signed access token.

    Do not trust X-Auth-Request-* headers sent by the browser. The token is obtained from
    OAuth2 Proxy's server-side /oauth2/auth endpoint using the browser's session cookie.
    """
    cookie_header = request.headers.get("cookie")
    if not cookie_header:
        raise HTTPException(status_code=401, detail="Sign in required")

    try:
        auth_response = httpx.get(
            OAUTH2_PROXY_AUTH_URL,
            headers={"Cookie": cookie_header},
            timeout=4.0,
            follow_redirects=False,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=503,
            detail="Authentication service is unavailable. Check that OAuth2 Proxy is running.",
        ) from exc

    if not auth_response.is_success:
        raise HTTPException(status_code=401, detail="Your session is missing or expired. Please sign in again.")

    access_token = auth_response.headers.get("X-Auth-Request-Access-Token")
    if not access_token:
        raise HTTPException(
            status_code=503,
            detail="OAuth2 Proxy did not return an access token. Enable pass_access_token and set_xauthrequest.",
        )

    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(access_token).key
        claims = jwt.decode(
            access_token,
            signing_key,
            algorithms=["RS256"],
            issuer=KEYCLOAK_ISSUER_URL,
            options={"verify_aud": False},
        )
    except Exception as exc:
        # Fail closed if token signature, issuer, expiry, or JWKS lookup cannot be validated.
        raise HTTPException(status_code=401, detail="Could not validate the sign-in token. Please sign in again.") from exc

    authorized_party = claims.get("azp")
    if authorized_party and authorized_party != KEYCLOAK_CLIENT_ID:
        raise HTTPException(status_code=401, detail="The sign-in token was issued to an unexpected client.")

    role_claim = claims.get("realm_access", {}).get("roles", [])
    roles = [role for role in role_claim if role in {"Admin", "User"}]
    if not roles:
        raise HTTPException(status_code=403, detail="Your Keycloak account must have the Admin or User realm role.")

    return {
        "username": claims.get("preferred_username") or claims.get("name") or claims.get("sub"),
        "email": claims.get("email"),
        "roles": roles,
        "is_admin": "Admin" in roles,
    }


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if not user["is_admin"]:
        raise HTTPException(status_code=403, detail="Admin role required for this action")
    return user


@app.get("/api/auth/me")
def get_authenticated_user(user: dict = Depends(get_current_user)):
    return user


def clean_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None


@app.get("/api/projects")
def list_projects(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Project).order_by(Project.created_at.desc()).all()


@app.post("/api/projects", status_code=201)
def create_project(body: ProjectIn, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    project = Project(
        id=new_id(),
        name=body.name,
        description=clean_optional_text(body.description),
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@app.get("/api/projects/{project_id}")
def get_project_detail(project_id: str, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    db.delete(project)
    db.commit()
    return {"ok": True}


@app.post("/api/projects/{project_id}/features", status_code=201)
def add_feature(project_id: str, body: FeatureIn, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    feature = Feature(
        id=new_id(),
        project_id=project_id,
        name=body.name,
        description=clean_optional_text(body.description),
        status="planned",
    )
    db.add(feature)
    db.commit()
    db.refresh(feature)
    return feature


@app.patch("/api/projects/{project_id}/features/{feature_id}")
def update_feature(
    project_id: str,
    feature_id: str,
    body: FeatureUpdate,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    feature = db.query(Feature).filter(
        Feature.id == feature_id,
        Feature.project_id == project_id,
    ).first()
    if not feature:
        raise HTTPException(status_code=404, detail="Feature not found")

    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=422, detail="Provide at least one feature change")
    if "name" in changes and changes["name"] is None:
        raise HTTPException(status_code=422, detail="Feature name cannot be null")
    if "status" in changes and changes["status"] is None:
        raise HTTPException(status_code=422, detail="Feature status cannot be null")

    if (
        changes.get("status") == "in_progress"
        and feature.implementation_started_at is None
    ):
        feature.implementation_started_at = datetime.now(timezone.utc)

    for field, value in changes.items():
        setattr(feature, field, clean_optional_text(value) if field == "description" else value)

    db.commit()
    db.refresh(feature)
    return feature


@app.delete("/api/projects/{project_id}/features/{feature_id}")
def delete_feature(project_id: str, feature_id: str, admin: dict = Depends(require_admin), db: Session = Depends(get_db)):
    feature = db.query(Feature).filter(
        Feature.id == feature_id,
        Feature.project_id == project_id,
    ).first()
    if not feature:
        raise HTTPException(status_code=404, detail="Feature not found")

    has_responses = (
        db.query(Allocation.id)
        .filter(Allocation.feature_id == feature_id)
        .first()
        is not None
    )
    if has_responses:
        raise HTTPException(
            status_code=409,
            detail="This feature has saved responses and cannot be deleted. Mark it Implemented to remove it from future allocations.",
        )

    db.delete(feature)
    db.commit()
    return {"ok": True}


@app.get("/api/projects/{project_id}/features")
def list_features(project_id: str, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    project_exists = db.query(Project.id).filter(Project.id == project_id).first()
    if not project_exists:
        raise HTTPException(status_code=404, detail="Project not found")
    return (
        db.query(Feature)
        .filter(Feature.project_id == project_id)
        .order_by(Feature.created_at, Feature.id)
        .all()
    )


@app.post("/api/projects/{project_id}/responses", status_code=201)
def submit_response(project_id: str, body: ResponseIn, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    validate_response(body, project.features)
    response = Response(
        id=new_id(),
        project_id=project_id,
        stakeholder=clean_optional_text(body.stakeholder) or "Anonymous",
    )
    db.add(response)

    for allocation in body.allocations:
        db.add(
            Allocation(
                id=new_id(),
                response_id=response.id,
                feature_id=allocation.featureId,
                percentage=allocation.percentage,
            )
        )

    db.commit()
    return {"ok": True}


def validate_response(body: ResponseIn, features: list[Feature]) -> None:
    active_features = [feature for feature in features if feature.status != "implemented"]
    if len(active_features) < 2:
        raise HTTPException(
            status_code=400,
            detail="Add at least 2 active features before submitting.",
        )

    total = sum(allocation.percentage for allocation in body.allocations)
    if total != 100:
        raise HTTPException(
            status_code=400,
            detail="Percentages must sum to exactly 100",
        )

    active_feature_ids = {feature.id for feature in active_features}
    if any(allocation.featureId not in active_feature_ids for allocation in body.allocations):
        raise HTTPException(
            status_code=400,
            detail="Allocations must reference active features in this project",
        )

    selected_ids = [allocation.featureId for allocation in body.allocations]
    if len(selected_ids) != len(set(selected_ids)):
        raise HTTPException(status_code=400, detail="Same feature cannot be selected twice")


@app.get("/api/projects/{project_id}/results")
def get_results(project_id: str, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    totals = {feature.id: 0 for feature in project.features}
    contributors = {feature.id: 0 for feature in project.features}
    total_points = 0

    for response in project.responses:
        for allocation in response.allocations:
            total_points += allocation.percentage
            if allocation.feature_id in totals:
                totals[allocation.feature_id] += allocation.percentage
                if allocation.percentage > 0:
                    contributors[allocation.feature_id] += 1

    ranked = sorted(
        project.features,
        key=lambda feature: (-totals[feature.id], feature.name.casefold()),
    )
    results = []
    for rank, feature in enumerate(ranked, start=1):
        score = totals[feature.id]
        share = score / total_points * 100 if total_points else 0
        results.append(
            {
                "rank": rank,
                "featureId": feature.id,
                "name": feature.name,
                "status": feature.status,
                "implementationStartedAt": feature.implementation_started_at,
                "share": round(share, 1),
                "priority": round(share, 1),
                "totalScore": score,
                "contributors": contributors[feature.id],
                "stakeholderCount": contributors[feature.id],
            }
        )

    return {
        "projectName": project.name,
        "responseCount": len(project.responses),
        "totalPoints": total_points,
        "results": results,
    }
