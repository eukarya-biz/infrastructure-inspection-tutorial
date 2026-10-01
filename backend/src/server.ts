import express from "express";
import dotenv from "dotenv";
import { assetsRouter } from "./routes/assets";
import { reportsRouter } from "./routes/reports";

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.use("/api/assets", assetsRouter);
app.use("/api/reports", reportsRouter);

app.listen(port, () => {
  console.log(`Backend running at http://localhost:${port}`);
});
