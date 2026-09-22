import { adminLoginSchema } from "@ke/validation";
import { bodySchema } from "./lib/schema.js";
console.log(JSON.stringify(bodySchema(adminLoginSchema), null, 2));
