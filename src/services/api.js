import axios from "axios";

let BASE = "";
let _token = "";

export function setBaseUrl(url) {
  BASE = url.replace(/\/$/, "");
}

export function setAuthToken(token) {
  _token = token;
}

function auth() {
  return _token ? { headers: { Authorization: `Bearer ${_token}` } } : {};
}

// ── Auth ─────────────────────────────────────────────────────────────────────
export async function register(email, name, password) {
  const { data } = await axios.post(`${BASE}/api/auth/register`, { email, name, password });
  return data; // { token, user }
}

export async function login(email, password) {
  const { data } = await axios.post(`${BASE}/api/auth/login`, { email, password });
  return data; // { token, user }
}

export async function getMe() {
  const { data } = await axios.get(`${BASE}/api/auth/me`, auth());
  return data;
}

export async function updateProfile(name) {
  const { data } = await axios.patch(`${BASE}/api/auth/profile`, { name }, auth());
  return data;
}

export async function deleteAccount() {
  const { data } = await axios.delete(`${BASE}/api/auth/account`, auth());
  return data;
}

// ── Annotations ──────────────────────────────────────────────────────────────
export async function startAnnotation(videoName, tier, context = "") {
  const { data } = await axios.post(`${BASE}/api/annotations/start`, { video_name: videoName, tier, context }, auth());
  return data; // { annotation_id, credits_deducted, credits_remaining, openrouter_api_key, openrouter_model, openrouter_base_url, frames_per_sec }
}

export async function completeAnnotation(annotationId, segments, tokensUsed, costUsd = 0) {
  const { data } = await axios.post(`${BASE}/api/annotations/complete`, {
    annotation_id: annotationId,
    segments,
    tokens_used: tokensUsed,
    cost_usd: costUsd,
  }, auth());
  return data;
}

export async function failAnnotation(annotationId, errorMessage = "") {
  const { data } = await axios.post(`${BASE}/api/annotations/fail`, { annotation_id: annotationId, error_message: errorMessage }, auth());
  return data; // { credits_refunded }
}

export async function listAnnotations(skip = 0, limit = 20) {
  const { data } = await axios.get(`${BASE}/api/annotations/`, { ...auth(), params: { skip, limit } });
  return data; // { total, items }
}

export async function getAnnotation(id) {
  const { data } = await axios.get(`${BASE}/api/annotations/${id}`, auth());
  return data;
}

// ── Mpesa ─────────────────────────────────────────────────────────────────────
export async function stkPush(mpesaPhone, amount) {
  const { data } = await axios.post(`${BASE}/api/mpesa/stkpush`, { mpesa_phone: mpesaPhone, amount }, auth());
  return data;
}

export async function pollPayment(checkoutId) {
  const { data } = await axios.get(`${BASE}/api/mpesa/status/${checkoutId}`, auth());
  return data;
}

// ── Admin ─────────────────────────────────────────────────────────────────────
export async function adminOverview() {
  const { data } = await axios.get(`${BASE}/api/admin/overview`, auth());
  return data;
}

export async function adminListUsers(skip = 0, limit = 50, search = "") {
  const { data } = await axios.get(`${BASE}/api/admin/users`, { ...auth(), params: { skip, limit, search } });
  return data;
}

export async function adminUpdateUser(id, updates) {
  const { data } = await axios.patch(`${BASE}/api/admin/users/${id}`, updates, auth());
  return data;
}

export async function adminDeleteUser(id) {
  const { data } = await axios.delete(`${BASE}/api/admin/users/${id}`, auth());
  return data;
}

export async function adminGetSettings() {
  const { data } = await axios.get(`${BASE}/api/admin/settings`, auth());
  return data;
}

export async function adminOpenRouterBalance() {
  const { data } = await axios.get(`${BASE}/api/admin/openrouter-balance`, auth());
  return data;
}

export async function adminUpdateSettings(updates) {
  const { data } = await axios.put(`${BASE}/api/admin/settings`, updates, auth());
  return data;
}
