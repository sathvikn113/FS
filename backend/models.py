from datetime import datetime
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


def new_id() -> str:
    return str(uuid4())


def _required_trimmed_name(value: str) -> str:
    trimmed = value.strip()
    if not trimmed:
        raise ValueError("Name cannot be empty")
    return trimmed


class Project(Base):
    __tablename__ = "projects"

    id = Column(String, primary_key=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    support_email = Column(String(254), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    features = relationship("Feature", back_populates="project", cascade="all, delete-orphan")
    responses = relationship("Response", back_populates="project", cascade="all, delete-orphan")
    feature_groups = relationship("FeatureGroup", back_populates="project", cascade="all, delete-orphan")


class FeatureGroup(Base):
    __tablename__ = "feature_groups"

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="pending", server_default="pending")
    kind = Column(String(20), nullable=False, default="group", server_default="group")
    implementation_started_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="feature_groups")
    features = relationship("Feature", back_populates="feature_group")


class FeatureDependency(Base):
    __tablename__ = "feature_dependencies"
    __table_args__ = (
        UniqueConstraint(
            "project_id", "parent_type", "parent_id", "child_type", "child_id",
            name="uq_feature_dependency_edge",
        ),
        CheckConstraint("parent_type IN ('feature', 'group')", name="ck_dependency_parent_type"),
        CheckConstraint("child_type IN ('feature', 'group')", name="ck_dependency_child_type"),
    )

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_type = Column(String(20), nullable=False)
    parent_id = Column(String, nullable=False)
    child_type = Column(String(20), nullable=False)
    child_id = Column(String, nullable=False)
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project")


class Feature(Base):
    __tablename__ = "features"

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    group_id = Column(String, ForeignKey("feature_groups.id", ondelete="SET NULL"), nullable=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="pending", server_default="pending")
    implementation_started_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="features")
    feature_group = relationship("FeatureGroup", back_populates="features")
    allocations = relationship("Allocation", back_populates="feature")


class Response(Base):
    __tablename__ = "responses"

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    stakeholder = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="responses")
    allocations = relationship("Allocation", back_populates="response", cascade="all, delete-orphan")


class Allocation(Base):
    __tablename__ = "allocations"
    __table_args__ = (
        CheckConstraint(
            "(feature_id IS NOT NULL AND group_id IS NULL) OR (feature_id IS NULL AND group_id IS NOT NULL)",
            name="ck_allocation_exactly_one_target",
        ),
    )

    id = Column(String, primary_key=True)
    response_id = Column(String, ForeignKey("responses.id"), nullable=False)
    # Existing feature allocations remain valid; new group votes use group_id.
    feature_id = Column(String, ForeignKey("features.id"), nullable=True)
    group_id = Column(String, ForeignKey("feature_groups.id", ondelete="CASCADE"), nullable=True)
    percentage = Column(Integer, nullable=False)

    response = relationship("Response", back_populates="allocations")
    feature = relationship("Feature", back_populates="allocations")
    feature_group = relationship("FeatureGroup")


class FeatureIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=5000)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return _required_trimmed_name(value)


class FeatureUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=5000)
    status: Literal["pending", "planned", "in_progress", "implemented", "rejected"] | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _required_trimmed_name(value)


class FeatureGroupIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=5000)
    feature_ids: list[str] = Field(min_length=2)
    kind: Literal["group", "depends"] = "group"

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return _required_trimmed_name(value)

    @field_validator("feature_ids")
    @classmethod
    def validate_unique_features(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("Select each feature only once")
        return value


class FeatureGroupUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    status: Literal["pending", "planned", "in_progress", "implemented", "rejected"] | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _required_trimmed_name(value)


class AllocationIn(BaseModel):
    featureId: str | None = None
    groupId: str | None = None
    percentage: int = Field(gt=0, le=100)

    @model_validator(mode="after")
    def exactly_one_target(self):
        if bool(self.featureId) == bool(self.groupId):
            raise ValueError("Each allocation must reference either a feature or a group")
        return self


class ResponseIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    stakeholder: str | None = Field(default=None, max_length=255)
    allocations: list[AllocationIn]


class ProjectIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=5000)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return _required_trimmed_name(value)


class FeatureDependencyIn(BaseModel):
    parent_type: Literal["feature", "group"]
    parent_id: str = Field(min_length=1)
    child_type: Literal["feature", "group"]
    child_id: str = Field(min_length=1)
