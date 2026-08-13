import { app } from "./app";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

app.listen(PORT, () => {
  console.log(`Pricing calculator API listening on http://localhost:${PORT}`);
});
