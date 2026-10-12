// Drive v3 via service account, signed with Web Crypto (kb/google-drive-api.md).
import { env, fail, http, isMock } from "./http";

const b64u = (b: ArrayBuffer | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b);
  let s = "";
  bytes.forEach((c) => (s += String.fromCharCode(c)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function accessToken(): Promise<string> {
  const sa = JSON.parse(env("GOOGLE_SERVICE_ACCOUNT_JSON"));
  const pem: string = String(sa.private_key).replace(/\\n/g, "\n");
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = `${b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64u(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600,
  }))}`;
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const r = await http("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64u(sig)}` }).toString(),
  });
  if (r.status !== 200) fail("google-oauth", r);
  return r.body.access_token;
}

export type DriveFile = { id: string; name: string; mimeType: string; modifiedTime: string; size?: string };
const SHEET = "application/vnd.google-apps.spreadsheet";

export async function listCsvFiles(): Promise<DriveFile[]> {
  if (isMock() && !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return [];
  const folder = env("DRIVE_FOLDER_ID");
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(folder)) throw new Error("DRIVE_FOLDER_ID looks invalid");
  const token = await accessToken();
  const files: DriveFile[] = [];
  let pageToken = "";
  do {
    const q = new URLSearchParams({
      q: `'${folder}' in parents and (mimeType='text/csv' or mimeType='${SHEET}') and trashed=false`,
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime,size)",
      pageSize: "1000", orderBy: "modifiedTime desc", supportsAllDrives: "true", includeItemsFromAllDrives: "true",
      ...(pageToken ? { pageToken } : {}),
    });
    const r = await http(`https://www.googleapis.com/drive/v3/files?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status !== 200) fail("drive", r);
    files.push(...r.body.files);
    pageToken = r.body.nextPageToken ?? "";
  } while (pageToken);
  return files;
}

/** Opens a CSV (or a Sheet's first tab exported as CSV) as a byte stream. Only files inside DRIVE_FOLDER_ID are allowed. */
export async function openCsv(fileId: string): Promise<{ name: string; body: ReadableStream<Uint8Array> }> {
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(fileId)) throw new Error("bad file id");
  const token = await accessToken();
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const meta = await http(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,parents&supportsAllDrives=true`, auth);
  if (meta.status !== 200) fail("drive", meta);
  if (!(meta.body.parents ?? []).includes(env("DRIVE_FOLDER_ID"))) throw new Error("File is not in the configured Drive folder");
  const url = meta.body.mimeType === SHEET
    ? `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`
    : `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, { ...auth, signal: AbortSignal.timeout(9 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`drive download HTTP ${res.status}`);
  return { name: meta.body.name, body: res.body };
}

/** Opens `reviews.csv` from the folder that contains DRIVE_FOLDER_ID (fixed name + fixed location only). */
export async function openReviewsCsv(): Promise<{ name: string; body: ReadableStream<Uint8Array> }> {
  const token = await accessToken();
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const folder = await http(`https://www.googleapis.com/drive/v3/files/${env("DRIVE_FOLDER_ID")}?fields=parents&supportsAllDrives=true`, auth);
  if (folder.status !== 200) fail("drive", folder);
  for (const parent of folder.body.parents ?? []) {
    const q = new URLSearchParams({ q: `'${parent}' in parents and name='reviews.csv' and trashed=false`, fields: "files(id,name)", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
    const r = await http(`https://www.googleapis.com/drive/v3/files?${q}`, auth);
    if (r.status !== 200) fail("drive", r);
    const f = r.body.files?.[0];
    if (!f) continue;
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&supportsAllDrives=true`, { ...auth, signal: AbortSignal.timeout(9 * 60_000) });
    if (!res.ok || !res.body) throw new Error(`drive download HTTP ${res.status}`);
    return { name: f.name, body: res.body };
  }
  throw new Error("reviews.csv not found next to the by_state folder");
}
