import z from "zod";
import { generateCompletion } from "@anvia/core";
import { getModel } from "../../llm/models";

const SeoMetaSchema = z.object({
  metaTitle: z.string().describe("SEO-optimized title, max 60 characters"),
  metaDescription: z.string().describe("SEO-optimized description, 150-160 characters"),
  keywords: z.array(z.string()).describe("Up to 5 relevant SEO keywords"),
  ogTitle: z.string().describe("Open Graph title for social media"),
  ogDescription: z.string().describe("Open Graph description for social media"),
});

const SYSTEM_INSTRUCTIONS = `You are an SEO expert. Given a blog post title and content, generate:
1. metaTitle: An SEO-optimized title (max 60 characters, include primary keyword)
2. metaDescription: An SEO-optimized meta description (150-160 characters, compelling and click-worthy)
3. keywords: An array of up to 5 relevant SEO keywords
4. ogTitle: Open Graph title for social media sharing (can be slightly longer than metaTitle)
5. ogDescription: Open Graph description for social media sharing

Return ONLY valid JSON matching the schema. Do not include any explanation.`;

export async function generateSeoMeta(title: string, content: string) {
  console.log(`Generating SEO meta for: ${title}`);

  const PROMPT = `Generate SEO meta tags for this blog post:

Title: ${title}

Content: ${content}`;

  const res = await generateCompletion({
    model: getModel(),
    prompt: PROMPT,
    instructions: SYSTEM_INSTRUCTIONS,
    outputSchema: SeoMetaSchema,
  });

  console.log("SEO meta generated successfully!");

  return res.output;
}
