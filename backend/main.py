import os
from datetime import datetime, timezone

import httpx
import jwt
from jwt import PyJWKClient

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import engine, get_db

from models import (
    Allocation,
    Base,
    Feature,
    FeatureGroup,
    FeatureGroupIn,
    FeatureGroupUpdate,
    FeatureIn,
    FeatureUpdate,
    Project,
    ProjectIn,
    Response,
    ResponseIn,
    new_id,
)


class AddFeaturesToGroupIn(BaseModel):
    feature_ids: list[str]


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
# FEATURE GROUP ENDPOINTS
# ==================================================

@app.get("/api/projects/{project_id}/feature-groups")
def list_feature_groups(project_id: str, db: Session = Depends(get_db)):
    get_project_or_404(db, project_id)
    groups = db.query(FeatureGroup).filter(FeatureGroup.project_id == project_id).order_by(FeatureGroup.created_at, FeatureGroup.id).all()
    return [
        {
            "id": group.id,
            "project_id": group.project_id,
            "name": group.name,
            "description": group.description,
            "created_at": group.created_at,
            "features": [
                {"id": feature.id, "name": feature.name, "description": feature.description, "status": feature.status}
                for feature in sorted(group.features, key=lambda item: (item.created_at, item.id))
            ],
        }
        for group in groups
    ]


@app.post("/api/projects/{project_id}/feature-groups", status_code=201)
def create_feature_group(
    project_id: str,
    body: FeatureGroupIn,
    admin: dict = Depends(require_project_admin),
    db: Session = Depends(get_db),
):
    get_project_or_404(db, project_id)
    selected = db.query(Feature).filter(
        Feature.project_id == project_id,
        Feature.id.in_(body.feature_ids),
    ).all()
    if len(selected) != len(body.feature_ids):
        raise HTTPException(status_code=400, detail="Every selected feature must belong to this project")
    if any(feature.group_id is not None for feature in selected):
        raise HTTPException(status_code=400, detail="A selected feature already belongs to a group")
    if any(feature.status == "implemented" for feature in selected):
        raise HTTPException(status_code=400, detail="Implemented features cannot be grouped")

    group = FeatureGroup(
        id=new_id(),
        project_id=project_id,
        name=body.name,
        description=clean_optional_text(body.description),
        created_by=admin.get("id"),
    )
    try:
        db.add(group)
        db.flush()
        for feature in selected:
            feature.group_id = group.id
        db.commit()
        db.refresh(group)
    except Exception:
        db.rollback()
        raise
    return {
        "id": group.id,
        "project_id": group.project_id,
        "name": group.name,
        "description": group.description,
        "created_at": group.created_at,
        "features": [{"id": f.id, "name": f.name, "description": f.description, "status": f.status} for f in selected],
    }

@app.post(
    "/api/projects/{project_id}/feature-groups/{group_id}/features"
)
def add_features_to_group(
    project_id: str,
    group_id: str,
    body: AddFeaturesToGroupIn,
    admin: dict = Depends(require_project_admin),
    db: Session = Depends(get_db),
):
    # Verify that the group exists in this project.
    group = (
        db.query(FeatureGroup)
        .filter(
            FeatureGroup.id == group_id,
            FeatureGroup.project_id == project_id,
        )
        .first()
    )

    if not group:
        raise HTTPException(
            status_code=404,
            detail="Feature group not found",
        )

    # Reject an empty selection.
    if not body.feature_ids:
        raise HTTPException(
            status_code=400,
            detail="Select at least one feature to add",
        )

    # Reject duplicate IDs.
    if len(body.feature_ids) != len(set(body.feature_ids)):
        raise HTTPException(
            status_code=400,
            detail="Duplicate feature IDs are not allowed",
        )

    # Find the selected features belonging to this project.
    features = (
        db.query(Feature)
        .filter(
            Feature.project_id == project_id,
            Feature.id.in_(body.feature_ids),
        )
        .all()
    )

    if len(features) != len(body.feature_ids):
        raise HTTPException(
            status_code=400,
            detail="Some features do not belong to this project",
        )

    # Only ungrouped features can be added.
    if any(feature.group_id is not None for feature in features):
        raise HTTPException(
            status_code=400,
            detail="Selected features must be ungrouped first",
        )

    # Keep the existing rule that implemented features cannot be grouped.
    if any(feature.status == "implemented" for feature in features):
        raise HTTPException(
            status_code=400,
            detail="Implemented features cannot be grouped",
        )

    try:
        for feature in features:
            feature.group_id = group.id

        db.commit()

    except Exception:
        db.rollback()
        raise

    return {
        "ok": True,
        "group_id": group.id,
        "added_features": len(features),
    }

