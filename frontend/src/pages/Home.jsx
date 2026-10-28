import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  InputAdornment,
  Stack,
  Tooltip,
  TextField,
  Typography,
} from "@mui/material";

import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import EmailOutlinedIcon from "@mui/icons-material/EmailOutlined";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import { useNavigate } from "react-router-dom";

import { api } from "../api";

export default function Home() {
  const [projects, setProjects] = useState([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [currentUser, setCurrentUser] = useState(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [pendingDelete, setPendingDelete] = useState(null);
  const [projectResults, setProjectResults] = useState({});
  const [projectPermissions, setProjectPermissions] = useState({});
  const [supportEmailDialogProject, setSupportEmailDialogProject] = useState(null);
  const [supportEmailDraft, setSupportEmailDraft] = useState("");
  const [savingSupportEmail, setSavingSupportEmail] = useState(false);
  const [supportEmailDrafts, setSupportEmailDrafts] = useState({});
  const [copiedSupportProject, setCopiedSupportProject] = useState(null);
  const navigate = useNavigate();

  // Only main_admin can create or delete projects.
  const userRoles = currentUser?.roles || [];
  const isMainAdmin = userRoles.includes("main_admin");
  // Main admins and app/project admins may manage a project's support contact.
  const canManageSupportEmail = userRoles.some((role) =>
    ["main_admin", "app_admin", "project_admin"].includes(role)
  );

  const normalizedProjectSearch = projectSearch.trim().toLowerCase();
  const filteredProjects = projects.filter((project) => {
    if (!normalizedProjectSearch) return true;

    return (
      (project.name || "").toLowerCase().includes(normalizedProjectSearch) ||
      (project.description || "").toLowerCase().includes(normalizedProjectSearch)
    );
  });

  // Load public projects and current user independently.
  useEffect(() => {
    let cancelled = false;

    async function loadProjects() {
      try {
        const data = await api.getProjects();

        if (!cancelled) {
          const loadedProjects = Array.isArray(data) ? data : [];
          setProjects(loadedProjects.map((project) => ({
            ...project,
            support_email: project.support_email ?? project.supportEmail ?? null,
          })));
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err.message || "Unable to load projects. Please try again."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    async function loadCurrentUser() {
      try {
        const user = await api.getCurrentUser();

        if (!cancelled) {
          setCurrentUser(user);
        }
      } catch {
        if (!cancelled) {
          setCurrentUser(null);
        }
      }
    }

    loadProjects();
    loadCurrentUser();

    return () => {
      cancelled = true;
    };
  }, []);

  // Load project ranking summaries and per-project permissions.
  useEffect(() => {
    if (!projects.length) return;
    let cancelled = false;

    async function loadProjectExtras() {
      const resultEntries = await Promise.all(
        projects.map(async (project) => {
          try {
            const data = await api.getResults(project.id);
            const results = Array.isArray(data?.results) ? data.results : [];
            const highest = results.reduce((best, item) => {
              const share = Number(item.share ?? item.priority ?? 0);
              return !best || share > best.share
                ? { name: item.name || "Feature", share }
                : best;
            }, null);
            return [project.id, highest];
          } catch {
            return [project.id, null];
          }
        })
      );

      const permissionEntries = await Promise.all(
        projects.map(async (project) => {
          try {
            const permissions = await api.getProjectPermissions(project.id);
            return [project.id, permissions];
          } catch {
            return [project.id, null];
          }
        })
      );

      if (!cancelled) {
        setProjectResults(Object.fromEntries(resultEntries));
        setProjectPermissions(Object.fromEntries(permissionEntries));
      }
    }

    loadProjectExtras();
    return () => { cancelled = true; };
  }, [projects]);

  const handleCopySupportEmail = async (email, event, projectId = null) => {
    event?.stopPropagation();
    const value = (email || "").trim();
    if (!value) {
      setError("Enter a support email before copying it.");
      setSuccess("");
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        // Fallback for browsers/environments where Clipboard API is unavailable.
        const temporaryInput = document.createElement("textarea");
        temporaryInput.value = value;
        temporaryInput.setAttribute("readonly", "");
        temporaryInput.style.position = "fixed";
        temporaryInput.style.opacity = "0";
        document.body.appendChild(temporaryInput);
        temporaryInput.select();
        const copied = document.execCommand("copy");
        document.body.removeChild(temporaryInput);
        if (!copied) throw new Error("Copy command failed");
      }

      setCopiedSupportProject(projectId || event?.currentTarget?.dataset?.projectId || value);
      window.setTimeout(() => setCopiedSupportProject(null), 1800);
      setSuccess("Support email copied to clipboard.");
      setError("");
    } catch {
      setError("Could not copy the email. Please check your browser clipboard permissions.");
      setSuccess("");
    }
  };

  const handleSaveSupportEmail = async () => {
    if (!supportEmailDialogProject) return;
    const email = supportEmailDraft.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    setSavingSupportEmail(true);
    setError("");
    setSuccess("");
    try {
     
      await api.updateProjectSupportEmail(supportEmailDialogProject.id, email);
      setProjects((previous) => previous.map((project) =>
        project.id === supportEmailDialogProject.id
          ? { ...project, support_email: email || null, supportEmail: email || null }
          : project
      ));
      setSuccess(email ? "Support email saved." : "Support email removed.");
      setSupportEmailDialogProject(null);
      setSupportEmailDraft("");
    } catch (err) {
      setError(err.message || "Unable to save the support email. Check the backend/API update.");
    } finally {
      setSavingSupportEmail(false);
    }
  };

  // Create a project.
  const handleCreateProject = async (event) => {
    event.preventDefault();

    if (!isMainAdmin) {
      setError("Only a main admin can create projects.");
      return;
    }

    const trimmedName = name.trim();
    const trimmedDescription = description.trim();

    if (!trimmedName) {
      setError("Please enter a project name.");
      return;
    }

    setCreating(true);
    setError("");
    setSuccess("");

    try {
      await api.createProject({
        name: trimmedName,
        description: trimmedDescription,
      });

      setName("");
      setDescription("");

      // Reload the project list after creation.
      const data = await api.getProjects();
      setProjects(
        (Array.isArray(data) ? data : []).map((project) => ({
          ...project,
          support_email: project.support_email ?? project.supportEmail ?? null,
        }))
      );

      setSuccess("Project created successfully.");
    } catch (err) {
      setError(err.message || "Failed to create the project.");
    } finally {
      setCreating(false);
    }
  };

  // Open the delete confirmation dialog.
  const handleDeleteClick = (event, project) => {
    event.preventDefault();
    event.stopPropagation();

    if (!isMainAdmin) {
      setError("Only a main admin can delete projects.");
      return;
    }

    setPendingDelete(project);
  };

  // Delete the selected project after confirmation.
  const handleConfirmDelete = async () => {
    if (!pendingDelete || !isMainAdmin) {
      return;
    }

    setDeletingProject(true);
    setError("");
    setSuccess("");

    try {
      await api.deleteProject(pendingDelete.id);

      setProjects((previous) =>
        previous.filter(
          (project) => project.id !== pendingDelete.id
        )
      );

      setSuccess(
        `Project "${pendingDelete.name}" deleted successfully.`
      );

      setPendingDelete(null);
    } catch (err) {
      setError(err.message || "Failed to delete the project.");
    } finally {
      setDeletingProject(false);
    }
  };

  return (
    <Container
      maxWidth={false}
      sx={{
        width: "100%",
        maxWidth: "none",
        mx: 0,
        px: { xs: 1.5, sm: 2.5, md: 3.5 },
        py: { xs: 2, md: 2.5 },
      }}
    >
      {/* Page heading */}
      <Box
        sx={{
          mb: { xs: 2.5, md: 3 },
          pb: { xs: 2, md: 2.5 },
          borderBottom: "0px solid",
          borderColor: "divider",
        }}
      >

        {currentUser && (
          <Box
            sx={{
              mt: 2,
              display: "inline-flex",
              alignItems: "center",
              gap: 1,
              px: 1.5,
              py: 0.75,
              borderRadius: 999,
              border: "1px solid",
              borderColor: "divider",
              bgcolor: "action.hover",
            }}
          >
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                bgcolor: "success.main",
                flexShrink: 0,
              }}
            />
            <Typography variant="body2" color="text.secondary">
              Role: {currentUser.roles?.length
                ? currentUser.roles.join(", ")
                : "Authenticated user"}
            </Typography>
          </Box>
        )}
      </Box>

      {/* Error and success messages */}
      {error && (
        <Alert
          severity="error"
          onClose={() => setError("")}
          sx={{ mb: 2.5, borderRadius: 2 }}
        >
          {error}
        </Alert>
      )}

      {success && (
        <Alert
          severity="success"
          onClose={() => setSuccess("")}
          sx={{ mb: 2.5, borderRadius: 2 }}
        >
          {success}
        </Alert>
      )}

      {/* Create Project: main_admin only */}
      {isMainAdmin && (
        <Card
          elevation={0}
          sx={{
            mb: { xs: 2.5, md: 3 },
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 3,
            backgroundImage: "none",
          }}
        >
          <CardContent
            sx={{
              p: { xs: 2, sm: 2.5 },
              "&:last-child": { pb: { xs: 2, sm: 2.5 } },
            }}
          >
            <Stack
              direction="row"
              alignItems="center"
              spacing={1.5}
              sx={{ mb: 3 }}
            >
              <Box
                sx={{
                  width: 42,
                  height: 42,
                  borderRadius: 2,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  bgcolor: "action.hover",
                  color: "primary.main",
                }}
              >
                <AddIcon />
              </Box>

              <Box>
                <Typography variant="h6" fontWeight={700}>
                  Create a project
                </Typography>

                <Typography variant="body2" color="text.secondary">
                  Add a project for your team to prioritize.
                </Typography>
              </Box>
            </Stack>

            <Box component="form" onSubmit={handleCreateProject}>
              <Stack spacing={2}>
                <TextField
                  label="Project name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  fullWidth
                  inputProps={{ maxLength: 150 }}
                  placeholder="Enter project name"
                />

                <TextField
                  label="Description"
                  value={description}
                  onChange={(event) =>
                    setDescription(event.target.value)
                  }
                  fullWidth
                  multiline
                  minRows={2}
                  placeholder="Describe the project"
                />

                <Box>
                  <Button
                    type="submit"
                    variant="contained"
                    startIcon={<AddIcon />}
                    disabled={creating || !name.trim()}
                    sx={{
                      minHeight: 44,
                      px: 2.5,
                      borderRadius: 2,
                      textTransform: "none",
                      fontWeight: 650,
                    }}
                  >
                    {creating ? "Creating..." : "Create project"}
                  </Button>
                </Box>
              </Stack>
            </Box>
          </CardContent>
        </Card>
      )}


      {/* Search projects */}
      {!loading && projects.length > 0 && (
        <TextField
          fullWidth
          value={projectSearch}
          onChange={(event) => setProjectSearch(event.target.value)}
          placeholder="Search projects by name or description..."
          aria-label="Search projects"
          sx={{ mb: 3, maxWidth: 680 }}
          InputProps={{
            startAdornment: (
              <SearchRoundedIcon sx={{ mr: 1, color: "text.secondary" }} />
            ),
            endAdornment: projectSearch ? (
              <IconButton
                aria-label="Clear project search"
                onClick={() => setProjectSearch("")}
                edge="end"
                size="small"
              >
                <CloseRoundedIcon />
              </IconButton>
            ) : null,
          }}
        />
      )}

      {/* Loading state */}
      {loading ? (
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            py: 10,
          }}
        >
          <CircularProgress />
        </Box>
      ) : projects.length === 0 ? (
        /* Empty state */
        <Card
          elevation={0}
          sx={{
            border: "1px dashed",
            borderColor: "divider",
            borderRadius: 3,
            backgroundImage: "none",
          }}
        >
          <CardContent sx={{ py: 8, textAlign: "center" }}>
            <Box
              sx={{
                width: 64,
                height: 64,
                borderRadius: 3,
                bgcolor: "action.hover",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                mx: "auto",
                mb: 2,
              }}
            >
              <FolderOutlinedIcon
                sx={{ fontSize: 32, color: "text.secondary" }}
              />
            </Box>

            <Typography variant="h6" fontWeight={700}>
              No projects found
            </Typography>

            <Typography
              color="text.secondary"
              sx={{ mt: 1, maxWidth: 420, mx: "auto" }}
            >
              {isMainAdmin
                ? "Create your first project using the form above."
                : "There are currently no projects to display."}
            </Typography>
          </CardContent>
        </Card>
      ) : filteredProjects.length === 0 ? (
        <Card
          elevation={0}
          sx={{
            border: "1px dashed",
            borderColor: "divider",
            borderRadius: 3,
            backgroundImage: "none",
          }}
        >
          <CardContent sx={{ py: 6, textAlign: "center" }}>
            <Typography variant="h6" fontWeight={700}>
              No projects match your search
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              Try a different project name or description.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        /* Full-width project rows */
        <Stack spacing={1.5}>
          {filteredProjects.map((project, index) => {
            const supportEmail = project.support_email || project.supportEmail || "";
            const highest = projectResults[project.id];
            const copied = copiedSupportProject === project.id || copiedSupportProject === supportEmail;

            return (
              <Card
                key={project.id}
                elevation={0}
                onClick={() => navigate(`/project/${project.id}`)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    navigate(`/project/${project.id}`);
                  }
                }}
                role="link"
                tabIndex={0}
                aria-label={`Open project ${project.name}`}
                sx={{
                  width: "100%",
                  cursor: "pointer",
                  overflow: "hidden",
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 3,
                  background: index % 2 === 0
                    ? "linear-gradient(105deg, rgba(126,211,168,0.075), rgba(255,255,255,0.012) 65%)"
                    : "rgba(255,255,255,0.018)",
                  transition: "border-color 160ms ease, transform 160ms ease, box-shadow 160ms ease",
                  "&:hover": {
                    borderColor: "primary.main",
                    transform: "translateY(-1px)",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
                  },
                  "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
                }}
              >
                <CardContent sx={{ p: { xs: 1.75, sm: 2.25 }, "&:last-child": { pb: { xs: 1.75, sm: 2.25 } } }}>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "minmax(0, 1.35fr) minmax(220px, 0.9fr) minmax(230px, 0.9fr)" },
                      alignItems: "center",
                      gap: { xs: 1.5, md: 2.5 },
                    }}
                  >
                    {/* Project name and description */}
                    <Box sx={{ minWidth: 0 }}>
                      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                        {/* <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: "primary.main", flexShrink: 0 }} /> */}
                        <Typography component="h3" fontWeight={750} sx={{ pl: 2, fontSize: "1.02rem", overflowWrap: "anywhere" }}>
                          {project.name}
                        </Typography>
                      </Stack>
                      <Typography variant="body2" color="text.secondary" sx={{ pl: 2, whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.5 }}>
                        {project.description || "No description provided."}
                      </Typography>
                    </Box>

                    {/* Highest-priority feature is centered in its own column */}
                    <Box
                      sx={{
                        minWidth: 0,
                        justifySelf: { xs: "stretch", md: "center" },
                        textAlign: { xs: "left", md: "center" },
                        px: { xs: 0, md: 1 },
                      }}
                    >
                      {highest ? (
                        <Box sx={{ display: "inline-flex", flexDirection: "column", alignItems: { xs: "flex-start", md: "center" }, gap: 0.7 }}>
                          <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 650, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                            Highest priority
                          </Typography>
                          <Box sx={{ display: "inline-flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                            <Typography variant="body2" sx={{ color: "success.main", fontWeight: 700, overflowWrap: "anywhere" }}>
                              {highest.name}
                            </Typography>
                            <Box sx={{ px: 1, py: 0.35, borderRadius: 1.5, bgcolor: "rgba(126,211,168,0.12)", color: "success.main", fontSize: "0.78rem", fontWeight: 800 }}>
                              {highest.share.toFixed(1)}%
                            </Box>
                          </Box>
                        </Box>
                      ) : (
                        <Typography variant="body2" color="text.secondary">No priority results yet</Typography>
                      )}
                    </Box>

                    {/* Support contact: admins can edit; users can only view and copy. */}
                    <Box
                      onClick={(event) => event.stopPropagation()}
                      sx={{
                        minWidth: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: { xs: "flex-start", md: "flex-end" },
                        gap: 0.75,
                      }}
                    >
                      <Box
                        sx={{
                          width: "100%",
                          maxWidth: { xs: "100%", md: canManageSupportEmail ? 360 : 320 },
                          minHeight: 46,
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          px: 1.25,
                          py: 0.5,
                          border: "1px solid",
                          borderColor: "divider",
                          borderRadius: 2.5,
                          bgcolor: "rgba(0,0,0,0.08)",
                          transition: "border-color 160ms ease, background-color 160ms ease",
                          "&:hover": {
                            borderColor: "primary.main",
                            bgcolor: "action.hover",
                          },
                        }}
                      >
                        <EmailOutlinedIcon
                          sx={{ color: "text.secondary", fontSize: 19, flexShrink: 0 }}
                        />
                        <Typography
                          variant="body2"
                          title={supportEmail || "No support email configured"}
                          sx={{
                            flex: 1,
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            color: supportEmail ? "text.primary" : "text.secondary",
                          }}
                        >
                          {supportEmail || "No support email set"}
                        </Typography>
                        <Tooltip
                          title={
                            copied
                              ? "Copied!"
                              : supportEmail
                                ? "Copy support email"
                                : "No email to copy"
                          }
                          arrow
                        >
                          <span>
                            <IconButton
                              size="small"
                              aria-label={`Copy support email for ${project.name}`}
                              data-project-id={project.id}
                              disabled={!supportEmail.trim()}
                              onClick={(event) =>
                                handleCopySupportEmail(supportEmail, event, project.id)
                              }
                              sx={{
                                width: 34,
                                height: 34,
                                borderRadius: 1.75,
                                color: copied ? "success.main" : "primary.main",
                                flexShrink: 0,
                                "&:hover": { bgcolor: "rgba(126,211,168,0.14)" },
                              }}
                            >
                              <ContentCopyRoundedIcon sx={{ fontSize: 18 }} />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Box>

                      {canManageSupportEmail && (
                        <Tooltip title="Edit support email" arrow>
                          <IconButton
                            aria-label={`Edit support email for ${project.name}`}
                            size="small"
                            onClick={() => {
                              setSupportEmailDialogProject(project);
                              setSupportEmailDraft(supportEmail);
                              setError("");
                              setSuccess("");
                            }}
                            sx={{
                              width: 36,
                              height: 36,
                              flexShrink: 0,
                              color: "primary.main",
                            }}
                          >
                            <EmailOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>

                    {isMainAdmin && (
                      <Box sx={{ gridColumn: { xs: "1", md: "1 / -1" }, display: "flex", justifyContent: "flex-end", mt: { xs: -0.5, md: -1 } }} onClick={(event) => event.stopPropagation()}>
                        <Tooltip title="Delete project" arrow>
                          <IconButton
                            aria-label={`Delete ${project.name}`}
                            color="error"
                            size="small"
                            disabled={deletingProject}
                            onClick={(event) => handleDeleteClick(event, project)}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    )}
                  </Box>
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}

      {/* Support email editor: available only to main/app/project admins. */}
      <Dialog
        open={Boolean(supportEmailDialogProject)}
        onClose={() => {
          if (!savingSupportEmail) {
            setSupportEmailDialogProject(null);
            setSupportEmailDraft("");
          }
        }}
        fullWidth
        maxWidth="xs"
        aria-labelledby="support-email-dialog-title"
      >
        <DialogTitle id="support-email-dialog-title" fontWeight={750}>
          Contact support
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Set the support email users will see for{" "}
            <strong>{supportEmailDialogProject?.name}</strong>. Users can view
            and copy this address, but cannot change it.
          </DialogContentText>
          <TextField
            autoFocus
            fullWidth
            type="email"
            label="Support email"
            placeholder="support@example.com"
            value={supportEmailDraft}
            onChange={(event) => setSupportEmailDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleSaveSupportEmail();
              }
            }}
            inputProps={{ maxLength: 254 }}
            helperText="Leave blank to remove the support email."
          />
        </DialogContent>
        <DialogActions sx={{ p: 2.5, pt: 1 }}>
          <Button
            onClick={() => {
              setSupportEmailDialogProject(null);
              setSupportEmailDraft("");
            }}
            disabled={savingSupportEmail}
            sx={{ textTransform: "none" }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSaveSupportEmail}
            variant="contained"
            disabled={savingSupportEmail || !supportEmailDialogProject}
            sx={{ textTransform: "none", minWidth: 110 }}
          >
            {savingSupportEmail ? "Saving..." : "Save email"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog
        open={Boolean(pendingDelete)}
        onClose={() => {
          if (!deletingProject) {
            setPendingDelete(null);
          }
        }}
        aria-labelledby="delete-project-title"
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle id="delete-project-title" fontWeight={750}>
          Delete project?
        </DialogTitle>

        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete{" "}
            <strong>{pendingDelete?.name}</strong>? This action may also
            remove associated project data and cannot necessarily be undone.
          </DialogContentText>
        </DialogContent>

        <DialogActions sx={{ p: 2.5, pt: 1 }}>
          <Button
            onClick={() => setPendingDelete(null)}
            disabled={deletingProject}
            sx={{ textTransform: "none" }}
          >
            Cancel
          </Button>

          <Button
            onClick={handleConfirmDelete}
            color="error"
            variant="contained"
            disabled={deletingProject}
            sx={{
              minWidth: 100,
              textTransform: "none",
            }}
          >
            {deletingProject ? "Deleting..." : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
