import os
from datetime import datetime, timezone

import httpx
import jwt
from jwt import PyJWKClient

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from database import engine, get_db

from models import (
    Allocation,
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


# ==================================================
# DATABASE
# ==================================================

Base.metadata.create_all(bind=engine)


# ==================================================
# AUTHENTICATION CONFIGURATION
# ==================================================

OAUTH2_PROXY_AUTH_URL = os.getenv(
    "OAUTH2_PROXY_AUTH_URL",
    "http://localhost:4180/oauth2/auth",
)

KEYCLOAK_ISSUER_URL = os.getenv(
    "KEYCLOAK_ISSUER_URL",
    "http://localhost:8081/realms/test-realm",
)

KEYCLOAK_CLIENT_ID = os.getenv(
    "KEYCLOAK_CLIENT_ID",
    "Features_Selector",
)

KEYCLOAK_JWKS_URL = os.getenv(
    "KEYCLOAK_JWKS_URL",
    f"{KEYCLOAK_ISSUER_URL}/protocol/openid-connect/certs",
)

_jwks_client = PyJWKClient(
    KEYCLOAK_JWKS_URL,
    cache_keys=True,
)


# ==================================================
# FASTAPI APPLICATION
# ==================================================

app = FastAPI(title="Feature Prioritizer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================================================
# AUTHENTICATION
# ==================================================

def get_current_user(request: Request) -> dict:

    cookie_header = request.headers.get("cookie")

    if not cookie_header:
        raise HTTPException(
            status_code=401,
            detail="Sign in required",
        )

    # Validate session using OAuth2 Proxy.
    try:
        auth_response = httpx.get(
            OAUTH2_PROXY_AUTH_URL,
            headers={
                "Cookie": cookie_header,
            },
            timeout=4.0,
            follow_redirects=False,
        )

    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=503,
            detail="OAuth2 Proxy authentication service unavailable",
        ) from exc

    if not auth_response.is_success:
        raise HTTPException(
            status_code=401,
            detail="Session expired or invalid. Please sign in again.",
        )

    access_token = auth_response.headers.get(
        "X-Auth-Request-Access-Token"
    )

    if not access_token:
        raise HTTPException(
            status_code=503,
            detail=(
                "OAuth2 Proxy did not return an access token. "
                "Check pass_access_token and set_xauthrequest."
            ),
        )

    # Validate Keycloak JWT.
    try:
        signing_key = (
            _jwks_client
            .get_signing_key_from_jwt(access_token)
            .key
        )

        claims = jwt.decode(
            access_token,
            signing_key,
            algorithms=["RS256"],
            issuer=KEYCLOAK_ISSUER_URL,
            options={
                "verify_aud": False,
            },
        )

    except Exception as exc:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired Keycloak access token",
        ) from exc

    # Validate client.
    authorized_party = claims.get("azp")

    if authorized_party != KEYCLOAK_CLIENT_ID:
        raise HTTPException(
            status_code=401,
            detail="Unexpected Keycloak client",
        )

    # ----------------------------------------------
    # CLIENT ROLES
    # ----------------------------------------------

    resource_access = claims.get("resource_access") or {}

    application_access = (
        resource_access.get(KEYCLOAK_CLIENT_ID) or {}
    )

    application_roles = application_access.get("roles") or []

    allowed_roles = {
        "main_admin",
        "app_admin",
        "users",
    }

    roles = sorted(
        set(application_roles).intersection(allowed_roles)
    )

    if not roles:
        raise HTTPException(
            status_code=403,
            detail="No valid Features_Selector role assigned",
        )

    # ----------------------------------------------
    # KEYCLOAK GROUPS
    # ----------------------------------------------

    groups = claims.get("groups") or []

    if not isinstance(groups, list) or not all(
        isinstance(group, str) for group in groups
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid Keycloak groups claim",
        )

    return {
        "id": claims.get("sub"),
        "username": (
            claims.get("preferred_username")
            or claims.get("name")
            or claims.get("sub")
        ),
        "email": claims.get("email"),
        "roles": roles,
        "groups": groups,
        "is_admin": "main_admin" in roles,
        "is_app_admin": "app_admin" in roles,
    }


# ==================================================
# MAIN ADMIN AUTHORIZATION
# ==================================================

def require_main_admin(
    user: dict = Depends(get_current_user),
) -> dict:

    if not user["is_admin"]:
        raise HTTPException(
            status_code=403,
            detail="main_admin role required",
        )

    return user


