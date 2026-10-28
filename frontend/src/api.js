const BASE_URL = "http://localhost:8000/api";

async function request(path, options = {}) {
  let response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
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

const featurePath = (projectId, featureId) =>
  `${projectPath(projectId)}/features/${encodeURIComponent(featureId)}`;

const featureGroupPath = (projectId, groupId) =>
  `${projectPath(projectId)}/feature-groups/${encodeURIComponent(groupId)}`;

export const api = {
  // AUTHENTICATION

  getCurrentUser: (signal) =>
    request("/auth/me", { signal }),

  // PROJECTS

  getProjects: (signal) =>
    request("/projects", { signal }),

  getProject: (projectId, signal) =>
    request(projectPath(projectId), { signal }),

  getProjectPermissions: (projectId, signal) =>
    request(`${projectPath(projectId)}/permissions`, { signal }),

  createProject: (body) =>
    request("/projects", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  deleteProject: (projectId) =>
    request(projectPath(projectId), {
      method: "DELETE",
    }),

  // PROJECT SUPPORT EMAIL

  updateProjectSupportEmail: (projectId, email) =>
    request(`${projectPath(projectId)}/support-email`, {
      method: "PATCH",
      body: JSON.stringify({
        support_email: email || null,
      }),
    }),

  // FEATURES

  getFeatures: (projectId, signal) =>
    request(`${projectPath(projectId)}/features`, { signal }),

  addFeature: (projectId, body) =>
    request(`${projectPath(projectId)}/features`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateFeature: (projectId, featureId, body) =>
    request(featurePath(projectId, featureId), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  deleteFeature: (projectId, featureId) =>
    request(featurePath(projectId, featureId), {
      method: "DELETE",
    }),

  // FEATURE GROUPS

  getFeatureGroups: (projectId, signal) =>
    request(`${projectPath(projectId)}/feature-groups`, {
      signal,
    }),

  createFeatureGroup: (projectId, body) =>
    request(`${projectPath(projectId)}/feature-groups`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateFeatureGroup: (projectId, groupId, body) =>
    request(featureGroupPath(projectId, groupId), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  deleteFeatureGroup: (projectId, groupId) =>
    request(featureGroupPath(projectId, groupId), {
      method: "DELETE",
    }),

  addFeatureToGroup: (projectId, groupId, body) =>
    request(`${featureGroupPath(projectId, groupId)}/features`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  addFeaturesToGroup: (projectId, groupId, featureIds) =>
    request(`${featureGroupPath(projectId, groupId)}/features`, {
      method: "POST",
      body: JSON.stringify({
        feature_ids: featureIds,
      }),
    }),

  removeFeatureFromGroup: (projectId, groupId, featureId) =>
    request(
      `${featureGroupPath(projectId, groupId)}/features/${encodeURIComponent(
        featureId
      )}`,
      {
        method: "DELETE",
      }
    ),

  ungroupFeature: (projectId, groupId, featureId) =>
    request(
      `${featureGroupPath(projectId, groupId)}/features/${encodeURIComponent(
        featureId
      )}`,
      {
        method: "DELETE",
      }
    ),

  // PRIORITIZATION

  submitResponse: (projectId, body) =>
    request(`${projectPath(projectId)}/responses`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // RESULTS

  getResults: (projectId, signal) =>
    request(`${projectPath(projectId)}/results`, {
      signal,
    }),
};