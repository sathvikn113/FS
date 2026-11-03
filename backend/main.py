import os
import re
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
    FeatureDependency,
    FeatureDependencyIn,
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


class ProjectSupportEmailIn(BaseModel):
    support_email: str | None = None



Base.metadata.create_all(bind=engine)



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




app = FastAPI(title="Feature Prioritizer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



def get_current_user(request: Request) -> dict:

    cookie_header = request.headers.get("cookie")

    if not cookie_header:
        raise HTTPException(
            status_code=401,
            detail="Sign in required",
        )


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


    authorized_party = claims.get("azp")

    if authorized_party != KEYCLOAK_CLIENT_ID:
        raise HTTPException(
            status_code=401,
            detail="Unexpected Keycloak client",
        )

 
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



def require_main_admin(
    user: dict = Depends(get_current_user),
) -> dict:

    if not user["is_admin"]:
        raise HTTPException(
            status_code=403,
            detail="main_admin role required",
        )

    return user



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


@app.get("/api/auth/me")
def get_authenticated_user(
    user: dict = Depends(get_current_user),
):
    return user


@app.get("/api/projects")
def list_projects(
    db: Session = Depends(get_db),
):

    return (
        db.query(Project)
        .order_by(Project.created_at.desc())
        .all()
    )



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



@app.get("/api/projects/{project_id}")
def get_project_detail(
    project_id: str,
    db: Session = Depends(get_db),
):

    return get_project_or_404(db, project_id)


@app.patch("/api/projects/{project_id}/support-email")
def update_project_support_email(
    project_id: str,
    body: ProjectSupportEmailIn,
    admin: dict = Depends(require_project_admin),
    db: Session = Depends(get_db),
):
    project = get_project_or_404(db, project_id)

    if not hasattr(project, "support_email"):
        raise HTTPException(
            status_code=500,
            detail=(
                "Project.support_email is not configured. Add a nullable "
                "support_email column to the Project model and database."
            ),
        )

    email = (body.support_email or "").strip() or None
    if email and (
        len(email) > 254
        or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email)
    ):
        raise HTTPException(
            status_code=422,
            detail="Enter a valid support email address or leave it blank.",
        )

    project.support_email = email
    db.commit()
    db.refresh(project)

    return {
        "id": project.id,
        "name": project.name,
        "support_email": project.support_email,
    }



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
# DEPENDENCY ENDPOINTS
# ==================================================

def _dependency_entity(db: Session, project_id: str, entity_type: str, entity_id: str):
    if entity_type == "feature":
        entity = db.query(Feature).filter(
            Feature.id == entity_id, Feature.project_id == project_id
        ).first()
    elif entity_type == "group":
        entity = db.query(FeatureGroup).filter(
            FeatureGroup.id == entity_id, FeatureGroup.project_id == project_id
        ).first()
    else:
        entity = None
    if not entity:
        raise HTTPException(status_code=404, detail=f"{entity_type.title()} not found in this project")
    return entity


def _entity_status(entity_type: str, entity) -> str:
    return entity.status


@app.get("/api/projects/{project_id}/dependencies")
def list_dependencies(project_id: str, db: Session = Depends(get_db)):
    get_project_or_404(db, project_id)
    rows = db.query(FeatureDependency).filter(
        FeatureDependency.project_id == project_id
    ).order_by(FeatureDependency.created_at, FeatureDependency.id).all()
    result = []
    for row in rows:
        try:
            parent = _dependency_entity(db, project_id, row.parent_type, row.parent_id)
            child = _dependency_entity(db, project_id, row.child_type, row.child_id)
        except HTTPException:
            continue
        result.append({
            "id": row.id, "project_id": project_id,
            "parent_type": row.parent_type, "parent_id": row.parent_id,
            "parent_name": parent.name, "child_type": row.child_type,
            "child_id": row.child_id, "child_name": child.name,
        })
    return result


