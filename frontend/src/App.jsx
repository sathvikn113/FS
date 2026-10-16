import { lazy, Suspense } from "react";
import {
  AppBar,
  Box,
  Button,
  IconButton,
  Stack,
  Toolbar,
  Typography,
} from "@mui/material";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import { Link, Route, Routes } from "react-router-dom";
import { ThemeWrapper } from "./theme.jsx";
import { AuthProvider, useAuth } from "./AuthContext.jsx";

const Home = lazy(() => import("./pages/Home.jsx"));
const ProjectDetail = lazy(() => import("./pages/projectDetail.jsx"));
const Results = lazy(() => import("./pages/results.jsx"));

function Shell({ mode, toggle, children }) {
  const { user, loading } = useAuth();
  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default" }}>
      <AppBar
        component="header"
        position="static"
        elevation={0}
        sx={{
          bgcolor: "background.paper",
          color: "text.primary",
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Toolbar
          sx={{
            width: "100%",
            maxWidth: 1180,
            minHeight: "64px !important",
            mx: "auto",
            px: { xs: 2, sm: 3 },
          }}
        >
          <Stack
            component={Link}
            to="/"
            direction="row"
            spacing={1.25}
            sx={{
              display: "flex",
              alignItems: "center",
              flexGrow: 1,
              color: "text.primary",
              textDecoration: "none",
              borderRadius: "6px",
              "&:focus-visible": {
                outline: "2px solid",
                outlineColor: "primary.main",
                outlineOffset: 3,
              },
            }}
          >
            <TuneRoundedIcon sx={{ width: 22, height: 22, color: "primary.main" }} />
            <Typography component="span" fontWeight={700} sx={{ letterSpacing: "-0.02em" }}>
              Features Selector
            </Typography>
          </Stack>
          {loading ? null : user ? (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mr: 1, display: { xs: "none", sm: "block" } }}>
                {user.username || user.email} · {user.is_admin ? "Admin" : "User"}
              </Typography>
              <Button component="a" href="http://localhost:4180/oauth2/sign_out?rd=http://localhost:5173" size="medium" variant="outlined" sx={{ minHeight: 40, mr: 1, whiteSpace: "nowrap" }}>
                Sign out
              </Button>
            </>
          ) : (
            <Button component="a" href="http://localhost:4180/oauth2/sign_in?rd=http://localhost:5173" size="medium" variant="contained" sx={{ minHeight: 40, mr: 1, whiteSpace: "nowrap" }}>
              Sign in
            </Button>
          )}
          <IconButton
            onClick={toggle}
            aria-label={`Switch to ${mode === "light" ? "dark" : "light"} mode`}
            sx={{
              width: 44,
              height: 44,
              color: "text.secondary",
              borderRadius: "8px",
              "&:focus-visible": {
                outline: "2px solid",
                outlineColor: "primary.main",
                outlineOffset: 2,
              },
            }}
          >
            {mode === "light" ? (
              <DarkModeOutlinedIcon sx={{ width: 20, height: 20, color: "inherit" }} />
            ) : (
              <LightModeOutlinedIcon sx={{ width: 20, height: 20, color: "inherit" }} />
            )}
          </IconButton>
        </Toolbar>
      </AppBar>

      <Box
        component="main"
        sx={{
          width: "100%",
          maxWidth: 1180,
          mx: "auto",
          px: { xs: 2, sm: 3 },
          pb: { xs: 4, md: 6 },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

function NotFound() {
  return (
    <Stack sx={{ py: 8, textAlign: "center", alignItems: "center" }} spacing={2}>
      <Typography component="h1" variant="h4">Page not found</Typography>
      <Typography color="text.secondary">That page isn’t part of this project workspace.</Typography>
      <Button component={Link} to="/" variant="contained" sx={{ minHeight: 44 }}>Go to projects</Button>
    </Stack>
  );
}

export default function App() {
  return (
    <AuthProvider>
    <ThemeWrapper>
      {(mode, toggle) => (
        <Shell mode={mode} toggle={toggle}>
          <Suspense
            fallback={
              <Typography role="status" sx={{ py: 5 }} color="text.secondary">
                Loading page…
              </Typography>
            }
          >
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/project/:id" element={<ProjectDetail />} />
              <Route path="/project/:id/prioritize" element={<ProjectDetail />} />
              <Route path="/project/:id/results" element={<Results />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </Shell>
      )}
    </ThemeWrapper>
    </AuthProvider>
  );
}


// import "./App.css";
// import { lazy, Suspense } from "react";
// import {
//   AppBar,
//   Box,
//   Button,
//   IconButton,
//   Stack,
//   Toolbar,
//   Typography,
// } from "@mui/material";
// import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
// import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
// import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
// import { Link, Route, Routes } from "react-router-dom";
// import { ThemeWrapper } from "./theme.jsx";
// import { AuthProvider, useAuth } from "./AuthContext.jsx";

// const Home = lazy(() => import("./pages/Home.jsx"));
// const ProjectDetail = lazy(() => import("./pages/projectDetail.jsx"));
// const Results = lazy(() => import("./pages/results.jsx"));

// function Shell({ mode, toggle, children }) {
//   return (
//     <Box sx={{ minHeight: "100dvh", bgcolor: "background.default" }}>
//       <AppBar
//         component="header"
//         position="static"
//         elevation={0}
//         sx={{
//           bgcolor: "background.paper",
//           color: "text.primary",
//           borderBottom: "1px solid",
//           borderColor: "divider",
//         }}
//       >
//         <Toolbar
//           sx={{
//             width: "100%",
//             maxWidth: 1180,
//             minHeight: "64px !important",
//             mx: "auto",
//             px: { xs: 2, sm: 3 },
//           }}
//         >
//           <Stack
//             component={Link}
//             to="/"
//             direction="row"
//             spacing={1.25}
//             sx={{
//               display: "flex",
//               alignItems: "center",
//               flexGrow: 1,
//               color: "text.primary",
//               textDecoration: "none",
//               borderRadius: "6px",
//               "&:focus-visible": {
//                 outline: "2px solid",
//                 outlineColor: "primary.main",
//                 outlineOffset: 3,
//               },
//             }}
//           >
//             <TuneRoundedIcon sx={{ width: 22, height: 22, color: "primary.main" }} />
//             <Typography component="span" fontWeight={700} sx={{ letterSpacing: "-0.02em" }}>
//               Features Selector
//             </Typography>
//           </Stack>
//           <Button
//             component="a"
//             href="http://localhost:4180/oauth2/sign_in?rd=http://localhost:5173"
//             variant="outlined"
//             size="medium"
//             sx={{ minHeight: 42, mr: 1, px: 2, borderRadius: "9px", whiteSpace: "nowrap" }}
//           >
//             Sign in
//           </Button>
//           <IconButton
//             onClick={toggle}
//             aria-label={`Switch to ${mode === "light" ? "dark" : "light"} mode`}
//             sx={{
//               width: 44,
//               height: 44,
//               color: "text.secondary",
//               borderRadius: "8px",
//               "&:focus-visible": {
//                 outline: "2px solid",
//                 outlineColor: "primary.main",
//                 outlineOffset: 2,
//               },
//             }}
//           >
//             {mode === "light" ? (
//               <DarkModeOutlinedIcon sx={{ width: 20, height: 20, color: "inherit" }} />
//             ) : (
//               <LightModeOutlinedIcon sx={{ width: 20, height: 20, color: "inherit" }} />
//             )}
//           </IconButton>
//         </Toolbar>
//       </AppBar>

//       <Box
//         component="main"
//         sx={{
//           width: "100%",
//           maxWidth: 1180,
//           mx: "auto",
//           px: { xs: 2, sm: 3 },
//           pb: { xs: 4, md: 6 },
//         }}
//       >
//         {children}
//       </Box>
//     </Box>
//   );
// }

// function NotFound() {
//   return (
//     <Stack sx={{ py: 8, textAlign: "center", alignItems: "center" }} spacing={2}>
//       <Typography component="h1" variant="h4">Page not found</Typography>
//       <Typography color="text.secondary">That page isn’t part of this project workspace.</Typography>
//       <Button component={Link} to="/" variant="contained" sx={{ minHeight: 44 }}>Go to projects</Button>
//     </Stack>
//   );
// }

// export default function App() {
//   return (
//     <ThemeWrapper>
//       {(mode, toggle) => (
//         <Shell mode={mode} toggle={toggle}>
//           <Suspense
//             fallback={
//               <Typography role="status" sx={{ py: 5 }} color="text.secondary">
//                 Loading page…
//               </Typography>
//             }
//           >
//             <Routes>
//               <Route path="/" element={<Home />} />
//               <Route path="/project/:id" element={<ProjectDetail />} />
//               <Route path="/project/:id/prioritize" element={<ProjectDetail />} />
//               <Route path="/project/:id/results" element={<Results />} />
//               <Route path="*" element={<NotFound />} />
//             </Routes>
//           </Suspense>
//         </Shell>
//       )}
//     </ThemeWrapper>
//   );
// }
