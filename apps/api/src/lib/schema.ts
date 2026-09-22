import { type ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export function bodySchema(schema: ZodType): { type: string; properties: object; required: string[] } {
  const json = zodToJsonSchema(schema, { target: "jsonSchema7", $refStrategy: "none" }) as {
    type: string;
    properties: object;
    required: string[];
  };
  return json;
}