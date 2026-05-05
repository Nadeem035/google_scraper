import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import { postScrape, getJobStatus } from "./controllers/scrapeController.js";
import {
  postExport,
  getDownload,
} from "./controllers/exportController.js";
import { errorHandler } from "./middleware/errorHandler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(cors());
app.use(express.json({ limit: "4mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.render("dashboard", { title: "Lead Atlas — Dashboard" });
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.post("/api/scrape", postScrape);
app.get("/api/jobs/:jobId", getJobStatus);

app.post("/api/export", postExport);
app.get("/api/download", getDownload);

app.use(errorHandler);

// app.listen(PORT, () => {
//   console.log(`App http://localhost:${PORT}`);
// });
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});