import { useEffect, useMemo, useRef, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import BarChartRoundedIcon from "@mui/icons-material/BarChartRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";

import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../AuthContext.jsx";
import FeatureCard from "../components/features/FeatureCard.jsx";
const IMPLEMENTATION_STATUSES = [
  { value: "planned", label: "Planned", color: "#8B5CF6" },
  { value: "in_progress", label: "In Progress", color: "#FACC15" },
  { value: "implemented", label: "Implemented", color: "#22C55E" },
];
import { useAllocation,createEqualAllocation } from "../hooks/useAllocation.js";
import FeatureForm from "../components/features/FeatureForm.jsx";
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
  const [featureSearch, setFeatureSearch] = useState("");
  const [stakeholder] = useState("");

  const [editingFeature, setEditingFeature] = useState(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const [error, setError] = useState("");
  const [loadedFor, setLoadedFor] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  const [pendingAction, setPendingAction] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [setConfirmReset] = useState(false);

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

  const normalizedFeatureSearch = featureSearch.trim().toLowerCase();

  const filteredActiveFeatures = useMemo(
    () =>
      activeFeatures.filter((feature) => {
        if (!normalizedFeatureSearch) return true;

        return (
          (feature.name || "").toLowerCase().includes(normalizedFeatureSearch) ||
          (feature.description || "").toLowerCase().includes(normalizedFeatureSearch)
        );
      }),
    [activeFeatures, normalizedFeatureSearch]
  );

  const filteredImplementedFeatures = useMemo(
    () =>
      implementedFeatures.filter((feature) => {
        if (!normalizedFeatureSearch) return true;

        return (
          (feature.name || "").toLowerCase().includes(normalizedFeatureSearch) ||
          (feature.description || "").toLowerCase().includes(normalizedFeatureSearch)
        );
      }),
    [implementedFeatures, normalizedFeatureSearch]
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

  // Keep allocation state valid when the feature list changes.
  // Reinitialize equal shares for the remaining active features.
  const reconcile = (nextFeatures, _current) => ({
    values: createEqualAllocation(
      nextFeatures.filter((feature) => feature.status !== "implemented")
    ),
    pinnedIds: new Set(),
  });

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

const {
  updatePercentage
} = useAllocation({
  activeFeatures,
  allocation,
  setAllocation,
  canSubmitPrioritization,
  submitting,
  setConfirmReset,
});
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
  return (
    <FeatureCard
      key={feature.id}
      feature={feature}
      implemented={implemented}
      allocation={allocation}
      formatStartDate={formatStartDate}
      IMPLEMENTATION_STATUSES={IMPLEMENTATION_STATUSES}
      canManageFeatures={canManageFeatures}
      pendingAction={pendingAction}
      submitting={submitting}
      statusAnchor={statusAnchor}
      setStatusAnchor={setStatusAnchor}
      selectedStatusFeature={selectedStatusFeature}
      setSelectedStatusFeature={setSelectedStatusFeature}
      updateStatus={updateStatus}
      openEditor={openEditor}
      setDeleteTarget={setDeleteTarget}
      updatePercentage={updatePercentage}
    />
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
          ? "100% Allocated"
          : remaining > 0
            ? `${remaining} percent remaining.`
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
          
          </Typography>

          <TextField
            fullWidth
            value={featureSearch}
            onChange={(event) => setFeatureSearch(event.target.value)}
            placeholder="Search features by name or description..."
            aria-label="Search features"
            sx={{ mb: 2.5 }}
            InputProps={{
              startAdornment: (
                <SearchRoundedIcon sx={{ mr: 1, color: "text.secondary" }} />
              ),
              endAdornment: featureSearch ? (
                <IconButton
                  aria-label="Clear feature search"
                  onClick={() => setFeatureSearch("")}
                  edge="end"
                  size="small"
                >
                  <CloseRoundedIcon />
                </IconButton>
              ) : null,
            }}
          />

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

          {filteredActiveFeatures.length === 0 ? (
            <Box
              sx={{
                py: 4,
                borderTop: "1px solid",
                borderColor: "divider",
              }}
            >
              <Typography fontWeight={650}>
                {normalizedFeatureSearch
                  ? "No active features match your search"
                  : "No active features yet"}
              </Typography>

              <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                {normalizedFeatureSearch
                  ? "Try a different feature name or description."
                  : "Add at least two active features to collect prioritization responses."}
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
              {filteredActiveFeatures.map((feature) => (
                <Box component="li" key={feature.id}>
                  {renderFeature(feature)}
                </Box>
              ))}
            </Stack>
          )}

          {filteredImplementedFeatures.length > 0 && (
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
                  Implemented ({filteredImplementedFeatures.length})
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
                  {filteredImplementedFeatures.map((feature) => (
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
  open={Boolean(deleteTarget)}
  onClose={() => {
    if (!pendingAction) setDeleteTarget(null);
  }}
  aria-labelledby="delete-feature-dialog-title"
>
  <DialogTitle id="delete-feature-dialog-title">Delete feature?</DialogTitle>
  <DialogContent>
    <DialogContentText>
      Are you sure you want to delete “{deleteTarget?.name}”? This action cannot be undone.
    </DialogContentText>
  </DialogContent>
  <DialogActions>
    <Button
      onClick={() => setDeleteTarget(null)}
      disabled={Boolean(pendingAction)}
    >
      Cancel
    </Button>
    <Button
      color="error"
      variant="contained"
      onClick={removeFeature}
      disabled={Boolean(pendingAction) || !canManageFeatures}
    >
      {pendingAction === `delete-${deleteTarget?.id}` ? "Deleting…" : "Delete"}
    </Button>
  </DialogActions>
</Dialog>

<FeatureForm
  editingFeature={editingFeature}
  setEditingFeature={setEditingFeature}
  editName={editName}
  setEditName={setEditName}
  editDescription={editDescription}
  setEditDescription={setEditDescription}
  error={error}
  pendingAction={pendingAction}
  saveFeature={saveFeature}
/>
    </Box>
  );
}