@app.post("/api/projects/{project_id}/dependencies", status_code=201)
def create_dependency(
    project_id: str,
    body: FeatureDependencyIn,
    admin: dict = Depends(require_project_admin),
    db: Session = Depends(get_db),
):
    get_project_or_404(db, project_id)
    if body.parent_type == body.child_type and body.parent_id == body.child_id:
        raise HTTPException(status_code=400, detail="An item cannot depend on itself")
    parent = _dependency_entity(db, project_id, body.parent_type, body.parent_id)
    child = _dependency_entity(db, project_id, body.child_type, body.child_id)


    if body.parent_type == "feature" and parent.group_id is not None:
        raise HTTPException(status_code=400, detail="A feature inside a group must use its group as the dependency item")
    if body.child_type == "feature" and child.group_id is not None:
        raise HTTPException(status_code=400, detail="A feature inside a group must use its group as the dependency item")

    if parent.status in {"implemented", "rejected"}:
        raise HTTPException(status_code=400, detail="A completed item cannot be a dependency parent")
    if child.status in {"implemented", "rejected"}:
        raise HTTPException(status_code=400, detail="A completed item cannot be a dependent child")


    edges = db.query(FeatureDependency).filter(FeatureDependency.project_id == project_id).all()
    graph = {}
    for edge in edges:
        graph.setdefault((edge.parent_type, edge.parent_id), set()).add((edge.child_type, edge.child_id))
    start = (body.child_type, body.child_id)
    target = (body.parent_type, body.parent_id)
    stack, visited = [start], set()
    while stack:
        node = stack.pop()
        if node == target:
            raise HTTPException(status_code=400, detail="This dependency would create a circular dependency")
        if node not in visited:
            visited.add(node)
            stack.extend(graph.get(node, ()))

    if body.parent_type == "group" and body.child_type == "feature" and child.group_id == parent.id:
        raise HTTPException(status_code=400, detail="A group cannot depend on one of its own member features")
    if body.parent_type == "feature" and body.child_type == "group" and any(member.id == parent.id for member in child.features):
        raise HTTPException(status_code=400, detail="A feature cannot depend on a group that already contains it")

    duplicate = db.query(FeatureDependency).filter_by(
        project_id=project_id, parent_type=body.parent_type,
        parent_id=body.parent_id, child_type=body.child_type,
        child_id=body.child_id,
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="This dependency already exists")
    existing_parent = db.query(FeatureDependency).filter_by(
        project_id=project_id, child_type=body.child_type, child_id=body.child_id
    ).first()
    if existing_parent:
        raise HTTPException(status_code=409, detail="This item is already dependent on another parent")
    row = FeatureDependency(
        id=new_id(), project_id=project_id,
        parent_type=body.parent_type, parent_id=body.parent_id,
        child_type=body.child_type, child_id=body.child_id,
        created_by=admin.get("id"),
    )
    db.add(row)
    db.commit()
    return {
        "id": row.id, "project_id": project_id,
        "parent_type": row.parent_type, "parent_id": row.parent_id,
        "parent_name": parent.name, "child_type": row.child_type,
        "child_id": row.child_id, "child_name": child.name,
    }