@app.patch("/api/projects/{project_id}/feature-groups/{group_id}")
def rename_feature_group(
    project_id: str,
    group_id: str,
    body: FeatureGroupUpdate,
    admin: dict = Depends(require_project_admin),
    db: Session = Depends(get_db),
):
    group = db.query(FeatureGroup).filter(FeatureGroup.id == group_id, FeatureGroup.project_id == project_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Feature group not found")
    group.name = body.name
    db.commit()
    db.refresh(group)
    return {"id": group.id, "project_id": group.project_id, "name": group.name, "description": group.description}


@app.delete("/api/projects/{project_id}/feature-groups/{group_id}/features/{feature_id}")
def ungroup_feature(
    project_id: str,
    group_id: str,
    feature_id: str,
    admin: dict = Depends(require_project_admin),
    db: Session = Depends(get_db),
):
    feature = db.query(Feature).filter(Feature.id == feature_id, Feature.project_id == project_id, Feature.group_id == group_id).first()
    if not feature:
        raise HTTPException(status_code=404, detail="Feature not found in this group")
    feature.group_id = None
    db.commit()
    return {"ok": True}


@app.delete("/api/projects/{project_id}/feature-groups/{group_id}")
def delete_feature_group(
    project_id: str,
    group_id: str,
    admin: dict = Depends(require_project_admin),
    db: Session = Depends(get_db),
):
    group = db.query(FeatureGroup).filter(FeatureGroup.id == group_id, FeatureGroup.project_id == project_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Feature group not found")
    try:
        # Keep member features; make them standalone again. Historical group votes remain attached to the group
        # until deletion; to avoid losing historical scores, retain the group as an archived result target.
        # This endpoint therefore refuses deletion after group votes exist.
        group_votes = db.query(Allocation).filter(Allocation.group_id == group_id).count()
        if group_votes:
            raise HTTPException(status_code=409, detail="This group has voting history. Ungroup its features only after deciding how to preserve those votes.")
        for feature in group.features:
            feature.group_id = None
        db.delete(group)
        db.commit()
        return {"ok": True}
    except Exception:
        db.rollback()
        raise


# ==================================================
# FEATURE GROUP ENDPOINTS
# ==================================================

@app.get("/api/projects/{project_id}/feature-groups")
def list_feature_groups(project_id: str, db: Session = Depends(get_db)):
    get_project_or_404(db, project_id)
    groups = db.query(FeatureGroup).filter(FeatureGroup.project_id == project_id).order_by(FeatureGroup.created_at, FeatureGroup.id).all()
    return [
        {
            "id": group.id,
            "project_id": group.project_id,
            "name": group.name,
            "description": group.description,
            "created_at": group.created_at,
            "features": [
                {"id": feature.id, "name": feature.name, "description": feature.description, "status": feature.status}
                for feature in sorted(group.features, key=lambda item: (item.created_at, item.id))
            ],
        }
        for group in groups
    ]


@app.post("/api/projects/{project_id}/feature-groups", status_code=201)
def create_feature_group(
    project_id: str,
    body: FeatureGroupIn,
    admin: dict = Depends(require_project_admin),
    db: Session = Depends(get_db),
):
    get_project_or_404(db, project_id)
    selected = db.query(Feature).filter(
        Feature.project_id == project_id,
        Feature.id.in_(body.feature_ids),
    ).all()
    if len(selected) != len(body.feature_ids):
        raise HTTPException(status_code=400, detail="Every selected feature must belong to this project")
    if any(feature.group_id is not None for feature in selected):
        raise HTTPException(status_code=400, detail="A selected feature already belongs to a group")
    if any(feature.status == "implemented" for feature in selected):
        raise HTTPException(status_code=400, detail="Implemented features cannot be grouped")

    group = FeatureGroup(
        id=new_id(),
        project_id=project_id,
        name=body.name,
        description=clean_optional_text(body.description),
        created_by=admin.get("id"),
    )
    try:
        db.add(group)
        db.flush()
        for feature in selected:
            feature.group_id = group.id
        db.commit()
        db.refresh(group)
    except Exception:
        db.rollback()
        raise
    return {
        "id": group.id,
        "project_id": group.project_id,
        "name": group.name,
        "description": group.description,
        "created_at": group.created_at,
        "features": [{"id": f.id, "name": f.name, "description": f.description, "status": f.status} for f in selected],
    }


@app.patch("/api/projects/{project_id}/feature-groups/{group_id}")
def rename_feature_group(
    project_id: str,
    group_id: str,
    body: FeatureGroupUpdate,
    admin: dict = Depends(require_project_admin),
    db: Session = Depends(get_db),
):
    group = db.query(FeatureGroup).filter(FeatureGroup.id == group_id, FeatureGroup.project_id == project_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Feature group not found")
    group.name = body.name
    db.commit()
    db.refresh(group)
    return {"id": group.id, "project_id": group.project_id, "name": group.name, "description": group.description}


@app.delete("/api/projects/{project_id}/feature-groups/{group_id}/features/{feature_id}")
def ungroup_feature(
    project_id: str,
    group_id: str,
    feature_id: str,
    admin: dict = Depends(require_project_admin),
    db: Session = Depends(get_db),
):
    feature = db.query(Feature).filter(Feature.id == feature_id, Feature.project_id == project_id, Feature.group_id == group_id).first()
    if not feature:
        raise HTTPException(status_code=404, detail="Feature not found in this group")
    feature.group_id = None
    db.commit()
    return {"ok": True}


@app.delete("/api/projects/{project_id}/feature-groups/{group_id}")
def delete_feature_group(
    project_id: str,
    group_id: str,
    admin: dict = Depends(require_project_admin),
    db: Session = Depends(get_db),
):
    group = db.query(FeatureGroup).filter(FeatureGroup.id == group_id, FeatureGroup.project_id == project_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Feature group not found")
    try:
        # Keep member features; make them standalone again. Historical group votes remain attached to the group
        # until deletion; to avoid losing historical scores, retain the group as an archived result target.
        # This endpoint therefore refuses deletion after group votes exist.
        group_votes = db.query(Allocation).filter(Allocation.group_id == group_id).count()
        if group_votes:
            raise HTTPException(status_code=409, detail="This group has voting history. Ungroup its features only after deciding how to preserve those votes.")
        for feature in group.features:
            feature.group_id = None
        db.delete(group)
        db.commit()
        return {"ok": True}
    except Exception:
        db.rollback()
        raise


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
@app.delete("/api/projects/{project_id}/features/{feature_id}")
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

    try:
        # Remove allocations associated with this feature.
        db.query(Allocation).filter(
            Allocation.feature_id == feature_id
        ).delete(synchronize_session=False)

        # Delete the feature itself.
        db.delete(feature)
        db.commit()

        return {"ok": True}

    except Exception:
        db.rollback()
        raise

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
    groups = db.query(FeatureGroup).filter(FeatureGroup.project_id == project_id).all()
    validate_response(body, project.features, groups)

    response = Response(
        id=new_id(),
        project_id=project_id,
        stakeholder=clean_optional_text(body.stakeholder) or "Anonymous",
    )
    db.add(response)
    for item in body.allocations:
        db.add(Allocation(
            id=new_id(),
            response_id=response.id,
            feature_id=item.featureId,
            group_id=item.groupId,
            percentage=item.percentage,
        ))
    db.commit()
    return {"ok": True}


def validate_response(body: ResponseIn, features: list[Feature], groups: list[FeatureGroup]) -> None:
    active_features = [feature for feature in features if feature.status != "implemented"]
    active_groups = [group for group in groups if any(f.status != "implemented" for f in group.features)]
    active_ungrouped = [feature for feature in active_features if feature.group_id is None]
    item_count = len(active_ungrouped) + len(active_groups)
    if item_count < 2:
        raise HTTPException(status_code=400, detail="Add at least 2 active prioritization items before submitting.")

    if sum(item.percentage for item in body.allocations) != 100:
        raise HTTPException(status_code=400, detail="Percentages must sum to exactly 100")

    feature_by_id = {feature.id: feature for feature in active_ungrouped}
    group_by_id = {group.id: group for group in active_groups}
    seen = set()
    for item in body.allocations:
        if item.featureId:
            feature = feature_by_id.get(item.featureId)
            if not feature:
                raise HTTPException(status_code=400, detail="Allocations must reference active ungrouped features in this project")
            key = ("feature", item.featureId)
        else:
            group = group_by_id.get(item.groupId)
            if not group:
                raise HTTPException(status_code=400, detail="Allocations must reference active groups in this project")
            key = ("group", item.groupId)
        if key in seen:
            raise HTTPException(status_code=400, detail="The same prioritization item cannot be selected twice")
        seen.add(key)


# ==================================================
# RESULTS
# ==================================================

@app.get("/api/projects/{project_id}/results")
def get_results(project_id: str, db: Session = Depends(get_db)):
    project = get_project_or_404(db, project_id)
    all_groups = db.query(FeatureGroup).filter(FeatureGroup.project_id == project_id).all()
    # Only groups that still contain features are current ranking items.
    # Keep empty group rows and their historical allocations in the database,
    # but don't display them as active ranking entries after ungrouping.
    groups = [group for group in all_groups if group.features]
    feature_by_id = {feature.id: feature for feature in project.features}

    # Scores are accumulated per response item. Historical votes for member features
    # are attributed to the current group; future votes point directly to group_id.
    totals = {f"group:{group.id}": 0 for group in groups}
    contributors = {f"group:{group.id}": 0 for group in groups}
    for feature in project.features:
        if feature.group_id is None:
            totals[f"feature:{feature.id}"] = 0
            contributors[f"feature:{feature.id}"] = 0

    total_points = 0
    for response in project.responses:
        for allocation in response.allocations:
            if allocation.group_id:
                key = f"group:{allocation.group_id}"
            else:
                feature = feature_by_id.get(allocation.feature_id)
                if not feature:
                    continue
                key = f"group:{feature.group_id}" if feature.group_id else f"feature:{feature.id}"
            # Ignore allocations for groups that are now empty. Their historical
            # records remain stored, but should not affect the visible ranking/share.
            if key in totals:
                total_points += allocation.percentage
                totals[key] += allocation.percentage
                if allocation.percentage > 0:
                    contributors[key] += 1

    items = []
    for group in groups:
        member_features = [f for f in group.features]
        # Groups containing only implemented features are still shown in historical results.
        items.append({
            "key": f"group:{group.id}",
            "groupId": group.id,
            "featureId": None,
            "name": group.name,
            "status": "group",
            "features": [{"id": f.id, "name": f.name, "status": f.status, "implementationStartedAt": f.implementation_started_at} for f in member_features],
        })
    for feature in project.features:
        if feature.group_id is None:
            items.append({
                "key": f"feature:{feature.id}",
                "groupId": None,
                "featureId": feature.id,
                "name": feature.name,
                "status": feature.status,
                "implementationStartedAt": feature.implementation_started_at,
                "features": [],
            })

    ranked = sorted(items, key=lambda item: (-totals.get(item["key"], 0), item["name"].casefold()))
    results = []
    for rank, item in enumerate(ranked, start=1):
        score = totals.get(item["key"], 0)
        share = score / total_points * 100 if total_points else 0
        results.append({
            "rank": rank,
            "featureId": item["featureId"],
            "groupId": item["groupId"],
            "name": item["name"],
            "status": item["status"],
            "implementationStartedAt": item.get("implementationStartedAt"),
            "features": item["features"],
            "share": round(share, 1),
            "priority": round(share, 1),
            "totalScore": score,
            "contributors": contributors.get(item["key"], 0),
            "stakeholderCount": contributors.get(item["key"], 0),
        })
    return {
        "projectName": project.name,
        "responseCount": len(project.responses),
        "totalPoints": total_points,
        "results": results,
    }
