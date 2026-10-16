import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
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
    <Card variant="outlined" sx={{ height: "100%", borderRadius: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", mb: 1.5 }}>
          <Box sx={{ display: "grid", placeItems: "center", width: 40, height: 40, borderRadius: 2, bgcolor: "action.hover", color: "primary.main" }}>
            {icon}
          </Box>
          <Typography color="text.secondary" fontWeight={600}>{label}</Typography>
        </Stack>
        <Typography variant="h4" sx={{ fontWeight: 750, letterSpacing: "-0.035em", fontVariantNumeric: "tabular-nums" }}>{value}</Typography>
        {hint && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{hint}</Typography>}
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
  const topFeature = results[0];
  const maxShare = Math.max(1, ...results.map((item) => Number(item.share ?? item.priority ?? 0)));

  if (!data && !error) {
    return (
      <Box sx={{ pt: { xs: 3, md: 5 } }}>
        <Skeleton variant="text" width="45%" height={54} />
        <Skeleton variant="rounded" height={130} sx={{ mt: 2 }} />
        <Skeleton variant="rounded" height={280} sx={{ mt: 2 }} />
      </Box>
    );
  }

  return (
    <Box sx={{ pt: { xs: 3, md: 4 }, pb: 7 }}>
      <Button startIcon={<ArrowBackRoundedIcon />} onClick={() => navigate(`/project/${id}`)} sx={{ px: 0, mb: 1.5, minHeight: 42 }}>
        Back to project
      </Button>

      <Card
        sx={{
          overflow: "hidden",
          mb: 3,
          borderRadius: { xs: 3, md: 4 },
          color: "text.primary",
          border: "1px solid",
          borderColor: "divider",
          background: (theme) => theme.palette.mode === "dark"
            ? "linear-gradient(125deg, rgba(131,201,168,0.14), rgba(26,36,30,0.7) 62%)"
            : "linear-gradient(125deg, rgba(40,107,87,0.12), rgba(255,255,255,0.96) 65%)",
        }}
      >
        {/* <CardContent sx={{ p: { xs: 2.5, sm: 3.5, md: 4 } }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { xs: "flex-start", sm: "center" }, justifyContent: "space-between" }}>
            <Box sx={{ minWidth: 0 }}>
              <Chip icon={<InsightsRoundedIcon />} label="Prioritization results" variant="outlined" color="primary" sx={{ mb: 1.5, fontWeight: 650 }} />
              <Typography component="h1" variant="h3" sx={{ fontSize: { xs: "2rem", sm: "2.5rem" }, lineHeight: 1.15, overflowWrap: "anywhere" }}>
                {data?.projectName || "Project results"}
              </Typography>
              <Typography color="text.secondary" sx={{ mt: 1, fontSize: "1.05rem", maxWidth: 650 }}>
                A clear view of the features receiving the most priority from submitted allocations.
              </Typography>
            </Box>
            {location.state?.submitted && <Chip color="success" label="Your response was submitted" sx={{ fontWeight: 650 }} />}
          </Stack>
        </CardContent> */}
      </Card>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} action={<Button color="inherit" size="small" onClick={() => { setError(""); setRetryKey((value) => value + 1); }}>Retry</Button>}>
          {error}
        </Alert>
      )}

      {data && (
        <>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", md: "repeat(3, minmax(0, 1fr))" }, gap: 2, mb: 4 }}>
            <StatCard icon={<InsightsRoundedIcon />} label="Total Features" value={results.length} hint="Active and implemented features" />
            <StatCard icon={<GroupsRoundedIcon />} label="Responses" value={data.responseCount ?? 0} hint="Submitted prioritizations" />
            <StatCard icon={<EmojiEventsRoundedIcon />} label="Top priority" value={topFeature ? `${Number(topFeature.share ?? topFeature.priority ?? 0).toFixed(1)}%` : "—"} hint={topFeature?.name || "No responses yet"} />
          </Box>

          {results.length === 0 ? (
            <Card variant="outlined" sx={{ borderRadius: 3, p: { xs: 2.5, sm: 4 } }}>
              <Typography variant="h6" fontWeight={700}>No results yet</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.75 }}>Once people submit their prioritizations, the ranking will appear here.</Typography>
              <Button variant="contained" onClick={() => navigate(`/project/${id}`)} sx={{ mt: 2, minHeight: 44 }}>Prioritize features</Button>
            </Card>
          ) : (
            <Box component="section" aria-labelledby="ranking-heading">
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { xs: "flex-start", sm: "baseline" }, justifyContent: "space-between", mb: 1.5 }}>
                <Typography id="ranking-heading" component="h2" variant="h5" sx={{ fontSize: { xs: "1.4rem", sm: "1.65rem" } }}>Feature ranking</Typography>
                <Typography color="text.secondary" variant="body2"></Typography>
              </Stack>

              <Card variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
                <Stack divider={<Box sx={{ borderBottom: "1px solid", borderColor: "divider" }} />}>
                  {results.map((item, index) => {
                    const share = Number(item.share ?? item.priority ?? 0);
                    const status = STATUS_LABELS[item.status] || item.status || "Planned";
                    return (
                      <Box key={item.featureId || `${item.name}-${index}`} sx={{ p: { xs: 2, sm: 2.5 }, bgcolor: index === 0 ? "action.hover" : "transparent" }}>
                        <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
                          <Box sx={{ flexShrink: 0, display: "grid", placeItems: "center", width: 42, height: 42, borderRadius: 2, fontWeight: 800, fontSize: "1.05rem", bgcolor: index === 0 ? "primary.main" : "action.hover", color: index === 0 ? "primary.contrastText" : "text.secondary" }}>
                            {String(index + 1).padStart(2, "0")}
                          </Box>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Stack direction={{ xs: "column", sm: "row" }} spacing={0.75} sx={{ alignItems: { xs: "flex-start", sm: "center" }, justifyContent: "space-between", mb: 1 }}>
                              <Typography component="h3" sx={{ fontWeight: 700, fontSize: "1.08rem", overflowWrap: "anywhere" }}>{item.name}</Typography>
                              <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                                <Chip size="small" label={status} variant="outlined" />
                                <Typography sx={{ fontSize: "1.05rem", fontWeight: 750, fontVariantNumeric: "tabular-nums", minWidth: 68, textAlign: { sm: "right" } }}>{share.toFixed(1)}%</Typography>
                              </Stack>
                            </Stack>
                            <LinearProgress
                              variant="determinate"
                              value={Math.min(100, share)}
                              color={index === 0 ? "success" : "primary"}
                              aria-label={`${item.name}: ${share.toFixed(1)} percent priority share`}
                              sx={{ height: 9, borderRadius: 99, bgcolor: "action.hover", "& .MuiLinearProgress-bar": { borderRadius: 99 } }}
                            />
                            <Stack direction="row" spacing={2} sx={{ mt: 1, flexWrap: "wrap" }}>
                              <Typography variant="body2" color="text.secondary">Total score: <Box component="span" sx={{ color: "text.primary", fontWeight: 650 }}>{item.totalScore ?? 0}</Box></Typography>
                              <Typography variant="body2" color="text.secondary">Contributors: <Box component="span" sx={{ color: "text.primary", fontWeight: 650 }}>{item.contributors ?? item.stakeholderCount ?? 0}</Box></Typography>
                            </Stack>
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
