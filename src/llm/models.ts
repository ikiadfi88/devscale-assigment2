import { OpenAIClient } from "@anvia/openai";
import "dotenv/config";

export const client = new OpenAIClient({
  apiKey: process.env.OPENAI_API_KEY || "",
  baseUrl: process.env.OPENAI_BASE_URL,
});

export function getModel(modelId?: string) {
  return client.completionModel({
    modelId: modelId || "deepseek-v4.1-flash",
  });
}
