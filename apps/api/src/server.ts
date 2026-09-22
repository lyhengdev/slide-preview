import "dotenv/config";
import { startApi } from "./app.js";

startApi().catch((err) => {
  console.error(err);
  process.exit(1);
});