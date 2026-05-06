function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const configuredOrigins = splitCsv(process.env.ALLOWED_ORIGINS);
const defaultOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const allowedOrigins = new Set(
  configuredOrigins.length > 0 ? configuredOrigins : defaultOrigins
);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  if (origin.startsWith("chrome-extension://")) return true;
  return false;
}

export function corsOptionsDelegate(req, callback) {
  const requestOrigin = req.header("Origin");

  if (!requestOrigin) {
    callback(null, { origin: true, credentials: false });
    return;
  }

  if (!isAllowedOrigin(requestOrigin)) {
    callback(new Error(`Origin not allowed: ${requestOrigin}`));
    return;
  }

  callback(null, {
    origin: true,
    credentials: false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-extension-token"],
  });
}

export function requireExtensionToken(req, res, next) {
  const expectedToken = String(process.env.EXTENSION_API_TOKEN || "").trim();

  if (!expectedToken) {
    next();
    return;
  }

  const providedToken = String(req.header("x-extension-token") || "").trim();
  if (providedToken && providedToken === expectedToken) {
    next();
    return;
  }

  const sameOriginReferrer = String(req.header("Referer") || "").startsWith(
    `${req.protocol}://${req.get("host")}`
  );
  if (sameOriginReferrer) {
    next();
    return;
  }

  res.status(401).json({ error: "Unauthorized" });
}

export function getApiMeta(req, res) {
  res.json({
    ok: true,
    app: "lead-atlas",
    version: "1.0.0",
    auth: {
      header: "x-extension-token",
      required: Boolean(String(process.env.EXTENSION_API_TOKEN || "").trim()),
    },
    features: {
      exportDownload: true,
      persistentJobs: false,
      popupSafePolling: true,
      sidePanelRecommended: true,
    },
  });
}