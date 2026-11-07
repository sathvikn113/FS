import os
import re
from datetime import datetime, timezone
import httpx
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
    "http://127.0.0.1:4180/oauth2/auth",
)



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


def get_current_user(request: Request) -> dict:
    subject = request.headers.get("X-Authenticated-User")
    username = request.headers.get("X-Authenticated-Username")
    email = request.headers.get("X-Authenticated-Email")
    groups_header = request.headers.get("X-Authenticated-Groups", "")

    print("DEBUG USER:", subject)
    print("DEBUG GROUPS HEADER:", repr(groups_header))
    print("USERNAME HEADER:", repr(username))

    if not subject:
        raise HTTPException(
            status_code=401,
            detail="Not authenticated",
        )

    # OAuth2 Proxy is forwarding Keycloak client roles in this header,
    # for example: role:Features_Selector:main_admin.
    # It also forwards project group paths, for example:
    # /DevStation/app_admin.
    header_items = [
        item.strip()
        for item in groups_header.split(",")
        if item.strip()
    ]

    roles = set()
    project_groups = []

    for item in header_items:
        if item.startswith("role:"):
            role_value = item[len("role:"):].strip()
            role_parts = role_value.split(":")

            # Recognise only the application roles from our Keycloak client.
            if len(role_parts) >= 2 and role_parts[-2] == "Features_Selector":
                role_name = role_parts[-1]
                if role_name in {"main_admin", "app_admin", "users"}:
                    roles.add(role_name)
            elif role_value in {"main_admin", "app_admin", "users"}:
                # Also support a role forwarded without the client prefix.
                roles.add(role_value)
            continue

        # Keep only actual Keycloak group paths for project-level checks.
        if item.startswith("/"):
            normalized_path = "/" + "/".join(
                part for part in item.strip("/").split("/") if part
            )
            if normalized_path not in project_groups:
                project_groups.append(normalized_path)

        # Backward compatibility if a deployment sends root group names
        # instead of client roles.
        normalized_group = item.strip("/")
        if normalized_group in {"main_admin", "app_admin", "users"}:
            roles.add(normalized_group)

    if not roles:
        raise HTTPException(
            status_code=403,
            detail="No valid Features_Selector role found",
        )

    resolved_username = (
        username
        or (email.split("@")[0] if email else None)
        or subject
    )

    return {
        "id": subject,
        "username": resolved_username,
        "email": email,
        "roles": sorted(roles),
        "groups": project_groups,
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
    if user is None:
        raise HTTPException(
            status_code=401,
            detail="User information is missing"
        )
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
    allowed = can_manage_project(user, project)
    print(
        "RBAC PROJECT CHECK:",
        {
            "project_id": project_id,
            "project_name": project.name,
            "user_id": user.get("id"),
            "roles": user.get("roles"),
            "groups": user.get("groups"),
            "required_group": f"/{project.name}/app_admin",
            "is_admin": user.get("is_admin"),
            "is_app_admin": user.get("is_app_admin"),
            "allowed": allowed,
        },
    )
    if not allowed:
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
    # Prevent cycles: the proposed child must not already lead back to the parent.
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
            "implemented_at": group.implemented_at,
            "created_at": group.created_at,
            "features": [
                {"id": feature.id, "name": feature.name, "description": feature.description, "status": feature.status, "implementation_started_at": feature.implementation_started_at, "implemented_at": feature.implemented_at}
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
        "implemented_at": group.implemented_at,
        "created_at": group.created_at,
        "features": [{"id": f.id, "name": f.name, "description": f.description, "status": f.status, "implementation_started_at": f.implementation_started_at, "implemented_at": f.implemented_at} for f in selected],
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
    if not body.feature_ids:
        raise HTTPException(
            status_code=400,
            detail="Select at least one feature to add",
        )

    if len(body.feature_ids) != len(set(body.feature_ids)):
        raise HTTPException(
            status_code=400,
            detail="Duplicate feature IDs are not allowed",
        )
   
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

    if any(feature.group_id is not None for feature in features):
        raise HTTPException(
            status_code=400,
            detail="Selected features must be ungrouped first",
        )

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
    if body.status is not None and body.status != group.status:
        now = datetime.now(timezone.utc)
        if body.status == "in_progress":
            group.implementation_started_at = now
            group.implemented_at = None
        elif body.status == "implemented":
            group.implemented_at = now
        else:
            group.implementation_started_at = None
            group.implemented_at = None
        group.status = body.status
        if body.status in {"implemented", "rejected"}:
            _remove_parent_dependencies(db, project_id, "group", group_id)
            db.query(FeatureDependency).filter(
                FeatureDependency.project_id == project_id,
                FeatureDependency.child_type == "group",
                FeatureDependency.child_id == group_id,
            ).delete(synchronize_session=False)
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
        "implemented_at": group.implemented_at,
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
    print(
        "ADD FEATURE AUTH:",
        {
            "project_id": project_id,
            "user_id": user.get("id"),
            "username": user.get("username"),
            "roles": user.get("roles"),
            "groups": user.get("groups"),
        },
    )
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
    new_status = changes.get("status")
    if new_status is not None and new_status != feature.status:
        now = datetime.now(timezone.utc)
        if new_status == "in_progress":
            feature.implementation_started_at = now
            feature.implemented_at = None
        elif new_status == "implemented":
            feature.implemented_at = now
        else:
            feature.implementation_started_at = None
            feature.implemented_at = None
    if new_status in {"implemented", "rejected"}:
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
        db.query(Allocation).filter(
            Allocation.feature_id == feature_id
        ).delete(synchronize_session=False)
   
        db.query(FeatureDependency).filter(
            FeatureDependency.project_id == project_id,
            ((FeatureDependency.parent_type == "feature") & (FeatureDependency.parent_id == feature_id)) |
            ((FeatureDependency.child_type == "feature") & (FeatureDependency.child_id == feature_id)),
        ).delete(synchronize_session=False)

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

    # Keep historical allocations for every feature/group, including dependency children.
    # Grouping retains the existing rule: member allocations belong to their group.
    totals = {f"group:{group.id}": 0 for group in groups}
    contributors = {key: 0 for key in totals}
    for feature in project.features:
        if feature.group_id is None:
            totals[f"feature:{feature.id}"] = 0
            contributors[f"feature:{feature.id}"] = 0

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
                totals[key] += allocation.percentage
                if allocation.percentage > 0:
                    contributors[key] += 1

    children_by_parent = {}
    for edge in dependency_rows:
        parent_key = f"{edge.parent_type}:{edge.parent_id}"
        child_key = f"{edge.child_type}:{edge.child_id}"
        children_by_parent.setdefault(parent_key, set()).add(child_key)

    def combined_score(key, visited=None):
        visited = set() if visited is None else visited
        if key in visited:
            return 0, 0
        visited.add(key)
        score = totals.get(key, 0)
        count = contributors.get(key, 0)
        for child_key in children_by_parent.get(key, ()):
            child_score, child_count = combined_score(child_key, visited)
            score += child_score
            count += child_count
        return score, count


    items = []
    for group in groups:
        if ("group", group.id) in dependency_child_keys:
            continue
        member_features = [f for f in group.features]
        # Groups containing only implemented features are still shown in historical results.
        items.append({
            "key": f"group:{group.id}",
            "groupId": group.id,
            "featureId": None,
            "name": group.name,
            "status": group.status,
            "kind": group.kind,
            "features": [{"id": f.id, "name": f.name, "status": f.status, "implementationStartedAt": f.implementation_started_at, "implementedAt": f.implemented_at} for f in member_features],
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
                "implementedAt": feature.implemented_at,
                "features": [],
            })
    def build_dependency_tree(parent_type, parent_id, visited=None):
        # Keep the complete chain in the results payload (C -> A -> B),
        # while guarding against malformed/corrupt cyclic data.
        visited = set() if visited is None else set(visited)
        parent_key = (parent_type, parent_id)
        if parent_key in visited:
            return []
        visited.add(parent_key)

        nested = []
        for edge in dependency_rows:
            if edge.parent_type != parent_type or edge.parent_id != parent_id:
                continue
            child_key = (edge.child_type, edge.child_id)
            child = _dependency_entity(db, project_id, edge.child_type, edge.child_id)
            nested.append({
                "id": edge.id,
                "type": edge.child_type,
                "id": edge.child_id,
                "name": child.name,
                "status": child.status,
                "features": ([
                    {"id": f.id, "name": f.name, "status": f.status}
                    for f in child.features
                ] if edge.child_type == "group" else []),
                "dependencies": build_dependency_tree(edge.child_type, edge.child_id, visited),
            })
        return nested

    for item in items:
        item_type = "group" if item["groupId"] else "feature"
        item_id = item["groupId"] or item["featureId"]
        item["dependencies"] = build_dependency_tree(item_type, item_id)
    # Sum each top-level item after dependency scores have been rolled into parents.
    # This preserves group aggregation and prevents dependency children being counted twice.
    total_points = sum(combined_score(item["key"])[0] for item in items)

    ranked = sorted(items, key=lambda item: (-combined_score(item["key"])[0], item["name"].casefold()))
    results = []
    for rank, item in enumerate(ranked, start=1):
        score, contributor_count = combined_score(item["key"])
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
            "contributors": contributor_count,
            "stakeholderCount": contributor_count,
        })
    return {
        "projectName": project.name,
        "responseCount": len(project.responses),
        "totalPoints": total_points,
        "results": results,
    }
