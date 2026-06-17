import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ResourceService } from "./resourceService.js";

const app = express();
const port = Number(process.env.PORT || 8080);
const resourceService = new ResourceService();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistPath = path.resolve(__dirname, "../../client/dist");

app.get("/api/healthz", async (_req, res) => {
  try {
    await resourceService.snapshot();
    res.json({ ok: true });
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown Kubernetes connectivity error"
    });
  }
});

app.get("/api/resources", async (_req, res) => {
  try {
    const namespace = typeof _req.query.namespace === "string" && _req.query.namespace !== "all" ? _req.query.namespace : undefined;
    res.json(await resourceService.getResources(namespace));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load resources"
    });
  }
});

app.get("/api/graph", async (_req, res) => {
  try {
    const namespace = typeof _req.query.namespace === "string" && _req.query.namespace !== "all" ? _req.query.namespace : undefined;
    const focusId = typeof _req.query.focusId === "string" ? _req.query.focusId : undefined;
    const parsedDepth = Number(_req.query.depth);
    const parsedLimit = Number(_req.query.limit);
    res.json(
      await resourceService.snapshot({
        namespace,
        focusId,
        depth: Number.isFinite(parsedDepth) ? parsedDepth : undefined,
        limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined
      })
    );
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to build graph"
    });
  }
});

app.get("/api/resource/:namespace/:kind/:name", async (req, res) => {
  try {
    const resource = await resourceService.getResource(req.params.namespace, req.params.kind, req.params.name);
    if (!resource) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }
    res.json(resource);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load resource"
    });
  }
});

app.use(express.static(clientDistPath));
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    next();
    return;
  }
  res.sendFile(path.join(clientDistPath, "index.html"));
});

app.listen(port, () => {
  console.log(`Kausal server listening on port ${port}`);
});
