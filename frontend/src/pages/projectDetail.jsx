import { useEffect, useMemo, useRef, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  FormGroup,
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
  const [featureGroups, setFeatureGroups] = useState([]);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [selectedFeatureIds, setSelectedFeatureIds] = useState([]);
  const [addToGroupId, setAddToGroupId] = useState(null);
  const [addToGroupFeatureIds, setAddToGroupFeatureIds] = useState([]);

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

  const prioritizationItems = useMemo(() => {
    const active = features.filter((feature) => feature.status !== "implemented");
    const groupedIds = new Set(featureGroups.flatMap((group) => group.features.map((feature) => feature.id)));
    const ungrouped = active.filter((feature) => !groupedIds.has(feature.id) && !feature.group_id);
    const groups = featureGroups
      .map((group) => ({
        id: `group:${group.id}`,
        groupId: group.id,
        name: group.name,
        description: group.description || `${group.features.length} grouped features`,
        status: group.status || "planned",
        implementation_started_at: group.implementation_started_at,
        isGroup: true,
        memberFeatures: group.features.filter((feature) => feature.status !== "implemented"),
      }))
      .filter((group) => group.status !== "implemented" && group.memberFeatures.length > 0);
    return [...ungrouped, ...groups];
  }, [features, featureGroups]);

  const normalizedFeatureSearch = featureSearch.trim().toLowerCase();

  const filteredActiveFeatures = useMemo(
    () =>
      activeFeatures.filter((feature) => {
        if (feature.group_id || featureGroups.some((group) => group.features.some((member) => member.id === feature.id))) return false;
        if (!normalizedFeatureSearch) return true;

        return (
          (feature.name || "").toLowerCase().includes(normalizedFeatureSearch) ||
          (feature.description || "").toLowerCase().includes(normalizedFeatureSearch)
        );
      }),
    [activeFeatures, normalizedFeatureSearch, featureGroups]
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

  const filteredImplementedGroups = useMemo(
    () => featureGroups.filter((group) => {
      if (group.status !== "implemented") return false;
      if (!normalizedFeatureSearch) return true;
      return (
        (group.name || "").toLowerCase().includes(normalizedFeatureSearch) ||
        group.features.some((feature) =>
          `${feature.name} ${feature.description || ""}`.toLowerCase().includes(normalizedFeatureSearch)
        )
      );
    }),
    [featureGroups, normalizedFeatureSearch]
  );

  const activeTotal = useMemo(
    () =>
      prioritizationItems.reduce(
        (sum, item) => sum + Number(allocation.values[item.id] || 0),
        0
      ),
    [prioritizationItems, allocation.values]
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
        const [projectData, featureData, groupData] = await Promise.all([
          api.getProject(id, controller.signal),
          api.getFeatures(id, controller.signal),
          api.getFeatureGroups(id, controller.signal),
        ]);

        if (!current) return;

        setProject(projectData);
        setFeatures(featureData);
        setFeatureGroups(groupData);

        const groupedIds = new Set(groupData.flatMap((group) => group.features.map((feature) => feature.id)));
        const active = featureData.filter((feature) => feature.status !== "implemented");
        const items = [
          ...active.filter((feature) => !feature.group_id && !groupedIds.has(feature.id)),
          ...groupData.filter((group) => group.status !== "implemented" && group.features.some((feature) => feature.status !== "implemented")).map((group) => ({ id: `group:${group.id}` })),
        ];
        setAllocation({ values: createEqualAllocation(items), pinnedIds: new Set() });

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
  const reconcile = (nextFeatures, _current, nextGroups = featureGroups) => {
    const groupedIds = new Set(nextGroups.flatMap((group) => group.features.map((feature) => feature.id)));
    const active = nextFeatures.filter((feature) => feature.status !== "implemented");
    const items = [
      ...active.filter((feature) => !feature.group_id && !groupedIds.has(feature.id)),
      ...nextGroups.filter((group) => group.status !== "implemented" && group.features.some((feature) => feature.status !== "implemented")).map((group) => ({ id: `group:${group.id}` })),
    ];
    return { values: createEqualAllocation(items), pinnedIds: new Set() };
  };

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
      () => feature.isGroup
        ? api.updateFeatureGroup(id, feature.groupId, { status })
        : api.updateFeature(id, feature.id, { status }),
      (updated) => {
        if (feature.isGroup) {
          const nextGroups = featureGroups.map((group) =>
            group.id === feature.groupId
              ? {
                  ...group,
                  status: updated.status || status,
                  implementation_started_at:
                    updated.implementation_started_at ?? group.implementation_started_at,
                }
              : group
          );
          setFeatureGroups(nextGroups);
          setAllocation((current) => reconcile(features, current, nextGroups));
          return;
        }

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

  const createFeatureGroup = async (event) => {
    event?.preventDefault();
    if (!canManageFeatures || !groupName.trim() || selectedFeatureIds.length < 2) return;
    await runMutation("create-feature-group", () => api.createFeatureGroup(id, {
      name: groupName.trim(), feature_ids: selectedFeatureIds,
    }), (createdGroup) => {
      const nextGroups = [...featureGroups, createdGroup];
      setFeatureGroups(nextGroups);
      setFeatures((current) => current.map((feature) => selectedFeatureIds.includes(feature.id) ? { ...feature, group_id: createdGroup.id } : feature));
      setAllocation((current) => {
        const groupItemId = `group:${createdGroup.id}`;
        const groupedPercentage = selectedFeatureIds.reduce(
          (sum, featureId) => sum + Number(current.values[featureId] || 0),
          0
        );
        const values = { ...current.values };
        selectedFeatureIds.forEach((featureId) => delete values[featureId]);
        values[groupItemId] = groupedPercentage;
        return {
          values,
          pinnedIds: new Set([...current.pinnedIds].filter((value) => !selectedFeatureIds.includes(value)).concat(groupItemId)),
        };
      });
      setGroupDialogOpen(false);
      setGroupName("");
      setSelectedFeatureIds([]);
    });
  };

  const addFeaturesToExistingGroup = async (event) => {
    event?.preventDefault();

    const groupId = addToGroupId;
    const selectedIds = [...addToGroupFeatureIds];

    if (!canManageFeatures || !groupId || selectedIds.length === 0) return;

    const selectedFeatures = features.filter((feature) =>
      selectedIds.includes(feature.id)
    );

    await runMutation(
      `add-features-to-group-${groupId}`,
      () =>
        api.addFeatureToGroup(id, groupId, {
          feature_ids: selectedIds,
        }),
      () => {
        setFeatureGroups((current) =>
          current.map((group) =>
            group.id === groupId
              ? {
                  ...group,
                  features: [
                    ...group.features,
                    ...selectedFeatures.map((feature) => ({
                      ...feature,
                      group_id: groupId,
                    })),
                  ],
                }
              : group
          )
        );

        setFeatures((current) =>
          current.map((feature) =>
            selectedIds.includes(feature.id)
              ? { ...feature, group_id: groupId }
              : feature
          )
        );

        // Keep the overall allocation at 100% by moving each selected
        // feature's current allocation into the existing group allocation.
        setAllocation((current) => {
          const groupItemId = `group:${groupId}`;
          const values = { ...current.values };
          const addedPercentage = selectedIds.reduce(
            (sum, featureId) => sum + Number(values[featureId] || 0),
            0
          );

          selectedIds.forEach((featureId) => {
            delete values[featureId];
          });

          values[groupItemId] =
            Number(values[groupItemId] || 0) + addedPercentage;

          return {
            values,
            pinnedIds: new Set([
              ...[...current.pinnedIds].filter(
                (value) => !selectedIds.includes(value)
              ),
              groupItemId,
            ]),
          };
        });

        setAddToGroupId(null);
        setAddToGroupFeatureIds([]);
      }
    );
  };

  const ungroupFeature = async (group, feature) => {
    if (!canManageFeatures) return;
    await runMutation(`ungroup-${feature.id}`, () => api.ungroupFeature(id, group.id, feature.id), () => {
      const nextGroups = featureGroups.map((item) => item.id === group.id ? { ...item, features: item.features.filter((member) => member.id !== feature.id) } : item).filter((item) => item.features.length > 0);
      setFeatureGroups(nextGroups);
      setFeatures((current) => current.map((item) => item.id === feature.id ? { ...item, group_id: null } : item));
      setAllocation((current) => {
        const groupItemId = `group:${group.id}`;
        const groupPercentage = Number(current.values[groupItemId] || 0);
        const activeMembers = group.features.filter((member) => member.status !== "implemented");
        const share = activeMembers.length ? groupPercentage / activeMembers.length : 0;
        const values = { ...current.values };
        delete values[groupItemId];
        values[feature.id] = share;
        const remainingActive = activeMembers.filter((member) => member.id !== feature.id);
        if (remainingActive.length > 0) {
          values[groupItemId] = share * remainingActive.length;
        }
        // Keep the draft total unchanged when a feature is ungrouped.
        return { values, pinnedIds: new Set(current.pinnedIds) };
      });
    });
  };

const {
  updatePercentage
} = useAllocation({
  activeFeatures: prioritizationItems,
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

    if (prioritizationItems.length < 2) {
      setError("Add at least 2 active prioritization items to submit.");
      return;
    }

    if (activeTotal !== 100) {
      setError("Allocation must equal exactly 100%.");
      return;
    }

    if (submitting || submitRef.current || pendingRef.current) return;

    const allocations = prioritizationItems
      .filter((item) => Number(allocation.values[item.id] || 0) > 0)
      .map((item) => item.isGroup
        ? { groupId: item.groupId, percentage: Number(allocation.values[item.id]) }
        : { featureId: item.id, percentage: Number(allocation.values[item.id]) }
      );

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
    prioritizationItems.length < 2 ||
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
            ? `${remaining}% remaining.`
            : `${Math.abs(remaining)} points over.`}
      </Typography>

      {prioritizationItems.length < 2 ? (
        <Typography variant="body2" color="text.secondary">
          Add at least 2 active prioritization items to submit.
        </Typography>
      ) : activeTotal !== 100 ? (
        <Typography variant="body2" color="warning.main">
          Allocation must equal exactly 100%.
        </Typography>
      ) : (
        <Typography variant="body2" color="text.secondary">
      
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
    <Box sx={{ width: "100%", minWidth: 0, pb: { xs: 8, md: 4 }, pt: { xs: 1.5, md: 2 } }}>
      <Box sx={{ mb: 1.5 }}>
        <Button
          startIcon={<ArrowBackRoundedIcon />}
          onClick={() => navigate("/")}
          sx={{ mb: 0.75, px: 0, minHeight: 40 }}
        >
          All projects
        </Button>

        <Box sx={{ position: "relative", textAlign: "center", px: { xs: 0, sm: 2 }, pt: { xs: 0.25, md: 0.5 }, pb: 0.25 }}>
          <Typography component="h1" variant="h3" sx={{ fontWeight: 750, fontSize: { xs: "2rem", sm: "2.4rem", md: "2.65rem" }, lineHeight: 1.12, overflowWrap: "anywhere" }}>
            {project.name}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5, mx: "auto", maxWidth: 760, lineHeight: 1.45 }}>
            {project.description?.trim() || "No description provided."}
          </Typography>
        </Box>

        <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 0.25 }}>
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
        </Box>
      </Box>

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
          gap: { xs: 2, md: 3.5 },
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
              mb: 0.75,
            }}
          >
      

            <Chip
              size="small"
              label={`${prioritizationItems.length} active items`}
              variant="outlined"
            />
            {canManageFeatures && activeFeatures.filter((feature) => !feature.group_id && feature.status !== "implemented").length >= 2 && (
              <Button size="small" variant="outlined" onClick={() => setGroupDialogOpen(true)}>
                Group features
              </Button>
            )}
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
            sx={{ mb: 1.75 }}
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
              sx={{ mb: 2 }}
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

          {featureGroups.filter((group) => group.status !== "implemented" && group.features.some((feature) => feature.status !== "implemented") && (!normalizedFeatureSearch || group.name.toLowerCase().includes(normalizedFeatureSearch) || group.features.some((feature) => `${feature.name} ${feature.description || ""}`.toLowerCase().includes(normalizedFeatureSearch)))).map((group) => {
            const groupItem = prioritizationItems.find((item) => item.groupId === group.id);
            if (!groupItem) return null;
            const members = group.features.filter((feature) => feature.status !== "implemented" && (!normalizedFeatureSearch || group.name.toLowerCase().includes(normalizedFeatureSearch) || `${feature.name} ${feature.description || ""}`.toLowerCase().includes(normalizedFeatureSearch)));
            return (
              <Box key={group.id} sx={{ borderTop: "1px solid", borderColor: "divider", pb: 0.25 }}>
                <Stack direction="row" justifyContent="flex-end" sx={{ pt: 1, px: 1 }}>
                  {canManageFeatures && (
                    <Button
                      size="small"
                      onClick={() => {
                        setAddToGroupId(group.id);
                        setAddToGroupFeatureIds([]);
                      }}
                      disabled={Boolean(pendingAction) || !filteredActiveFeatures.length}
                    >
                      Add Features
                    </Button>
                  )}
                </Stack>
                {renderFeature(groupItem)}
                <Accordion disableGutters elevation={0} sx={{ bgcolor: "transparent", "&::before": { display: "none" } }}>
                  <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />} sx={{ px: 1 }}>
                    <Typography variant="body2" fontWeight={650}>View</Typography>
                  </AccordionSummary>
                  <AccordionDetails sx={{ pt: 0 }}>
                    <Stack spacing={0.5}>
                      {members.map((member) => (
                        <Stack key={member.id} direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between", py: 0.25 }}>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography>{member.name}</Typography>
                            {member.description && <Typography variant="body2" color="text.secondary">{member.description}</Typography>}
                          </Box>
                          {canManageFeatures && <Button size="small" onClick={() => ungroupFeature(group, member)} disabled={Boolean(pendingAction)}>Ungroup</Button>}
                        </Stack>
                      ))}
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              </Box>
            );
          })}

          {filteredActiveFeatures.length === 0 && !featureGroups.some((group) => group.status !== "implemented" && group.features.some((feature) => feature.status !== "implemented") && (!normalizedFeatureSearch || group.name.toLowerCase().includes(normalizedFeatureSearch) || group.features.some((feature) => `${feature.name} ${feature.description || ""}`.toLowerCase().includes(normalizedFeatureSearch)))) ? (
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

          {(filteredImplementedFeatures.length > 0 || filteredImplementedGroups.length > 0) && (
            <Accordion
              disableGutters
              elevation={0}
              sx={{
                mt: 1.5,
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
                  Implemented ({filteredImplementedFeatures.length + filteredImplementedGroups.length})
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
                  {filteredImplementedGroups.map((group) => {
                    const groupItem = {
                      id: `group:${group.id}`,
                      groupId: group.id,
                      name: group.name,
                      description: group.description || `${group.features.length} grouped features`,
                      status: group.status || "implemented",
                      implementation_started_at: group.implementation_started_at,
                      isGroup: true,
                    };
                    return (
                      <Box component="li" key={`group-${group.id}`}>
                        {renderFeature(groupItem, true)}
                      </Box>
                    );
                  })}
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
            maxWidth: "none",
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

        {prioritizationItems.length < 2 ? (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", textAlign: "center", mt: 0.75 }}
          >
            Add at least 2 active prioritization items to submit.
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

<Dialog open={groupDialogOpen} onClose={() => !pendingAction && setGroupDialogOpen(false)} fullWidth maxWidth="sm">
  <Box component="form" onSubmit={createFeatureGroup}>
    <DialogTitle>Group features</DialogTitle>
    <DialogContent>
      <DialogContentText sx={{ mb: 2 }}>Choose at least two ungrouped, active features. Existing historical allocations are preserved and attributed to the group in results.</DialogContentText>
      <TextField fullWidth required label="Group name" value={groupName} onChange={(event) => setGroupName(event.target.value)} sx={{ mb: 2 }} inputProps={{ maxLength: 255 }} />
      <FormGroup>
        {activeFeatures.filter((feature) => !feature.group_id && !featureGroups.some((group) => group.features.some((member) => member.id === feature.id))).map((feature) => (
          <FormControlLabel key={feature.id} control={<Checkbox checked={selectedFeatureIds.includes(feature.id)} onChange={(event) => setSelectedFeatureIds((current) => event.target.checked ? [...current, feature.id] : current.filter((value) => value !== feature.id))} />} label={feature.name} />
        ))}
      </FormGroup>
    </DialogContent>
    <DialogActions>
      <Button onClick={() => setGroupDialogOpen(false)} disabled={Boolean(pendingAction)}>Cancel</Button>
      <Button type="submit" variant="contained" disabled={!groupName.trim() || selectedFeatureIds.length < 2 || Boolean(pendingAction)}>{pendingAction === "create-feature-group" ? "Creating…" : "Create group"}</Button>
    </DialogActions>
  </Box>
</Dialog>

<Dialog
  open={Boolean(addToGroupId)}
  onClose={() => {
    if (!pendingAction) {
      setAddToGroupId(null);
      setAddToGroupFeatureIds([]);
    }
  }}
  fullWidth
  maxWidth="sm"
>
  <Box component="form" onSubmit={addFeaturesToExistingGroup}>
    <DialogTitle>
      Add features to {featureGroups.find((group) => group.id === addToGroupId)?.name || "group"}
    </DialogTitle>
    <DialogContent>
      <DialogContentText sx={{ mb: 2 }}>
        Choose ungrouped, active features to add to this existing group. The group and its historical allocations will be retained.
      </DialogContentText>
      <FormGroup>
        {activeFeatures
          .filter(
            (feature) =>
              !feature.group_id &&
              !featureGroups.some((group) =>
                group.features.some((member) => member.id === feature.id)
              )
          )
          .map((feature) => (
            <FormControlLabel
              key={feature.id}
              control={
                <Checkbox
                  checked={addToGroupFeatureIds.includes(feature.id)}
                  onChange={(event) =>
                    setAddToGroupFeatureIds((current) =>
                      event.target.checked
                        ? [...current, feature.id]
                        : current.filter((value) => value !== feature.id)
                    )
                  }
                />
              }
              label={feature.name}
            />
          ))}
      </FormGroup>
    </DialogContent>
    <DialogActions>
      <Button
        onClick={() => {
          setAddToGroupId(null);
          setAddToGroupFeatureIds([]);
        }}
        disabled={Boolean(pendingAction)}
      >
        Cancel
      </Button>
      <Button
        type="submit"
        variant="contained"
        disabled={!addToGroupFeatureIds.length || Boolean(pendingAction)}
      >
        {pendingAction === `add-features-to-group-${addToGroupId}` ? "Adding…" : "Add to group"}
      </Button>
    </DialogActions>
  </Box>
</Dialog>

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