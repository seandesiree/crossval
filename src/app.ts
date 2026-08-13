import express from "express";
import cors from "cors";
import path from "node:path";
import { authRouter } from "./routes/auth";
import { documentsRouter } from "./routes/documents";
import { reportsRouter } from "./routes/reports";

export const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/reports", reportsRouter);

app.use(express.static(path.join(__dirname, "..", "public")));

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});
