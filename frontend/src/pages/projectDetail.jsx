import { useEffect, useMemo, useRef, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  Popover,
  Skeleton,
  Slider,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import BarChartRoundedIcon from "@mui/icons-material/BarChartRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import SendRoundedIcon from "@mui/icons-material/SendRounded";

import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../AuthContext.jsx";

const IMPLEMENTATION_STATUSES = [
  { value: "planned", label: "Planned", color: "#8B5CF6" },
  { value: "in_progress", label: "In Progress", color: "#FACC15" },
  { value: "implemented", label: "Implemented", color: "#22C55E" },
];

function createEqualAllocation(features) {
  if (!features.length) return {};

  const base = Math.floor(100 / features.length);
  let remainder = 100 - base * features.length;

  return Object.fromEntries(
    features.map((feature) => {
      const value = base + (remainder > 0 ? 1 : 0);
      remainder -= remainder > 0 ? 1 : 0;
      return [feature.id, value];
    })
  );
}

function distributeUntouched(state, activeFeatures) {
  const activeIds = new Set(activeFeatures.map((feature) => feature.id));

  const pinnedIds = new Set(
    [...state.pinnedIds].filter((featureId) => activeIds.has(featureId))
  );

  const values = Object.fromEntries(
    activeFeatures.map((feature) => [
      feature.id,
      Math.max(0, Number(state.values[feature.id]) || 0),
    ])
  );

  const pinnedTotal = [...pinnedIds].reduce(
    (sum, featureId) => sum + values[featureId],
    0
  );

  const untouched = activeFeatures.filter(
    (feature) => !pinnedIds.has(feature.id)
  );

  if (!untouched.length) {
    return { values, pinnedIds };
  }

  const available = Math.max(0, 100 - pinnedTotal);
  const base = Math.floor(available / untouched.length);
  let remainder = available - base * untouched.length;

  untouched.forEach((feature) => {
    values[feature.id] = base + (remainder > 0 ? 1 : 0);
    remainder -= remainder > 0 ? 1 : 0;
  });

  return { values, pinnedIds };
}

function formatStartDate(value) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const roles = user?.roles ?? [];

  const isMainAdmin =
    Boolean(user?.is_admin) || roles.includes("main_admin");

  const isAuthenticated = Boolean(user);

  const [project, setProject] = useState(null);
  const [features, setFeatures] = useState([]);

  const [projectPermissions, setProjectPermissions] = useState(null);

  const canManageFeatures =
    isMainAdmin ||
    projectPermissions?.can_manage_features === true;

  const canAddFeatures = isAuthenticated;
  const canSubmitPrioritization = true;

  const [allocation, setAllocation] = useState({
    values: {},
    pinnedIds: new Set(),
  });

  const [featureName, setFeatureName] = useState("");
  const [featureDescription, setFeatureDescription] = useState("");
  const [stakeholder, setStakeholder] = useState("");

  const [editingFeature, setEditingFeature] = useState(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const [error, setError] = useState("");
  const [loadedFor, setLoadedFor] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  const [pendingAction, setPendingAction] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [statusAnchor, setStatusAnchor] = useState(null);
  const [selectedStatusFeature, setSelectedStatusFeature] =
    useState(null);

  const pendingRef = useRef(false);
  const submitRef = useRef(false);

  const activeFeatures = useMemo(
    () => features.filter((feature) => feature.status !== "implemented"),
    [features]
  );

  const implementedFeatures = useMemo(
    () => features.filter((feature) => feature.status === "implemented"),
    [features]
  );

  const activeTotal = useMemo(
    () =>
      activeFeatures.reduce(
        (sum, feature) =>
          sum + Number(allocation.values[feature.id] || 0),
        0
      ),
    [activeFeatures, allocation.values]
  );

  const remaining = 100 - activeTotal;
  const requestKey = `${id}:${retryKey}`;
  const isLoading = loadedFor !== requestKey;

  // Load public project data independently from permission data.
  useEffect(() => {
    const controller = new AbortController();
    let current = true;

    async function loadProjectData() {
      try {
        const [projectData, featureData] = await Promise.all([
          api.getProject(id, controller.signal),
          api.getFeatures(id, controller.signal),
        ]);

        if (!current) return;

        setProject(projectData);
        setFeatures(featureData);

        const active = featureData.filter(
          (feature) => feature.status !== "implemented"
        );

        setAllocation({
          values: createEqualAllocation(active),
          pinnedIds: new Set(),
        });

        setError("");
      } catch (err) {
        if (!current || controller.signal.aborted) return;

        setProject(null);
        setError(err.message || "Unable to load project.");
      } finally {
        if (current) setLoadedFor(requestKey);
      }
    }

    async function loadPermissions() {
      if (!isAuthenticated) {
        setProjectPermissions(null);
        return;
      }

      try {
        const permissions = await api.getProjectPermissions(
          id,
          controller.signal
        );

        if (current) {
          setProjectPermissions(permissions);
        }
      } catch {
        if (current) {
          // Fail closed: do not show project-management controls
          // when the permission response cannot be retrieved.
          setProjectPermissions(null);
        }
      }
    }

    loadProjectData();
    loadPermissions();

    return () => {
      current = false;
      controller.abort();
    };
  }, [id, retryKey, requestKey, isAuthenticated]);

  const runMutation = async (key, operation, onSuccess) => {
    if (pendingRef.current || submitRef.current) return;

    pendingRef.current = true;
    setPendingAction(key);
    setError("");

    try {
      const result = await operation();
      onSuccess(result);
    } catch (err) {
      setError(err.message || "The operation failed.");
    } finally {
      pendingRef.current = false;
      setPendingAction("");
    }
  };

  const reconcile = (nextFeatures, current) =>
    distributeUntouched(
      current,
      nextFeatures.filter((feature) => feature.status !== "implemented")
    );

  const addFeature = async (event) => {
    event?.preventDefault();

    const name = featureName.trim();

    if (!name || pendingRef.current) return;

    if (!canAddFeatures) {
      setError("Sign in to add features.");
      return;
    }

    await runMutation(
      "add-feature",
      () =>
        api.addFeature(id, {
          name,
          description: featureDescription.trim() || null,
        }),
      (createdFeature) => {
        const next = [...features, createdFeature];

        setFeatures(next);
        setAllocation((current) => reconcile(next, current));

        setFeatureName("");
        setFeatureDescription("");
      }
    );
  };

  const openEditor = (feature) => {
    if (!canManageFeatures) return;

    setEditingFeature(feature);
    setEditName(feature.name);
    setEditDescription(feature.description || "");
    setError("");
  };

  const saveFeature = async (event) => {
    event?.preventDefault();

    if (!canManageFeatures) return;
    if (!editingFeature || !editName.trim() || pendingRef.current) return;

    await runMutation(
      `edit-${editingFeature.id}`,
      () =>
        api.updateFeature(id, editingFeature.id, {
          name: editName.trim(),
          description: editDescription.trim() || null,
        }),
      (updated) => {
        const next = features.map((feature) =>
          feature.id === updated.id ? updated : feature
        );

        setFeatures(next);
        setAllocation((current) => reconcile(next, current));
        setEditingFeature(null);
      }
    );
  };

  const updateStatus = async (feature, status) => {
    if (!canManageFeatures) return;
    if (pendingRef.current || status === feature.status) return;

    await runMutation(
      `status-${feature.id}`,
      () => api.updateFeature(id, feature.id, { status }),
      (updated) => {
        setFeatures((current) =>
          current.map((item) =>
            item.id === updated.id ? updated : item
          )
        );

        setAllocation((current) => {
          const nextFeatures = features.map((item) =>
            item.id === updated.id ? updated : item
          );

          return reconcile(nextFeatures, current);
        });
      }
    );
  };

  const removeFeature = async () => {
    if (!canManageFeatures) return;
    if (!deleteTarget || pendingRef.current) return;

    await runMutation(
      `delete-${deleteTarget.id}`,
      () => api.deleteFeature(id, deleteTarget.id),
      () => {
        const next = features.filter(
          (feature) => feature.id !== deleteTarget.id
        );

        setFeatures(next);
        setAllocation((current) => reconcile(next, current));
        setDeleteTarget(null);
      }
    );
  };

  const updatePercentage = (featureId, rawValue) => {
    if (!canSubmitPrioritization || submitting) return;

    const numericValue = Array.isArray(rawValue)
      ? rawValue[0]
      : rawValue;

    setAllocation((current) => {
      const pinnedOtherTotal = activeFeatures.reduce((sum, feature) => {
        if (
          feature.id === featureId ||
          !current.pinnedIds.has(feature.id)
        ) {
          return sum;
        }

        return sum + Number(current.values[feature.id] || 0);
      }, 0);

      const maxValue = Math.max(0, 100 - pinnedOtherTotal);
      const value = Math.max(
        0,
        Math.min(maxValue, Number(numericValue) || 0)
      );

      const pinnedIds = new Set(current.pinnedIds);
      pinnedIds.add(featureId);

      return distributeUntouched(
        {
          values: { ...current.values, [featureId]: value },
          pinnedIds,
        },
        activeFeatures
      );
    });
  };

  const applyEvenSplit = () => {
    setAllocation({
      values: createEqualAllocation(activeFeatures),
      pinnedIds: new Set(),
    });

    setConfirmReset(false);
  };

  const resetAllocation = () => {
    const equal = createEqualAllocation(activeFeatures);

    const changed =
      activeFeatures.some(
        (feature) =>
          Number(allocation.values[feature.id] || 0) !==
          equal[feature.id]
      ) || allocation.pinnedIds.size > 0;

    if (changed) {
      setConfirmReset(true);
    } else {
      applyEvenSplit();
    }
  };

  const submitPrioritization = async () => {
    if (!isAuthenticated) {
  const returnUrl = window.location.href;

  window.location.href =
    "http://localhost:4180/oauth2/start?rd=" +
    encodeURIComponent(returnUrl);

  return;
}
    if (!canSubmitPrioritization) {
      setError("Sign in to submit prioritization.");
      return;
    }

    if (activeFeatures.length < 2) {
      setError("Add at least 2 active features to submit.");
      return;
    }

    if (activeTotal !== 100) {
      setError("Allocation must equal exactly 100%.");
      return;
    }

    if (submitting || submitRef.current || pendingRef.current) return;

    const allocations = activeFeatures
      .filter(
        (feature) =>
          Number(allocation.values[feature.id] || 0) > 0
      )
      .map((feature) => ({
        featureId: feature.id,
        percentage: Number(allocation.values[feature.id]),
      }));

    try {
      submitRef.current = true;
      setSubmitting(true);
      setError("");

      await api.submitResponse(id, {
        stakeholder: stakeholder.trim() || "Anonymous",
        allocations,
      });

      navigate(`/project/${id}/results`, {
        state: { submitted: true },
      });
    } catch (err) {
      setError(err.message || "Failed to submit prioritization.");
    } finally {
      submitRef.current = false;
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ pt: 5 }} aria-label="Loading project">
        <Skeleton variant="text" width="42%" height={56} />
        <Skeleton
          variant="rounded"
          height={360}
          sx={{ mt: 2 }}
        />
      </Box>
    );
  }

  if (!project) {
    return (
      <Box sx={{ pt: 5 }}>
        <Alert
          severity="error"
          action={
            <Button
              color="inherit"
              onClick={() => setRetryKey((key) => key + 1)}
            >
              Retry
            </Button>
          }
        >
          {error || "Project not found."}
        </Alert>

        <Button
          startIcon={<ArrowBackRoundedIcon />}
          onClick={() => navigate("/")}
          sx={{ mt: 2 }}
        >
          All projects
        </Button>
      </Box>
    );
  }

  const renderFeature = (feature, implemented = false) => {
    const value = Number(allocation.values[feature.id] || 0);
    const startDate = formatStartDate(
      feature.implementation_started_at
    );

    const currentStatus =
      IMPLEMENTATION_STATUSES.find(
        (item) => item.value === feature.status
      ) || IMPLEMENTATION_STATUSES[0];

    return (
      <Box key={feature.id} component="article" sx={{ py: 2.25 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={{ xs: 1.25, sm: 1.75 }}
          sx={{
            alignItems: { xs: "stretch", sm: "center" },
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              component="h3"
              variant="body1"
              fontWeight={650}
              sx={{ overflowWrap: "anywhere" }}
            >
              {feature.name}
            </Typography>

            {feature.description && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.25, overflowWrap: "anywhere" }}
              >
                {feature.description}
              </Typography>
            )}

            {startDate && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                Implementation started {startDate}
              </Typography>
            )}
          </Box>

          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={{ xs: 0.75, sm: 1 }}
            sx={{
              width: { xs: "100%", sm: "auto" },
              alignItems: { xs: "stretch", sm: "center" },
            }}
          >
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "center", minWidth: 0 }}
            >
              {canManageFeatures ? (
                <>
                  <Button
                    onClick={(event) => {
                      setStatusAnchor(event.currentTarget);
                      setSelectedStatusFeature(feature);
                    }}
                    disabled={Boolean(pendingAction) || submitting}
                    sx={{
                      minWidth: 130,
                      minHeight: 38,
                      px: 1.5,
                      borderRadius: "9px",
                      textTransform: "none",
                      justifyContent: "flex-start",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      boxShadow: "none",
                      color: currentStatus.color,
                      backgroundColor: `${currentStatus.color}1A`,
                      border: "1px solid",
                      borderColor: `${currentStatus.color}40`,
                      "&:hover": {
                        boxShadow: "none",
                        backgroundColor: `${currentStatus.color}2B`,
                      },
                    }}
                  >
                    <Box
                      component="span"
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        flexShrink: 0,
                        mr: 1,
                        backgroundColor: currentStatus.color,
                      }}
                    />

                    {currentStatus.label}
                  </Button>

                  <Popover
                    open={
                      Boolean(statusAnchor) &&
                      selectedStatusFeature?.id === feature.id
                    }
                    anchorEl={statusAnchor}
                    onClose={() => {
                      setStatusAnchor(null);
                      setSelectedStatusFeature(null);
                    }}
                    anchorOrigin={{
                      vertical: "bottom",
                      horizontal: "left",
                    }}
                    transformOrigin={{
                      vertical: "top",
                      horizontal: "left",
                    }}
                    slotProps={{
                      paper: {
                        sx: {
                          mt: 0.75,
                          p: 0.75,
                          borderRadius: "12px",
                          bgcolor: "#1B211E",
                          border: "1px solid rgba(255,255,255,0.1)",
                          boxShadow: "0 8px 28px rgba(0,0,0,0.3)",
                        },
                      },
                    }}
                  >
                    <Stack spacing={0.5}>
                      {IMPLEMENTATION_STATUSES.map((status) => (
                        <Button
                          key={status.value}
                          onClick={async () => {
                            setStatusAnchor(null);
                            setSelectedStatusFeature(null);
                            await updateStatus(feature, status.value);
                          }}
                          disabled={
                            Boolean(pendingAction) ||
                            submitting ||
                            feature.status === status.value
                          }
                          sx={{
                            justifyContent: "flex-start",
                            textTransform: "none",
                            borderRadius: "8px",
                            px: 1.5,
                            py: 1,
                            minWidth: 145,
                            color: status.color,
                            backgroundColor:
                              feature.status === status.value
                                ? `${status.color}20`
                                : "transparent",
                            "&:hover": {
                              backgroundColor: `${status.color}20`,
                            },
                          }}
                        >
                          <Box
component="span"
                            sx={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              backgroundColor: status.color,
                              mr: 1,
                            }}
                          />
                          {status.label}
                        </Button>
                      ))}
                    </Stack>
                  </Popover>
                </>
              ) : (
                <Chip
                  size="small"
                  label={currentStatus.label}
                  variant="outlined"
                  sx={{
                    minWidth: 130,
                    minHeight: 38,
                    justifyContent: "flex-start",
                    borderRadius: "9px",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    backgroundColor: `${currentStatus.color}1A`,
                    color: currentStatus.color,
                    borderColor: `${currentStatus.color}40`,
                    "& .MuiChip-label": { px: 1.5 },
                  }}
                />
              )}

              <Typography
                component="span"
                variant="body2"
                fontWeight={700}
                sx={{ minWidth: 48, textAlign: "right" }}
              >
                {implemented ? "Done" : `${value}%`}
              </Typography>
            </Stack>

            {canManageFeatures && (
              <Stack
                direction="row"
                spacing={0.5}
                sx={{
                  alignItems: "center",
                  justifyContent: {
                    xs: "flex-end",
                    sm: "flex-start",
                  },
                }}
              >
                <Tooltip title={`Edit ${feature.name}`}>
                  <IconButton
                    aria-label={`Edit ${feature.name}`}
                    onClick={() => openEditor(feature)}
                    disabled={Boolean(pendingAction) || submitting}
                    sx={{ width: 44, height: 44 }}
                  >
                    <EditOutlinedIcon />
                  </IconButton>
                </Tooltip>

                <Tooltip title={`Delete ${feature.name}`}>
                  <IconButton
                    aria-label={`Delete ${feature.name}`}
                    color="error"
                    onClick={() => setDeleteTarget(feature)}
                    disabled={Boolean(pendingAction) || submitting}
                    sx={{ width: 44, height: 44 }}
                  >
                    <DeleteOutlineRoundedIcon />
                  </IconButton>
                </Tooltip>
              </Stack>
            )}
          </Stack>
        </Stack>

        {!implemented ? (
          <Slider
            aria-label={`Allocation for ${feature.name}`}
            aria-valuetext={`${value}% allocation for ${feature.name}`}
            value={value}
            min={0}
            max={100}
            step={1}
            onChange={(_, newValue) =>
              updatePercentage(feature.id, newValue)
            }
            disabled={
              Boolean(pendingAction) ||
              submitting
            }
            sx={{ mt: 0.75, mb: -0.5, color: "primary.main" }}
          />
        ) : (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.75 }}
          >
            This feature is excluded from new allocations.
          </Typography>
        )}
      </Box>
    );
  };

  const submitDisabled =
    activeFeatures.length < 2 ||
    activeTotal !== 100 ||
    submitting;

  const allocationSummary = (
    <Stack spacing={1.25}>
      <Stack
        direction="row"
        sx={{
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <Typography component="h2" variant="h6">
          Allocation
        </Typography>

        <Typography
          variant="h4"
          fontWeight={700}
          sx={{ fontVariantNumeric: "tabular-nums" }}
        >
          {activeTotal}%
        </Typography>
      </Stack>

      <LinearProgress
        variant="determinate"
        color={activeTotal === 100 ? "success" : "primary"}
        value={Math.min(activeTotal, 100)}
        sx={{ height: 7, borderRadius: "4px" }}
        aria-label={`${activeTotal}% allocated`}
      />

      <Typography
        variant="body2"
        color={remaining === 0 ? "success.main" : "text.secondary"}
      >
        {remaining === 0
          ? "All 100 points are assigned."
          : remaining > 0
            ? `${remaining} points remaining.`
            : `${Math.abs(remaining)} points over.`}
      </Typography>

      {activeFeatures.length < 2 ? (
        <Typography variant="body2" color="text.secondary">
          Add at least 2 active features to submit.
        </Typography>
      ) : activeTotal !== 100 ? (
        <Typography variant="body2" color="warning.main">
          Allocation must equal exactly 100%.
        </Typography>
      ) : (
        <Typography variant="body2" color="text.secondary">
          Ready to submit.
        </Typography>
      )}

      <Button
        fullWidth
        variant="contained"
        size="large"
        onClick={submitPrioritization}
        disabled={submitDisabled}
        startIcon={<SendRoundedIcon />}
        sx={{ minHeight: 48 }}
      >
        {submitting ? "Submitting…" : "Submit prioritization"}
      </Button>
    </Stack>
  );

  return (
    <Box sx={{ pb: { xs: 13, md: 7 }, pt: { xs: 3, md: 4 } }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{
          alignItems: { xs: "flex-start", sm: "center" },
          justifyContent: "space-between",
          mb: 3,
        }}
      >
        <Box>
          <Button
            startIcon={<ArrowBackRoundedIcon />}
            onClick={() => navigate("/")}
            sx={{ mb: 0.75, px: 0, minHeight: 40 }}
          >
            All projects
          </Button>

          <Typography component="h1" variant="h3">
            {project.name}
          </Typography>

          {project.description && (
            <Typography
              color="text.secondary"
              sx={{ mt: 0.5, maxWidth: 680 }}
            >
              {project.description}
            </Typography>
          )}
        </Box>

        <Button
          variant="outlined"
          startIcon={<BarChartRoundedIcon />}
          onClick={() => navigate(`/project/${id}/results`)}
          sx={{
            minHeight: 44,
            borderRadius: "8px",
            flexShrink: 0,
          }}
        >
          View results
        </Button>
      </Stack>

      {error && !editingFeature && !deleteTarget && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          onClose={() => setError("")}
        >
          {error}
        </Alert>
      )}

      {!isAuthenticated && (
        <Alert severity="info" sx={{ mb: 2 }}>
          You can view this project publicly. Sign in to add features or
          submit prioritization.
        </Alert>
      )}

      {isAuthenticated &&
        roles.includes("app_admin") &&
        !isMainAdmin &&
        projectPermissions === null && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Project-management permissions could not be loaded. Editing,
            deleting, and status changes are disabled until permissions
            are available.
          </Alert>
        )}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "minmax(0, 1fr)",
            md: "minmax(0, 1.7fr) minmax(260px, 0.7fr)",
          },
          gap: { xs: 3, md: 5 },
          alignItems: "start",
        }}
      >
        <Box
          component="section"
          aria-labelledby="prioritize-heading"
          sx={{ minWidth: 0 }}
        >
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{
              alignItems: { xs: "flex-start", sm: "center" },
              justifyContent: "space-between",
              mb: 1,
            }}
          >
            <Typography
              component="h2"
              id="prioritize-heading"
              variant="h5"
            >
              Prioritize features
            </Typography>

            <Chip
              size="small"
              label={`${activeFeatures.length} active`}
              variant="outlined"
            />
          </Stack>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mb: 2.5 }}
          >
            Move a slider to set its percentage. The remaining active
            features share the remaining points equally.
          </Typography>

          {canAddFeatures && (
            <Stack
              component="form"
              onSubmit={addFeature}
              spacing={1.5}
              sx={{ mb: 2.5 }}
            >
              <TextField
                fullWidth
                required
                label="Feature name"
                placeholder="e.g. Saved searches"
                value={featureName}
                onChange={(event) => setFeatureName(event.target.value)}
                slotProps={{ htmlInput: { maxLength: 255 } }}
              />

              <TextField
                fullWidth
                label="Feature description (optional)"
                placeholder="What should this feature do?"
                value={featureDescription}
                onChange={(event) =>
                  setFeatureDescription(event.target.value)
                }
                multiline
                minRows={2}
                maxRows={4}
                slotProps={{ htmlInput: { maxLength: 5000 } }}
              />

              <Button
                type="submit"
                variant="outlined"
                startIcon={<AddRoundedIcon />}
                disabled={
                  !featureName.trim() || Boolean(pendingAction)
                }
                sx={{
                  alignSelf: { xs: "stretch", sm: "flex-end" },
                  minHeight: 44,
                  minWidth: 150,
                }}
              >
                {pendingAction === "add-feature"
                  ? "Adding feature…"
                  : "Add feature"}
              </Button>
            </Stack>
          )}

          {activeFeatures.length === 0 ? (
            <Box
              sx={{
                py: 4,
                borderTop: "1px solid",
                borderColor: "divider",
              }}
            >
              <Typography fontWeight={650}>
                No active features yet
              </Typography>

              <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                Add at least two active features to collect prioritization
                responses.
              </Typography>
            </Box>
          ) : (
            <Stack
              component="ul"
              divider={<Divider flexItem />}
              sx={{
                m: 0,
                p: 0,
                listStyle: "none",
                borderTop: "1px solid",
                borderColor: "divider",
              }}
            >
              {activeFeatures.map((feature) => (
                <Box component="li" key={feature.id}>
                  {renderFeature(feature)}
                </Box>
              ))}
            </Stack>
          )}

          {implementedFeatures.length > 0 && (
            <Accordion
              disableGutters
              elevation={0}
              sx={{
                mt: 2,
                borderTop: "1px solid",
                borderBottom: "1px solid",
                borderColor: "divider",
                bgcolor: "transparent",
                "&::before": { display: "none" },
              }}
            >
              <AccordionSummary
                expandIcon={<ExpandMoreRoundedIcon />}
                aria-controls="implemented-features-panel"
                id="implemented-features-header"
                sx={{ px: 0 }}
              >
                <Typography
                  component="h2"
                  variant="subtitle1"
                  fontWeight={650}
                >
                  Implemented ({implementedFeatures.length})
                </Typography>
              </AccordionSummary>

              <AccordionDetails
                id="implemented-features-panel"
                sx={{ px: 0, pt: 0 }}
              >
                <Stack
                  component="ul"
                  divider={<Divider flexItem />}
                  sx={{ m: 0, p: 0, listStyle: "none" }}
                >
                  {implementedFeatures.map((feature) => (
                    <Box component="li" key={feature.id}>
                      {renderFeature(feature, true)}
                    </Box>
                  ))}
                </Stack>
              </AccordionDetails>
            </Accordion>
          )}
        </Box>

        <Box
          component="aside"
          aria-label="Allocation and submission"
          sx={{
            display: { xs: "none", md: "block" },
            position: "sticky",
            top: 24,
            minWidth: 0,
            borderTop: "2px solid",
            borderColor: "primary.main",
            pt: 2,
          }}
        >
          {allocationSummary}
        </Box>
      </Box>

      <Box
        component="aside"
        aria-label="Allocation and submit"
        sx={{
          display: { xs: "block", md: "none" },
          position: "fixed",
          zIndex: (theme) => theme.zIndex.appBar - 1,
          bottom: 0,
          left: 0,
          right: 0,
          bgcolor: "background.paper",
          borderTop: "1px solid",
          borderColor: "divider",
          px: 2,
          pt: 1.25,
          pb: "max(12px, env(safe-area-inset-bottom))",
        }}
      >
        <Stack
          direction="row"
          spacing={1.5}
          sx={{
            alignItems: "center",
            maxWidth: 1180,
            mx: "auto",
          }}
        >
          <Box sx={{ minWidth: 70 }}>
            <Typography
              variant="h6"
              fontWeight={700}
              sx={{
                lineHeight: 1.15,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {activeTotal}%
            </Typography>

            <Typography
              variant="caption"
              color={remaining === 0 ? "success.main" : "text.secondary"}
            >
              {remaining === 0 ? "Complete" : `${remaining} left`}
            </Typography>
          </Box>

          <Button
            fullWidth
            variant="contained"
            onClick={submitPrioritization}
            disabled={submitDisabled}
            startIcon={<SendRoundedIcon />}
            sx={{ minHeight: 48 }}
          >
            {submitting ? "Submitting…" : "Submit prioritization"}
          </Button>
        </Stack>

        {activeFeatures.length < 2 ? (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", textAlign: "center", mt: 0.75 }}
          >
            Add at least 2 active features to submit.
          </Typography>
        ) : activeTotal !== 100 ? (
          <Typography
            variant="caption"
            color="warning.main"
            sx={{ display: "block", textAlign: "center", mt: 0.75 }}
          >
            Allocation must equal exactly 100%.
          </Typography>
        ) : null}
      </Box>

      <Dialog
        open={Boolean(editingFeature)}
        onClose={() => !pendingAction && setEditingFeature(null)}
        fullWidth
        maxWidth="sm"
        aria-labelledby="edit-feature-title"
      >
        <Box component="form" onSubmit={saveFeature}>
          <DialogTitle id="edit-feature-title">
            Edit feature
          </DialogTitle>

          <DialogContent>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                autoFocus
                fullWidth
                required
                label="Feature name"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                slotProps={{ htmlInput: { maxLength: 255 } }}
              />

              <TextField
                fullWidth
                label="Feature description (optional)"
                value={editDescription}
                onChange={(event) =>
                  setEditDescription(event.target.value)
                }
                multiline
                minRows={3}
                slotProps={{ htmlInput: { maxLength: 5000 } }}
              />
            </Stack>
          </DialogContent>

          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button
              type="button"
              onClick={() => setEditingFeature(null)}
              disabled={Boolean(pendingAction)}
            >
              Cancel
            </Button>

            <Button
              type="submit"
              variant="contained"
              disabled={
                !editName.trim() || Boolean(pendingAction)
              }
            >
              {pendingAction.startsWith("edit-")
                ? "Saving…"
                : "Save changes"}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => !pendingAction && setDeleteTarget(null)}
        fullWidth
        maxWidth="xs"
        aria-labelledby="delete-feature-title"
      >
        <DialogTitle id="delete-feature-title">
          Delete feature?
        </DialogTitle>

        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <DialogContentText>
            Delete “{deleteTarget?.name}”? Features with saved responses
            cannot be deleted; mark them Implemented instead so historical
            results are preserved.
          </DialogContentText>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setDeleteTarget(null)}
            disabled={Boolean(pendingAction)}
          >
            Cancel
          </Button>

          <Button
            onClick={removeFeature}
            color="error"
            variant="contained"
            disabled={Boolean(pendingAction)}
          >
            {pendingAction.startsWith("delete-")
              ? "Deleting…"
              : "Delete feature"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        fullWidth
        maxWidth="xs"
        aria-labelledby="reset-allocation-title"
      >
        <DialogTitle id="reset-allocation-title">
          Distribute points evenly?
        </DialogTitle>

        <DialogContent>
          <DialogContentText>
            This replaces the current draft allocations and clears all pins.
          </DialogContentText>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmReset(false)}>
            Keep current allocations
          </Button>

          <Button vvariant="contained"
            onClick={applyEvenSplit}
          >
            Distribute evenly
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}


