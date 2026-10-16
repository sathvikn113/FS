import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import { Link } from "react-router-dom";
import { api } from "../api";

export default function Home() {
  const [projects, setProjects] = useState(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [deletingProject, setDeletingProject] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(false);
  const creatingRef = useRef(false);
  const deletingRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;

    api.getProjects(controller.signal).then(
      (data) => {
        if (!current) return;
        setProjects(data);
        setError("");
      },
      (err) => {
        if (!current || controller.signal.aborted) return;
        setError(err.message);
        setProjects(null);
      },
    );

    return () => {
      current = false;
      controller.abort();
    };
  }, [retryKey]);

  const create = async (event) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || creatingRef.current) return;

    try {
      creatingRef.current = true;
      setCreating(true);
      setError("");
      const project = await api.createProject({
        name: trimmedName,
        description: description.trim() || null,
      });
      setProjects((current) => [project, ...(current || [])]);
      setName("");
      setDescription("");
    } catch (err) {
      setError(err.message);
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  const remove = async () => {
    if (!deletingProject || deletingRef.current) return;
    try {
      deletingRef.current = true;
      setPendingDelete(true);
      setError("");
      await api.deleteProject(deletingProject.id);
      setProjects((current) => current?.filter((project) => project.id !== deletingProject.id) ?? []);
      setDeletingProject(null);
    } catch (err) {
      setError(err.message);
    } finally {
      deletingRef.current = false;
      setPendingDelete(false);
    }
  };

  return (
    <Box sx={{ pb: 8, pt: { xs: 4, md: 6 } }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ alignItems: { xs: "flex-start", sm: "flex-end" }, justifyContent: "space-between", mb: 4 }}
      >
        <Box>
          <Typography component="h1" variant="h3" sx={{ mb: 0.75, fontSize: { xs: "2rem", sm: "2.5rem" } }}>
            Explore projects
          </Typography>
          <Typography color="text.secondary" sx={{ fontSize: "1.05rem", maxWidth: 640 }}>
            Browse applications, compare feature priorities, and see what your team should build next.
          </Typography>
        </Box>
      </Stack>

      {error && projects !== null && !deletingProject && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}
{/* 
      <Card component="section" variant="outlined" sx={{ mb: 4, borderRadius: 3, boxShadow: "0 8px 28px rgba(20, 40, 28, 0.04)" }}>
        <CardContent sx={{ p: { xs: 2.25, md: 3 } }}>
          <Typography component="h2" variant="h6" sx={{ mb: 0.5 }}>
            Create a project
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2.5 }}>
            Give your project a name. Add a description if useful.
          </Typography>
          <Stack component="form" onSubmit={create} spacing={2}>
            <TextField
              fullWidth
              required
              label="Project name"
              placeholder=""
              value={name}
              onChange={(event) => setName(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 255 } }}
            />
            <TextField
              fullWidth
              label="Project description (optional)"
              placeholder="What is this project about?"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              multiline
              minRows={2}
              slotProps={{ htmlInput: { maxLength: 5000 } }}
            />
            <Button
              type="submit"
              variant="contained"
              startIcon={<AddRoundedIcon />}
              disabled={!name.trim() || creating}
              sx={{ alignSelf: { xs: "stretch", sm: "flex-end" }, minHeight: 44, minWidth: 170 }}
            >
              {creating ? "Creating project…" : "Create project"}
            </Button>
          </Stack>
        </CardContent>
      </Card> */}

      <Stack direction="row" spacing={1.25} sx={{ alignItems: "baseline", mb: 1.5 }}>
        <Typography component="h2" variant="h5">Project list</Typography>
        {projects && <Typography color="text.secondary">{projects.length}</Typography>}
      </Stack>

      {projects === null ? (
        error ? (
          <Card variant="outlined" sx={{ p: { xs: 3, md: 4 } }}>
            <Typography fontWeight={600}>Projects couldn’t be loaded.</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              Check the connection and retry. Your projects have not been cleared.
            </Typography>
            <Button onClick={() => { setError(""); setRetryKey((key) => key + 1); }} sx={{ mt: 1 }}>
              Retry loading projects
            </Button>
          </Card>
        ) : (
          <Stack spacing={1.25} aria-label="Loading projects">
            {[0, 1, 2].map((item) => (
              <Skeleton key={item} variant="rounded" height={82} />
            ))}
          </Stack>
        )
      ) : projects.length === 0 ? (
        <Card variant="outlined" sx={{ p: { xs: 3, md: 4 } }}>
          <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
            <FolderOpenOutlinedIcon sx={{ color: "text.secondary", mt: 0.25 }} />
            <Box>
              <Typography fontWeight={600}>No projects yet</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                Create a project above, then add at least two active features to collect priorities.
              </Typography>
            </Box>
          </Stack>
        </Card>
      ) : (
        <Stack component="ul" spacing={0} sx={{ m: 0, p: 0, listStyle: "none", borderTop: "1px solid", borderColor: "divider" }}>
          {projects.map((project) => (
            <Box component="li" key={project.id} sx={{ borderBottom: "1px solid", borderColor: "divider", transition: "background-color 160ms ease", "&:hover": { bgcolor: "action.hover" } }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "stretch" }}>
                <CardActionArea
                  component={Link}
                  to={`/project/${project.id}`}
                  aria-label={`Open project ${project.name}`}
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    px: { xs: 1.5, sm: 2 },
                    py: 2,
                    borderRadius: "10px",
                    "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
                  }}
                >
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                    <FolderOpenOutlinedIcon sx={{ color: "primary.main", flexShrink: 0 }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography component="span" fontWeight={650} sx={{ display: "block", overflowWrap: "anywhere" }}>
                        {project.name}
                      </Typography>
                      {project.description && (
                        <Typography component="span" variant="body2" color="text.secondary" sx={{ display: "block", overflowWrap: "anywhere" }}>
                          {project.description}
                        </Typography>
                      )}
                    </Box>
                    <Typography color="primary.main" aria-hidden="true" sx={{ pr: 1 }}>Open</Typography>
                  </Stack>
                </CardActionArea>
                <Tooltip title={`Delete ${project.name}`}>
                  <IconButton
                    aria-label={`Delete project ${project.name}`}
                    color="error"
                    onClick={() => setDeletingProject(project)}
                    sx={{ alignSelf: "center", width: 44, height: 44, flexShrink: 0 }}
                  >
                    <DeleteOutlineRoundedIcon sx={{ color: "inherit" }} />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Box>
          ))}
        </Stack>
      )}

      <Dialog
        open={Boolean(deletingProject)}
        onClose={() => !pendingDelete && setDeletingProject(null)}
        aria-labelledby="delete-project-title"
        aria-describedby="delete-project-description"
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle id="delete-project-title">Delete project?</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Typography id="delete-project-description" color="text.secondary">
            Delete “{deletingProject?.name}” and all its features and responses? This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeletingProject(null)} disabled={pendingDelete}>Cancel</Button>
          <Button onClick={remove} color="error" variant="contained" disabled={pendingDelete}>
            {pendingDelete ? "Deleting…" : "Delete project"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
