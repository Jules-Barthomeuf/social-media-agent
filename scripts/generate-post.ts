import dotenv from "dotenv";
dotenv.config();

import FirecrawlApp from "@mendable/firecrawl-js";
import { ChatAnthropic } from "@langchain/anthropic";

export async function generatePosts(url: string, topic: string) {
  console.log("🔍 Scraping:", url);

  const llm = new ChatAnthropic({
    model: "claude-3-5-sonnet-20241022",
    temperature: 0.7,
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });

  let scrapeResult;
  try {
    scrapeResult = await firecrawl.scrapeUrl(url, { formats: ["markdown"] });
  } catch (error: any) {
    console.error("❌ Firecrawl error:", error.message);
    throw new Error("Scraping failed");
  }

  const markdown = scrapeResult?.markdown?.trim() || "";
  if (markdown.length < 100) throw new Error("Too little content scraped.");

  const postLikeLines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) =>
      line.length > 80 &&
      !line.startsWith("http") &&
      !line.toLowerCase().includes("linkedin") &&
      !line.toLowerCase().startsWith("about") &&
      !line.includes("contact") &&
      !line.endsWith(":")
    )
    .slice(0, 6); // use 5–6 strong lines only

  if (postLikeLines.length < 3) {
    throw new Error("Not enough usable lines from profile.");
  }

  const prompt = `
You are a social media ghostwriter.

Here are some real example posts or excerpts scraped from a LinkedIn profile:
${postLikeLines.map((l, i) => `Post ${i + 1}: ${l}`).join("\n")}

Your task:
- Write exactly 10 original posts (each under 1000 characters)
- Make them feel like they came from the same person
- Topic: "${topic}"
- Return ONLY a JSON array of strings, like this: ["post 1", "post 2", ..., "post 10"]
- No explanations, no markdown, no labels, no emojis

Ensure the output is valid JSON and contains exactly 10 posts.
`;

  const maxRetries = 3;
  let attempt = 0;
  let posts: string[] = [];

  while (attempt < maxRetries) {
    try {
      const response = await llm.invoke([{ role: "user", content: prompt }]);
      const raw = (response as any).content || "[]";
      console.log(`📝 Raw response (attempt ${attempt + 1}):`, raw);

      try {
        posts = JSON.parse(raw);
      } catch {
        console.warn("⚠️ Failed to parse Claude output, returning raw lines");
        posts = raw.split("\n").filter((l) => l.trim().length > 0).map((l) => l.trim());
      }

      // Validate that we have exactly 10 posts
      if (Array.isArray(posts) && posts.length === 10 && posts.every(post => typeof post === "string" && post.trim() !== "")) {
        return posts;
      } else {
        console.warn(`⚠️ Generated ${posts.length} posts instead of 10. Retrying...`);
        attempt++;
        if (attempt === maxRetries) {
          throw new Error(`Failed to generate exactly 10 posts after ${maxRetries} attempts. Generated ${posts.length} posts.`);
        }
        // Wait briefly before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error: any) {
      attempt++;
      console.error(`❌ Attempt ${attempt} failed:`, error.message);
      if (attempt === maxRetries) {
        throw new Error(`Failed to generate posts after ${maxRetries} attempts: ${error.message}`);
      }
      // Wait briefly before retrying
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  throw new Error("Unexpected error: No posts generated after retries.");
}