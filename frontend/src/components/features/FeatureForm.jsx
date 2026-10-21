import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from "@mui/material";

export default function FeatureForm({
  editingFeature,
  setEditingFeature,
  editName,
  setEditName,
  editDescription,
  setEditDescription,
  error,
  pendingAction,
  saveFeature,
}) {
  return (
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
            disabled={!editName.trim() || Boolean(pendingAction)}
          >
            {pendingAction.startsWith("edit-")
              ? "Saving…"
              : "Save changes"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
