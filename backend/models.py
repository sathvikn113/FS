from datetime import datetime
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
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
    created_at = Column(DateTime, default=datetime.utcnow)

    features = relationship(
        "Feature",
        back_populates="project",
        cascade="all, delete-orphan",
    )
    responses = relationship(
        "Response",
        back_populates="project",
        cascade="all, delete-orphan",
    )


class Feature(Base):
    __tablename__ = "features"

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="planned", server_default="planned")
    implementation_started_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="features")
    allocations = relationship(
        "Allocation",
        back_populates="feature",
        cascade="all, delete-orphan",
    )


class Response(Base):
    __tablename__ = "responses"

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    stakeholder = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="responses")
    allocations = relationship(
        "Allocation",
        back_populates="response",
        cascade="all, delete-orphan",
    )


class Allocation(Base):
    __tablename__ = "allocations"

    id = Column(String, primary_key=True)
    response_id = Column(String, ForeignKey("responses.id"), nullable=False)
    feature_id = Column(String, ForeignKey("features.id"), nullable=False)
    percentage = Column(Integer, nullable=False)

    response = relationship("Response", back_populates="allocations")
    feature = relationship("Feature", back_populates="allocations")


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
    status: Literal["planned", "in_progress", "implemented"] | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _required_trimmed_name(value)


class AllocationIn(BaseModel):
    featureId: str
    percentage: int = Field(gt=0, le=100)


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
