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
  Grid,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import { Link } from "react-router-dom";

import { api } from "../api";

export default function Home() {
  const [projects, setProjects] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [pendingDelete, setPendingDelete] = useState(null);

  // Only main_admin can create or delete projects.
  const isMainAdmin =
    currentUser?.roles?.includes("main_admin") ?? false;

  // Load public projects and current user independently.
  useEffect(() => {
    let cancelled = false;

    async function loadProjects() {
      try {
        const data = await api.getProjects();

        if (!cancelled) {
          setProjects(Array.isArray(data) ? data : []);
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
      setProjects(Array.isArray(data) ? data : []);

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
        maxWidth: 1440,
        mx: "auto",
        px: { xs: 2, sm: 4, md: 6 },
        py: { xs: 3, md: 5 },
      }}
    >
      {/* Page heading */}
      <Box
        sx={{
          mb: { xs: 4, md: 5 },
          pb: { xs: 3, md: 4 },
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Typography
          component="h1"
          variant="h3"
          fontWeight={800}
          sx={{
            fontSize: { xs: "2rem", sm: "2.4rem", md: "2.75rem" },
            letterSpacing: "-0.04em",
            lineHeight: 1.2,
            mb: 1.5,
          }}
        >
          Feature Prioritizer
        </Typography>

        <Typography
          variant="body1"
          color="text.secondary"
          sx={{
            maxWidth: 650,
            lineHeight: 1.8,
          }}
        >
          Explore projects, review features, and prioritize what matters.
        </Typography>

        {currentUser && (
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ mt: 2, flexWrap: "wrap" }}
          >
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                bgcolor: "success.main",
              }}
            />

            <Typography variant="body2" color="text.secondary">
              Role:{" "}
              {currentUser.roles?.length
                ? currentUser.roles.join(", ")
                : "Authenticated user"}
            </Typography>
          </Stack>
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
            mb: { xs: 4, md: 5 },
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 3,
            backgroundImage: "none",
          }}
        >
          <CardContent
            sx={{
              p: { xs: 2.5, sm: 3.5 },
              "&:last-child": { pb: { xs: 2.5, sm: 3.5 } },
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

      {/* Projects heading */}
      <Box sx={{ mb: 3 }}>
        <Typography
          component="h2"
          variant="h5"
          fontWeight={750}
          sx={{ letterSpacing: "-0.02em" }}
        >
          Projects
        </Typography>

        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 0.75, lineHeight: 1.7 }}
        >
          Select a project to view its features and prioritization results.
        </Typography>
      </Box>

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
      ) : (
        /* Project cards */
        <Grid container spacing={{ xs: 2, md: 3 }}>
          {projects.map((project) => (
            <Grid
              item
              xs={12}
              sm={6}
              md={4}
              key={project.id}
              sx={{ display: "flex" }}
            >
              <Card
                component={Link}
                to={`/project/${project.id}`}
                elevation={0}
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  width: "100%",
                  minHeight: 220,
                  color: "inherit",
                  textDecoration: "none",
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 3,
                  backgroundImage: "none",
                  transition:
                    "transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease",
                  "&:hover": {
                    transform: "translateY(-4px)",
                    boxShadow: 4,
                    borderColor: "primary.main",
                  },
                  "&:focus-visible": {
                    outline: "2px solid",
                    outlineColor: "primary.main",
                    outlineOffset: 3,
                  },
                }}
              >
                <CardContent
                  sx={{
                    p: { xs: 2.5, sm: 3 },
                    flexGrow: 1,
                    display: "flex",
                    flexDirection: "column",
                    "&:last-child": { pb: { xs: 2.5, sm: 3 } },
                  }}
                >
                  <Stack
                    direction="row"
                    alignItems="flex-start"
                    spacing={2}
                  >
                    <Box
                      sx={{
                        width: 48,
                        height: 48,
                        borderRadius: 2.5,
                        bgcolor: "action.hover",
                        border: "1px solid",
                        borderColor: "divider",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <FolderOutlinedIcon
                        sx={{ fontSize: 24, color: "primary.main" }}
                      />
                    </Box>

                    <Box sx={{ flexGrow: 1, minWidth: 0, pt: 0.25 }}>
                      <Typography
                        component="h3"
                        variant="h6"
                        fontWeight={750}
                        sx={{
                          fontSize: { xs: "1.05rem", md: "1.15rem" },
                          overflowWrap: "anywhere",
                          lineHeight: 1.4,
                        }}
                      >
                        {project.name}
                      </Typography>

                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                          mt: 1,
                          lineHeight: 1.7,
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {project.description || "No description provided."}
                      </Typography>
                    </Box>

                    {/* Delete button: main_admin only */}
                    {isMainAdmin && (
                      <IconButton
                        aria-label={`Delete ${project.name}`}
                        color="error"
                        size="small"
                        disabled={deletingProject}
                        onClick={(event) =>
                          handleDeleteClick(event, project)
                        }
                        sx={{
                          flexShrink: 0,
                          width: 40,
                          height: 40,
                        }}
                      >
                        <DeleteOutlineIcon />
                      </IconButton>
                    )}
                  </Stack>

                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={0.75}
                    sx={{
                      mt: "auto",
                      pt: 3,
                      color: "primary.main",
                    }}
                  >
                    <Typography
                      variant="body2"
                      fontWeight={700}
                    >
                      View project
                    </Typography>

                    <ArrowForwardRoundedIcon
                      sx={{
                        fontSize: 18,
                        transition: "transform 180ms ease",
                        ".MuiCard-root:hover &": {
                          transform: "translateX(3px)",
                        },
                      }}
                    />
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

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
