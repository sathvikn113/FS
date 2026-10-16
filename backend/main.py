from datetime import datetime, timezone
from fastapi import Depends, FastAPI, HTTPException
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
app = FastAPI(title="Feature Prioritizer API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def clean_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None

@app.get("/api/projects")
def list_projects(db: Session = Depends(get_db)):
    return db.query(Project).order_by(Project.created_at.desc()).all()

@app.post("/api/projects", status_code=201)
def create_project(body: ProjectIn, db: Session = Depends(get_db)):
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
def get_project_detail(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project

@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    db.delete(project)
    db.commit()
    return {"ok": True}

@app.post("/api/projects/{project_id}/features", status_code=201)
def add_feature(project_id: str, body: FeatureIn, db: Session = Depends(get_db)):
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
def delete_feature(project_id: str, feature_id: str, db: Session = Depends(get_db)):
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
def list_features(project_id: str, db: Session = Depends(get_db)):
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
def submit_response(project_id: str, body: ResponseIn, db: Session = Depends(get_db)):
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
def get_results(project_id: str, db: Session = Depends(get_db)):
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

