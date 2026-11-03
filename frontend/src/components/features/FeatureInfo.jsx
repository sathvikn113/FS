import { Box, Typography } from "@mui/material";

export default function FeatureInfo({
  feature,
  startDate,
}) {
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography
        component="h3"
        variant="subtitle2"
        fontWeight={800}
        sx={{ fontSize: "0.98rem", lineHeight: 1.35, overflowWrap: "anywhere" }}
      >
        {feature.name}
      </Typography>

      {feature.description && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 0.15, overflowWrap: "anywhere", lineHeight: 1.35 }}
        >
          {feature.description}
        </Typography>
      )}

      {startDate && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 0.25 }}
        >
          Implementation started {startDate}
        </Typography>
      )}
    </Box>
  );
}