@app.delete("/api/projects/{project_id}/dependencies/{dependency_id}")
def delete_dependency(
    project_id: str,
    dependency_id: str,
    admin: dict = Depends(require_project_admin),
    db: Session = Depends(get_db),
):
    row = db.query(FeatureDependency).filter(
        FeatureDependency.id == dependency_id,
        FeatureDependency.project_id == project_id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Dependency not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


def _remove_parent_dependencies(db: Session, project_id: str, entity_type: str, entity_id: str):
    db.query(FeatureDependency).filter(
        FeatureDependency.project_id == project_id,
        FeatureDependency.parent_type == entity_type,
        FeatureDependency.parent_id == entity_id,
    ).delete(synchronize_session=False)


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
            "status": group.status,
            "kind": group.kind,
            "implementation_started_at": group.implementation_started_at,
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
    if any(feature.status in {"implemented", "rejected"} for feature in selected):
        raise HTTPException(status_code=400, detail="Implemented or rejected features cannot be grouped")

    group = FeatureGroup(
        id=new_id(),
        project_id=project_id,
        name=body.name,
        description=clean_optional_text(body.description),
        status="pending",
        kind=body.kind,
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
        "status": group.status,
        "kind": group.kind,
        "implementation_started_at": group.implementation_started_at,
        "created_at": group.created_at,
        "features": [{"id": f.id, "name": f.name, "description": f.description, "status": f.status, "implementation_started_at": f.implementation_started_at} for f in selected],
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
    if any(feature.status in {"implemented", "rejected"} for feature in features):
        raise HTTPException(
            status_code=400,
            detail="Implemented or rejected features cannot be grouped",
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
    if body.name is not None:
        group.name = body.name
    if body.status is not None:
        group.status = body.status
        if body.status == "in_progress" and group.implementation_started_at is None:
            group.implementation_started_at = datetime.now(timezone.utc)

        if body.status in {"implemented", "rejected"}:

            _remove_parent_dependencies(db, project_id, "group", group_id)
            db.query(FeatureDependency).filter(
                FeatureDependency.project_id == project_id,
                FeatureDependency.child_type == "group",
                FeatureDependency.child_id == group_id,
            ).delete(synchronize_session=False)

         
            if body.status == "implemented" and group.kind == "depends":
                for member_feature in list(group.features):
                    member_feature.group_id = None

    db.commit()
    db.refresh(group)
    return {
        "id": group.id,
        "project_id": group.project_id,
        "name": group.name,
        "description": group.description,
        "status": group.status,
        "kind": group.kind,
        "implementation_started_at": group.implementation_started_at,
    }


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
       
        group_votes = db.query(Allocation).filter(Allocation.group_id == group_id).count()
        if group_votes:
            raise HTTPException(status_code=409, detail="This group has voting history. Ungroup its features only after deciding how to preserve those votes.")
        db.query(FeatureDependency).filter(
            FeatureDependency.project_id == project_id,
            ((FeatureDependency.parent_type == "group") & (FeatureDependency.parent_id == group_id)) |
            ((FeatureDependency.child_type == "group") & (FeatureDependency.child_id == group_id)),
        ).delete(synchronize_session=False)
        for feature in group.features:
            feature.group_id = None
        db.delete(group)
        db.commit()
        return {"ok": True}
    except Exception:
        db.rollback()
        raise




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
        status="pending",
    )

    db.add(feature)
    db.commit()
    db.refresh(feature)

    return feature



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

    if changes.get("status") in {"implemented", "rejected"}:
        _remove_parent_dependencies(db, project_id, "feature", feature_id)
        db.query(FeatureDependency).filter(
            FeatureDependency.project_id == project_id,
            FeatureDependency.child_type == "feature",
            FeatureDependency.child_id == feature_id,
        ).delete(synchronize_session=False)

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

        # Remove dependency edges that reference this feature.
        db.query(FeatureDependency).filter(
            FeatureDependency.project_id == project_id,
            ((FeatureDependency.parent_type == "feature") & (FeatureDependency.parent_id == feature_id)) |
            ((FeatureDependency.child_type == "feature") & (FeatureDependency.child_id == feature_id)),
        ).delete(synchronize_session=False)

        # Delete the feature itself.
        db.delete(feature)
        db.commit()

        return {"ok": True}

    except Exception:
        db.rollback()
        raise


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
    validate_response(body, project.features, groups, db, project_id)

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


def validate_response(body: ResponseIn, features: list[Feature], groups: list[FeatureGroup], db: Session, project_id: str) -> None:
    # A dependency child is displayed below its parent and cannot receive its own allocation.
    dependency_rows = db.query(FeatureDependency).filter(FeatureDependency.project_id == project_id).all()
    child_keys = {(row.child_type, row.child_id) for row in dependency_rows}
    active_features = [feature for feature in features if feature.status not in {"implemented", "rejected"}]
    active_groups = [group for group in groups if group.status not in {"implemented", "rejected"} and any(f.status not in {"implemented", "rejected"} for f in group.features)]
    active_ungrouped = [feature for feature in active_features if feature.group_id is None and ("feature", feature.id) not in child_keys]
    active_groups = [group for group in active_groups if ("group", group.id) not in child_keys]
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




@app.get("/api/projects/{project_id}/results")
def get_results(project_id: str, db: Session = Depends(get_db)):
    project = get_project_or_404(db, project_id)
    all_groups = db.query(FeatureGroup).filter(FeatureGroup.project_id == project_id).all()
  
    groups = [group for group in all_groups if group.features]
    dependency_rows = db.query(FeatureDependency).filter(FeatureDependency.project_id == project_id).all()
    dependency_child_keys = {(row.child_type, row.child_id) for row in dependency_rows}
    feature_by_id = {feature.id: feature for feature in project.features}

    totals = {
        f"group:{group.id}": 0 for group in groups
        if ("group", group.id) not in dependency_child_keys
    }
    contributors = {key: 0 for key in totals}
    for feature in project.features:
        if feature.group_id is None and ("feature", feature.id) not in dependency_child_keys:
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
   
            if key in totals:
                total_points += allocation.percentage
                totals[key] += allocation.percentage
                if allocation.percentage > 0:
                    contributors[key] += 1

    items = []
    for group in groups:
        if ("group", group.id) in dependency_child_keys:
            continue
        member_features = [f for f in group.features]

        items.append({
            "key": f"group:{group.id}",
            "groupId": group.id,
            "featureId": None,
            "name": group.name,
            "status": group.status,
            "kind": group.kind,
            "features": [{"id": f.id, "name": f.name, "status": f.status, "implementationStartedAt": f.implementation_started_at} for f in member_features],
        })
    for feature in project.features:
        if feature.group_id is None and ("feature", feature.id) not in dependency_child_keys:
            items.append({
                "key": f"feature:{feature.id}",
                "groupId": None,
                "featureId": feature.id,
                "name": feature.name,
                "status": feature.status,
                "kind": None,
                "implementationStartedAt": feature.implementation_started_at,
                "features": [],
            })

    item_lookup = {("group" if item["groupId"] else "feature", item["groupId"] or item["featureId"]): item for item in items}
    for edge in dependency_rows:
        parent_item = item_lookup.get((edge.parent_type, edge.parent_id))
        if not parent_item:
            continue
        child = _dependency_entity(db, project_id, edge.child_type, edge.child_id)
        parent_item.setdefault("dependencies", []).append({
            "id": edge.child_id,
            "dependencyId": edge.id,
            "type": edge.child_type,
            "name": child.name, "status": child.status,
            "features": ([{"id": f.id, "name": f.name, "status": f.status} for f in child.features] if edge.child_type == "group" else []),
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
            "dependencies": item.get("dependencies", []),
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
