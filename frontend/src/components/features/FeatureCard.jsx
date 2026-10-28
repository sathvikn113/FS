import {
  Box,
  Button,
  IconButton,
  Popover,
  Slider,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";

import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";

import FeatureInfo from "./FeatureInfo.jsx";
import FeatureStatus from "./FeatureStatus.jsx";

export default function FeatureCard({
  feature,
  implemented = false,
  allocation,
  formatStartDate,
  IMPLEMENTATION_STATUSES,
  canManageFeatures,
  pendingAction,
  submitting,
  statusAnchor,
  setStatusAnchor,
  selectedStatusFeature,
  setSelectedStatusFeature,
  updateStatus,
  openEditor,
  setDeleteTarget,
  updatePercentage,
}) {
  const value = Number(allocation.values[feature.id] || 0);

  const startDate = formatStartDate(
    feature.implementation_started_at
  );

  const currentStatus =
    IMPLEMENTATION_STATUSES.find(
      (item) => item.value === feature.status
    ) || IMPLEMENTATION_STATUSES[0];

  return (
    <Box
      component="article"
      sx={{
        py: 1.25,
        borderBottom: "1px solid",
        borderColor: "divider",
        "&:last-of-type": { borderBottom: 0 },
      }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={{ xs: 0.75, sm: 1.25 }}
        sx={{
          alignItems: { xs: "stretch", sm: "flex-start" },
        }}
      >
        <FeatureInfo
          feature={feature}
          startDate={startDate}
        />

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={{ xs: 0.5, sm: 0.75 }}
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
                    minWidth: 118,
                    minHeight: 32,
                    px: 1.25,
                    borderRadius: "9px",
                    textTransform: "none",
                    justifyContent: "flex-start",
                    fontSize: "0.76rem",
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
                      mr: 0.75,
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
              <FeatureStatus currentStatus={currentStatus} />
            )}

            <Typography
              component="span"
              variant="body2"
              fontWeight={700}
              sx={{ minWidth: 44, textAlign: "right" }}
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
                  sx={{ width: 36, height: 36 }}
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
                  sx={{ width: 36, height: 36 }}
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
          disabled={Boolean(pendingAction) || submitting}
          sx={{
            mt: 0.25,
            mb: -0.75,
            py: 0.5,
            color: "primary.main",
          }}
        />
      ) : (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 0.5 }}
        >
          This feature is excluded from new allocations.
        </Typography>
      )}
    </Box>
  );
}

