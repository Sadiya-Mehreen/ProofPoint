// FRONTEND_ORIGIN can be a comma-separated list (see app.ts); the first entry
// is the canonical one used to build absolute links back to the app (e.g. in
// password reset emails). Falls back to localhost for local dev.
const configured = (process.env["FRONTEND_ORIGIN"] || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)[0];

export const frontendOrigin = configured || "http://localhost:25575";
