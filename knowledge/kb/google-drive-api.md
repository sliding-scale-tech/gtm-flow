# Google Drive API (v3) via service account
Researched: 2026-10-07 · Version: Drive API v3 · Sources: https://developers.google.com/identity/protocols/oauth2/service-account#httprest, https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list, https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get, https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export, https://developers.google.com/workspace/drive/api/guides/api-specific-auth, https://developers.google.com/workspace/drive/api/guides/enable-sdk

## What we use it for
List and download CSV files (and export Google Sheets as CSV) from a shared folder, read-only, from a Convex action using fetch + Web Crypto.

## Key APIs / setup (minimal examples)

### JWT by hand
Header `{"alg":"RS256","typ":"JWT"}` (optional `kid`). Claims: `iss` = service account email, `scope` = `https://www.googleapis.com/auth/drive.readonly`, `aud` = `https://oauth2.googleapis.com/token`, `iat` = now (s), `exp` = iat + at most 3600. `sub` only for domain-wide delegation (not needed). Signature = RSASSA-PKCS1-v1_5 with SHA-256 over `base64url(header).base64url(claims)`, then base64url.

```ts
const b64u = (b: ArrayBuffer | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b);
  let s = ""; bytes.forEach(c => (s += String.fromCharCode(c)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
function pemToDer(pem: string) {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), c => c.charCodeAt(0)).buffer;
}
export async function getAccessToken(email: string, privateKeyPem: string) {
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." + b64u(JSON.stringify({
    iss: email, scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 }));
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: unsigned + "." + b64u(sig) }),
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
  return (await res.json()) as { access_token: string; token_type: "Bearer"; expires_in: number };
}
```
Response: `access_token`, `token_type` "Bearer", `expires_in` (typically 3600). Send `Authorization: Bearer <token>`. The key JSON `private_key` is a PKCS#8 PEM ("-----BEGIN PRIVATE KEY-----"), usable with importKey("pkcs8"). The importKey/sign calls were verified to work in the Convex V8 runtime (see convex.md). Google recommends client libraries over hand-rolled JWTs.

### List files in a folder
```
GET https://www.googleapis.com/drive/v3/files
  ?q='<folderId>' in parents and mimeType='text/csv' and trashed=false
  &fields=nextPageToken,files(id,name,mimeType,modifiedTime,size,md5Checksum)
  &pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true
  &pageToken=<nextPageToken>
```
URL-encode `q` (use URLSearchParams). Loop until no `nextPageToken`. pageSize max 1000. To include Sheets: `(mimeType='text/csv' or mimeType='application/vnd.google-apps.spreadsheet')`. For a specific shared drive add `corpora=drive&driveId=<id>`. List returns trashed files by default, so keep `trashed=false`. Response: `files[]`, `nextPageToken`, `incompleteSearch`.

### Download / export
- Binary file (real CSV): `GET https://www.googleapis.com/drive/v3/files/{id}?alt=media&supportsAllDrives=true`
- Google Sheet: `GET https://www.googleapis.com/drive/v3/files/{id}/export?mimeType=text/csv` (first sheet only; export limited to 10 MB). `alt=media` works only for files stored in Drive, not Google Docs/Sheets/Slides.

### Access setup
- Enable "Google Drive API" in the Cloud Console project (APIs & Services > Enabled APIs & services > Google Drive API > Enable).
- A service account only sees what is shared with it: share the folder with the service-account email (`<name>@<project>.iam.gserviceaccount.com`) as Viewer in the Drive UI, same as sharing with a person. Folder sharing is inherited by children.

## Limits & gotchas
- `drive.readonly` is a Google "restricted" scope ("View and download all your Drive files"); restricted-scope verification is for user-consent OAuth apps.
- `drive.file` would not work (only covers files the app created/opened).
- Tokens last ~1 h; cache in memory per run, never store the key in code.
- Without supportsAllDrives/includeItemsFromAllDrives, shared-drive items are missing or 404.
- Private key in Convex env often arrives with literal `\n`; normalize.
- Clock skew causes `invalid_grant`; use a fresh `iat`.

## UNCONFIRMED
- Official page text on "share a folder with a service account email" was not fetched (guide URL 404); the Viewer-share method is standard practice.
- Whether restricted-scope verification applies to service-account-only use: not stated in fetched pages.
- Drive API quota numbers not checked.
