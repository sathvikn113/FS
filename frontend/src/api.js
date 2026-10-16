const BASE_URL = "http://localhost:8000/api";

async function request(path, options = {}) {
  let response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...options,

      // Send session cookies with API requests.
      credentials: "include",

      headers: {
        ...(options.body
          ? { "Content-Type": "application/json" }
          : {}),
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new Error(
      "The server could not be reached. Check that the backend is running and try again."
    );
  }

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = new Error(
      data?.detail ||
        data?.message ||
        `Request failed with status ${response.status}`
    );

    error.status = response.status;
    throw error;
  }

  return data;
}

const projectPath = (projectId) =>
  `/projects/${encodeURIComponent(projectId)}`;

export const api = {
  // Authentication
  getCurrentUser: (signal) =>
    request("/auth/me", { signal }),

  // Projects
  getProjects: (signal) =>
    request("/projects", { signal }),

  getProject: (projectId, signal) =>
    request(projectPath(projectId), { signal }),

  createProject: (body) =>
    request("/projects", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  deleteProject: (projectId) =>
    request(projectPath(projectId), {
      method: "DELETE",
    }),

  // Features
  getFeatures: (projectId, signal) =>
    request(`${projectPath(projectId)}/features`, { signal }),

  addFeature: (projectId, body) =>
    request(`${projectPath(projectId)}/features`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateFeature: (projectId, featureId, body) =>
    request(
      `${projectPath(projectId)}/features/${encodeURIComponent(featureId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      }
    ),

  deleteFeature: (projectId, featureId) =>
    request(
      `${projectPath(projectId)}/features/${encodeURIComponent(featureId)}`,
      {
        method: "DELETE",
      }
    ),

  // Prioritization responses
  submitResponse: (projectId, body) =>
    request(`${projectPath(projectId)}/responses`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Results
  getResults: (projectId, signal) =>
    request(`${projectPath(projectId)}/results`, { signal }),
};
