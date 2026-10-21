import { Chip } from "@mui/material";

export default function FeatureStatus({ currentStatus }) {
  return (
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
  );
}