const BASE_URL = "/api";

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    let message = "Something went wrong";

    try {
      const error = await response.json();
      message = error.detail || message;
    } catch {
      message = response.statusText || message;
    }

    throw new Error(message);
  }

  if (response.status === 204) return null;

  return response.json();
}

export const api = {
  getCurrentUser: (signal) => request("/auth/me", { signal }),

  getProjects: (signal) => request("/projects", { signal }),

  getProject: (projectId, signal) =>
    request(`/projects/${projectId}`, { signal }),

  createProject: (payload) =>
    request("/projects", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  deleteProject: (projectId) =>
    request(`/projects/${projectId}`, { method: "DELETE" }),

  getProjectPermissions: (projectId, signal) =>
    request(`/projects/${projectId}/permissions`, { signal }),

  updateProjectSupportEmail: (projectId, email) =>
    request(`/projects/${projectId}/support-email`, {
      method: "PATCH",
      body: JSON.stringify({ support_email: email }),
    }),

  // Features
  getFeatures: (projectId, signal) =>
    request(`/projects/${projectId}/features`, { signal }),

  addFeature: (projectId, payload) =>
    request(`/projects/${projectId}/features`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateFeature: (projectId, featureId, payload) =>
    request(`/projects/${projectId}/features/${featureId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  deleteFeature: (projectId, featureId) =>
    request(`/projects/${projectId}/features/${featureId}`, {
      method: "DELETE",
    }),

  // Feature Groups
  getFeatureGroups: (projectId, signal) =>
    request(`/projects/${projectId}/feature-groups`, { signal }),

  createFeatureGroup: (projectId, payload) =>
    request(`/projects/${projectId}/feature-groups`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateFeatureGroup: (projectId, groupId, payload) =>
    request(`/projects/${projectId}/feature-groups/${groupId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  deleteFeatureGroup: (projectId, groupId) =>
    request(`/projects/${projectId}/feature-groups/${groupId}`, {
      method: "DELETE",
    }),

  addFeatureToGroup: (projectId, groupId, payload) =>
    request(`/projects/${projectId}/feature-groups/${groupId}/features`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  ungroupFeature: (projectId, groupId, featureId) =>
    request(
      `/projects/${projectId}/feature-groups/${groupId}/features/${featureId}`,
      { method: "DELETE" }
    ),

  // // Dependencies
  getDependencies: (projectId, signal) =>
    request(`/projects/${projectId}/dependencies`, { signal }),

  createDependency: (projectId, payload) =>
    request(`/projects/${projectId}/dependencies`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  deleteDependency: (projectId, dependencyId) =>
    request(`/projects/${projectId}/dependencies/${dependencyId}`, {
      method: "DELETE",
    }),

  // Prioritization
  submitResponse: (projectId, payload) =>
    request(`/projects/${projectId}/responses`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // Results
  getResults: (projectId, signal) =>
    request(`/projects/${projectId}/results`, { signal }),
};