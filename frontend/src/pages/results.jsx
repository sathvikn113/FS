import { useEffect, useMemo, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import EmojiEventsRoundedIcon from "@mui/icons-material/EmojiEventsRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import InsightsRoundedIcon from "@mui/icons-material/InsightsRounded";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { api } from "../api";

const STATUS_LABELS = {
  planned: "Planned",
  in_progress: "In progress",
  implemented: "Implemented",
};

function StatCard({ icon, label, value, hint }) {
  return (
    <Card
      variant="outlined"
      sx={{
        height: "100%",
        borderRadius: 3,
        minWidth: 0,
        background: "background.paper",
      }}
    >
      <CardContent sx={{ p: { xs: 1.25, sm: 1.5 }, "&:last-child": { pb: { xs: 1.25, sm: 1.5 } } }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.75 }}>
          <Box
            sx={{
              display: "grid",
              placeItems: "center",
              width: 32,
              height: 32,
              flexShrink: 0,
              borderRadius: 2,
              bgcolor: "action.hover",
              color: "primary.main",
              "& svg": { fontSize: 19 },
            }}
          >
            {icon}
          </Box>
          <Typography color="text.secondary" fontWeight={600} variant="body2" sx={{ lineHeight: 1.25 }}>
            {label}
          </Typography>
        </Stack>
        <Typography
          sx={{
            fontSize: { xs: "1.45rem", sm: "1.65rem" },
            lineHeight: 1.1,
            fontWeight: 800,
            letterSpacing: "-0.035em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}
        </Typography>
        {hint && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.35, display: "block", overflowWrap: "anywhere" }}>
            {hint}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

export default function Results() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [percentageOperator, setPercentageOperator] = useState("any");
  const [percentageValue, setPercentageValue] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    api.getResults(id, controller.signal).then(
      (result) => {
        if (!current) return;
        setData(result);
        setError("");
      },
      (err) => {
        if (!current || controller.signal.aborted) return;
        setError(err.message || "Could not load results.");
      },
    );
    return () => {
      current = false;
      controller.abort();
    };
  }, [id, retryKey]);

  const results = useMemo(() => data?.results || [], [data]);
  const topFeature = results.length
    ? [...results].sort((a, b) => Number(b.share ?? b.priority ?? 0) - Number(a.share ?? a.priority ?? 0))[0]
    : null;

  const filteredResults = useMemo(() => {
    const threshold = percentageValue.trim() === "" ? null : Number(percentageValue);

    return results.filter((item) => {
      // The API should return the group's own status (planned/in_progress/implemented),
      // not the generic value "group".
      const status = item.status === "group"
        ? item.groupStatus || item.statusValue || "planned"
        : item.status || "planned";
      const share = Number(item.share ?? item.priority ?? 0);

      if (statusFilter !== "all" && status !== statusFilter) return false;

      // Do not apply a percentage comparison until a valid value is entered.
      if (percentageOperator !== "any" && threshold !== null && Number.isFinite(threshold)) {
        if (percentageOperator === "gt" && !(share > threshold)) return false;
        if (percentageOperator === "lt" && !(share < threshold)) return false;
        if (percentageOperator === "eq" && Math.abs(share - threshold) > 0.05) return false;
      }

      return true;
    });
  }, [results, statusFilter, percentageOperator, percentageValue]);

  const clearFilters = () => {
    setStatusFilter("all");
    setPercentageOperator("any");
    setPercentageValue("");
  };

  if (!data && !error) {
    return (
      <Box sx={{ pt: 2 }}>
        <Skeleton variant="text" width="35%" height={42} />
        <Skeleton variant="rounded" height={96} sx={{ mt: 1.5 }} />
        <Skeleton variant="rounded" height={260} sx={{ mt: 1.5 }} />
      </Box>
    );
  }

  return (
    <Box sx={{ width: "100%", minWidth: 0, pt: { xs: 1, md: 1.5 }, pb: 3 }}>
      <Button
        startIcon={<ArrowBackRoundedIcon />}
        onClick={() => navigate(`/project/${id}`)}
        sx={{ px: 0, mb: 1, minHeight: 36 }}
      >
        Back to project
      </Button>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => { setError(""); setRetryKey((value) => value + 1); }}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {data && (
        <>
          {/* Compact summary cards */}
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" },
              gap: { xs: 1.25, sm: 1.5 },
              mb: 2,
            }}
          >
            <StatCard
              icon={<InsightsRoundedIcon />}
              label="Listed features"
              value={results.length}
              hint="Active and implemented features"
            />
            <StatCard
              icon={<GroupsRoundedIcon />}
              label="Responses"
              value={data.responseCount ?? 0}
              hint="Submitted prioritizations"
            />
            <StatCard
              icon={<EmojiEventsRoundedIcon />}
              label="Top priority"
              value={topFeature ? `${Number(topFeature.share ?? topFeature.priority ?? 0).toFixed(1)}%` : "—"}
              hint={topFeature?.name || "No responses yet"}
            />
          </Box>

          {/* Compact results filters */}
          {results.length > 0 && (
            <Card variant="outlined" sx={{ borderRadius: 3, mb: 2, background: "background.paper" }}>
              <CardContent sx={{ p: { xs: 1.25, sm: 1.5 }, "&:last-child": { pb: { xs: 1.25, sm: 1.5 } } }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.1 }}>
                  Filter results
                </Typography>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" },
                    gap: 1.25,
                  }}
                >
                  <FormControl size="small" fullWidth>
                    <InputLabel id="results-status-label">Status</InputLabel>
                    <Select
                      labelId="results-status-label"
                      value={statusFilter}
                      label="Status"
                      onChange={(event) => setStatusFilter(event.target.value)}
                    >
                      <MenuItem value="all">All statuses</MenuItem>
                      <MenuItem value="planned">Planned</MenuItem>
                      <MenuItem value="in_progress">In progress</MenuItem>
                      <MenuItem value="implemented">Implemented</MenuItem>
                    </Select>
                  </FormControl>

                  <FormControl size="small" fullWidth>
                    <InputLabel id="results-percentage-operator-label">Percentage</InputLabel>
                    <Select
                      labelId="results-percentage-operator-label"
                      value={percentageOperator}
                      label="Percentage"
                      onChange={(event) => setPercentageOperator(event.target.value)}
                    >
                      <MenuItem value="any">Any percentage</MenuItem>
                      <MenuItem value="gt">Greater than (&gt;)</MenuItem>
                      <MenuItem value="lt">Less than (&lt;)</MenuItem>
                    </Select>
                  </FormControl>

                  <TextField
                    size="small"
                    fullWidth
                    type="number"
                    label="Percentage value"
                    placeholder="e.g. 20"
                    value={percentageValue}
                    onChange={(event) => setPercentageValue(event.target.value)}
                    disabled={percentageOperator === "any"}
                    inputProps={{ min: 0, max: 100, step: 0.1 }}
                  />
                </Box>

                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center", flexWrap: "wrap", mt: 1.1, rowGap: 0.25 }}
                >
                  <Typography variant="caption" color="text.secondary">
                    Showing {filteredResults.length} of {results.length} items
                  </Typography>
                  {(statusFilter !== "all" || percentageOperator !== "any" || percentageValue !== "") && (
                    <Button size="small" onClick={clearFilters} sx={{ minWidth: 0, p: 0.25, fontSize: "0.75rem" }}>
                      Clear filters
                    </Button>
                  )}
                </Stack>
              </CardContent>
            </Card>
          )}

          {results.length === 0 ? (
            <Card variant="outlined" sx={{ borderRadius: 3, p: { xs: 2.5, sm: 3 } }}>
              <Typography variant="h6" fontWeight={700}>No results yet</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                Once people submit their prioritizations, the ranking will appear here.
              </Typography>
              <Button variant="contained" onClick={() => navigate(`/project/${id}`)} sx={{ mt: 2, minHeight: 40 }}>
                Prioritize features
              </Button>
            </Card>
          ) : filteredResults.length === 0 ? (
            <Card variant="outlined" sx={{ borderRadius: 3, p: { xs: 2.5, sm: 3 }, textAlign: "center" }}>
              <Typography fontWeight={700}>No items match these filters</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1 }}>
                Try changing the status or percentage conditions.
              </Typography>
              <Button onClick={clearFilters} size="small">Clear filters</Button>
            </Card>
          ) : (
            <Box component="section" aria-labelledby="ranking-heading">
              <Typography
                id="ranking-heading"
                component="h2"
                sx={{ fontSize: { xs: "1.3rem", sm: "1.5rem" }, fontWeight: 650, mb: 1.25 }}
              >
                Feature ranking
              </Typography>

              <Card variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
                <Stack divider={<Box sx={{ borderBottom: "1px solid", borderColor: "divider" }} />}>
                  {filteredResults.map((item, index) => {
                    const share = Number(item.share ?? item.priority ?? 0);
                    const rawStatus = item.status === "group"
                      ? item.groupStatus || item.statusValue || "planned"
                      : item.status || "planned";
                    const status = STATUS_LABELS[rawStatus] || rawStatus;
                    const itemKey = item.groupId
                      ? `group:${item.groupId}`
                      : item.featureId || `${item.name}-${index}`;

                    return (
                      <Box
                        key={itemKey}
                        sx={{
                          p: { xs: 1.5, sm: 2 },
                          bgcolor: index === 0 ? "action.hover" : "transparent",
                        }}
                      >
                        <Stack direction="row" spacing={1.25} sx={{ alignItems: "flex-start" }}>
                          <Box
                            sx={{
                              flexShrink: 0,
                              display: "grid",
                              placeItems: "center",
                              width: 36,
                              height: 36,
                              borderRadius: 2,
                              fontWeight: 800,
                              fontSize: "0.9rem",
                              bgcolor: index === 0 ? "primary.main" : "action.hover",
                              color: index === 0 ? "primary.contrastText" : "text.secondary",
                            }}
                          >
                            {String(index + 1).padStart(2, "0")}
                          </Box>

                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Stack
                              direction={{ xs: "column", sm: "row" }}
                              spacing={0.75}
                              sx={{ alignItems: { xs: "flex-start", sm: "center" }, justifyContent: "space-between", mb: 0.8 }}
                            >
                              <Typography component="h3" sx={{ fontWeight: 700, fontSize: "1rem", overflowWrap: "anywhere" }}>
                                {item.name}
                              </Typography>
                              <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                                <Chip size="small" label={status} variant="outlined" />
                                <Typography sx={{ fontSize: "0.98rem", fontWeight: 750, fontVariantNumeric: "tabular-nums", minWidth: 62, textAlign: { sm: "right" } }}>
                                  {share.toFixed(1)}%
                                </Typography>
                              </Stack>
                            </Stack>

                            <LinearProgress
                              variant="determinate"
                              value={Math.min(100, share)}
                              color={index === 0 ? "success" : "primary"}
                              aria-label={`${item.name}: ${share.toFixed(1)} percent priority share`}
                              sx={{ height: 7, borderRadius: 99, bgcolor: "action.hover", "& .MuiLinearProgress-bar": { borderRadius: 99 } }}
                            />

                            <Stack direction="row" spacing={1.75} sx={{ mt: 0.75, flexWrap: "wrap", rowGap: 0.25 }}>
                              <Typography variant="caption" color="text.secondary">
                                Total score: <Box component="span" sx={{ color: "text.primary", fontWeight: 650 }}>{item.totalScore ?? 0}</Box>
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                Contributors: <Box component="span" sx={{ color: "text.primary", fontWeight: 650 }}>{item.contributors ?? item.stakeholderCount ?? 0}</Box>
                              </Typography>
                            </Stack>

                            {item.groupId && item.features?.length > 0 && (
                              <Accordion disableGutters elevation={0} sx={{ mt: 0.5, bgcolor: "transparent", "&::before": { display: "none" } }}>
                                <AccordionSummary
                                  expandIcon={<ExpandMoreRoundedIcon />}
                                  sx={{ px: 0, minHeight: 32, "& .MuiAccordionSummary-content": { my: 0.35 } }}
                                >
                                  <Typography variant="caption">View grouped features ({item.features.length})</Typography>
                                </AccordionSummary>
                                <AccordionDetails sx={{ px: 0, pt: 0 }}>
                                  <Stack spacing={0.75}>
                                    {item.features.map((feature) => {
                                      const featureStatus = STATUS_LABELS[feature.status] || feature.status || "Planned";
                                      return (
                                        <Stack key={feature.id} direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                                          <Typography variant="body2" color="text.secondary">• {feature.name}</Typography>
                                          <Chip size="small" variant="outlined" label={featureStatus} />
                                        </Stack>
                                      );
                                    })}
                                  </Stack>
                                </AccordionDetails>
                              </Accordion>
                            )}
                          </Box>
                        </Stack>
                      </Box>
                    );
                  })}
                </Stack>
              </Card>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
