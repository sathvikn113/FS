import { Box, Typography } from "@mui/material";

export default function FeatureInfo({
  feature,
  startDate,
}) {
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography
        component="h3"
        variant="body2"
        fontWeight={700}
        sx={{ overflowWrap: "anywhere" }}
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