# ==================================================
# PROJECT AUTHORIZATION
# ==================================================

def can_manage_project(
    user: dict,
    project: Project,
) -> bool:
    """
    main_admin:
        Can manage every project.

    app_admin:
        Can manage only projects where the user
        belongs to /<project_name>/app_admin.

    users:
        Cannot manage existing features.
    """

    if user["is_admin"]:
        return True

    if not user["is_app_admin"]:
        return False

    required_group = f"/{project.name}/app_admin"

    return required_group in user["groups"]


def require_project_admin(
    project_id: str,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:

    project = (
        db.query(Project)
        .filter(Project.id == project_id)
        .first()
    )

    if not project:
        raise HTTPException(
            status_code=404,
            detail="Project not found",
        )

    if not can_manage_project(user, project):
        raise HTTPException(
            status_code=403,
            detail=(
                "You are not authorized to manage "
                "features in this project"
            ),
        )

    return user


# ==================================================
# HELPERS
# ==================================================

def clean_optional_text(value: str | None) -> str | None:

    if value is None:
        return None

    return value.strip() or None


def get_project_or_404(
    db: Session,
    project_id: str,
) -> Project:

    project = (
        db.query(Project)
        .filter(Project.id == project_id)
        .first()
    )

    if not project:
        raise HTTPException(
            status_code=404,
            detail="Project not found",
        )

    return project


# ==================================================
# CURRENT USER
# ==================================================

@app.get("/api/auth/me")
def get_authenticated_user(
    user: dict = Depends(get_current_user),
):
    return user


# ==================================================
# PROJECT ENDPOINTS
# ==================================================

# Public project listing.
@app.get("/api/projects")
def list_projects(
    db: Session = Depends(get_db),
):

    return (
        db.query(Project)
        .order_by(Project.created_at.desc())
        .all()
    )


# Only main_admin can create projects.
@app.post("/api/projects", status_code=201)
def create_project(
    body: ProjectIn,
    admin: dict = Depends(require_main_admin),
    db: Session = Depends(get_db),
):

    project = Project(
        id=new_id(),
        name=body.name,
        description=clean_optional_text(body.description),
    )

    db.add(project)
    db.commit()
    db.refresh(project)

    return project


# Public project details.
@app.get("/api/projects/{project_id}")
def get_project_detail(
    project_id: str,
    db: Session = Depends(get_db),
):

    return get_project_or_404(db, project_id)


# Only main_admin can delete projects.
@app.delete("/api/projects/{project_id}")
def delete_project(
    project_id: str,
    admin: dict = Depends(require_main_admin),
    db: Session = Depends(get_db),
):

    project = get_project_or_404(db, project_id)

    db.delete(project)
    db.commit()

    return {"ok": True}


# ==================================================
# PROJECT PERMISSIONS
# ==================================================

@app.get("/api/projects/{project_id}/permissions")
def get_project_permissions(
    project_id: str,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):

    project = get_project_or_404(db, project_id)

    can_manage = can_manage_project(user, project)

    return {
        "can_create_project": user["is_admin"],
        "can_delete_project": user["is_admin"],
        "can_manage_features": can_manage,
        "can_add_feature": True,
        "can_submit_response": True,
        "can_view_results": True,
    }


# ==================================================
# FEATURE ENDPOINTS
# ==================================================

# Public feature listing.
@app.get("/api/projects/{project_id}/features")
def list_features(
    project_id: str,
    db: Session = Depends(get_db),
):

    get_project_or_404(db, project_id)

    return (
        db.query(Feature)
        .filter(Feature.project_id == project_id)
        .order_by(Feature.created_at, Feature.id)
        .all()
    )


# All authenticated users can add features.
@app.post(
    "/api/projects/{project_id}/features",
    status_code=201,
)
def add_feature(
    project_id: str,
    body: FeatureIn,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):

    get_project_or_404(db, project_id)

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


# main_admin or assigned app_admin.
@app.patch(
    "/api/projects/{project_id}/features/{feature_id}"
)
def update_feature(
    project_id: str,
    feature_id: str,
    body: FeatureUpdate,
    admin: dict = Depends(require_project_admin),
    db: Session = Depends(get_db),
):

    feature = (
        db.query(Feature)
        .filter(
            Feature.id == feature_id,
            Feature.project_id == project_id,
        )
        .first()
    )

    if not feature:
        raise HTTPException(
            status_code=404,
            detail="Feature not found",
        )

    changes = body.model_dump(exclude_unset=True)

    if not changes:
        raise HTTPException(
            status_code=422,
            detail="Provide at least one feature change",
        )

    if "name" in changes and changes["name"] is None:
        raise HTTPException(
            status_code=422,
            detail="Feature name cannot be null",
        )

    if "status" in changes and changes["status"] is None:
        raise HTTPException(
            status_code=422,
            detail="Feature status cannot be null",
        )

    if (
        changes.get("status") == "in_progress"
        and feature.implementation_started_at is None
    ):
        feature.implementation_started_at = datetime.now(
            timezone.utc
        )

    for field, value in changes.items():

        if field == "description":
            value = clean_optional_text(value)

        setattr(feature, field, value)

    db.commit()
    db.refresh(feature)

    return feature


# main_admin or assigned app_admin.
@app.delete(
    "/api/projects/{project_id}/features/{feature_id}"
)
def delete_feature(
    project_id: str,
    feature_id: str,
    admin: dict = Depends(require_project_admin),
    db: Session = Depends(get_db),
):

    feature = (
        db.query(Feature)
        .filter(
            Feature.id == feature_id,
            Feature.project_id == project_id,
        )
        .first()
    )

    if not feature:
        raise HTTPException(
            status_code=404,
            detail="Feature not found",
        )

    has_responses = (
        db.query(Allocation.id)
        .filter(Allocation.feature_id == feature_id)
        .first()
        is not None
    )

    if has_responses:
        raise HTTPException(
            status_code=409,
            detail=(
                "This feature has saved responses and cannot "
                "be deleted. Mark it Implemented to remove it "
                "from future allocations."
            ),
        )

    db.delete(feature)
    db.commit()

    return {"ok": True}


# ==================================================
# PRIORITIZATION
# ==================================================

@app.post(
    "/api/projects/{project_id}/responses",
    status_code=201,
)
def submit_response(
    project_id: str,
    body: ResponseIn,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):

    project = get_project_or_404(db, project_id)

    validate_response(body, project.features)

    response = Response(
        id=new_id(),
        project_id=project_id,
        stakeholder=(
            clean_optional_text(body.stakeholder)
            or "Anonymous"
        ),
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


# ==================================================
# RESPONSE VALIDATION
# ==================================================

def validate_response(
    body: ResponseIn,
    features: list[Feature],
) -> None:

    active_features = [
        feature
        for feature in features
        if feature.status != "implemented"
    ]

    if len(active_features) < 2:
        raise HTTPException(
            status_code=400,
            detail="Add at least 2 active features before submitting.",
        )

    total = sum(
        allocation.percentage
        for allocation in body.allocations
    )

    if total != 100:
        raise HTTPException(
            status_code=400,
            detail="Percentages must sum to exactly 100",
        )

    active_feature_ids = {
        feature.id for feature in active_features
    }

    if any(
        allocation.featureId not in active_feature_ids
        for allocation in body.allocations
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Allocations must reference active features "
                "in this project"
            ),
        )

    selected_ids = [
        allocation.featureId
        for allocation in body.allocations
    ]

    if len(selected_ids) != len(set(selected_ids)):
        raise HTTPException(
            status_code=400,
            detail="Same feature cannot be selected twice",
        )


# ==================================================
# RESULTS
# ==================================================

@app.get("/api/projects/{project_id}/results")
def get_results(
    project_id: str,
    db: Session = Depends(get_db),
):

    project = get_project_or_404(db, project_id)

    totals = {
        feature.id: 0
        for feature in project.features
    }

    contributors = {
        feature.id: 0
        for feature in project.features
    }

    total_points = 0

    for response in project.responses:

        for allocation in response.allocations:

            total_points += allocation.percentage

            if allocation.feature_id in totals:

                totals[allocation.feature_id] += (
                    allocation.percentage
                )

                if allocation.percentage > 0:
                    contributors[allocation.feature_id] += 1

    ranked = sorted(
        project.features,
        key=lambda feature: (
            -totals[feature.id],
            feature.name.casefold(),
        ),
    )

    results = []

    for rank, feature in enumerate(ranked, start=1):

        score = totals[feature.id]

        share = (
            score / total_points * 100
            if total_points
            else 0
        )

        results.append(
            {
                "rank": rank,
                "featureId": feature.id,
                "name": feature.name,
                "status": feature.status,
                "implementationStartedAt": (
                    feature.implementation_started_at
                ),
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
