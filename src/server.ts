import dotenv from "dotenv";
dotenv.config();
console.log("👀 Server script started");

import express from "express";
import { ChatAnthropic } from "@langchain/anthropic";
import path from "path";
import cors from "cors";
import { fileURLToPath } from "url";

import puppeteer from "puppeteer-extra";
import type { PuppeteerNode } from "puppeteer";
import stealth from "puppeteer-extra-plugin-stealth";

console.log("✅ Express, Puppeteer, and dependencies imported");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Apply the Stealth plugin
const stealthPlugin = stealth();
puppeteer.use(stealthPlugin);

// ✅ Scrape LinkedIn profile page using Puppeteer
async function scrapeLinkedIn(url: string): Promise<string> {
  console.log("🔍 Scraping with Puppeteer:", url);

  const browser = await (puppeteer as unknown as PuppeteerNode).launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    );

    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    const content = await page.evaluate(
      () => document.querySelector("body")?.innerText || ""
    );

    if (!content || content.length < 100) {
      throw new Error(
        "Insufficient scraped content. The URL may require authentication or CAPTCHA handling."
      );
    }

    console.log("📄 Scrape result size:", content.length);
    return content;
  } catch (error: any) {
    console.error("❌ Puppeteer error:", error.message);
    throw new Error(
      `Failed to scrape URL: ${error.message}. Ensure the URL is accessible.`
    );
  } finally {
    await browser.close();
  }
}

// ✅ Generate posts from scraped content
async function generatePosts(url: string, topic: string): Promise<string[]> {
  const llm = new ChatAnthropic({
    model: "claude-3-5-sonnet-20241022",
    temperature: 0.7,
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  let profileData: string;
  try {
    profileData = await scrapeLinkedIn(url);
  } catch (error: any) {
    throw new Error(error.message);
  }

  const prompt = `
You are a social media expert. Based on this scraped LinkedIn profile content:

"""${profileData}"""

Generate exactly 10 original LinkedIn-style posts about "${topic}". Each post should  mimic the typical length and style of LinkedIn posts. Format each post with line breaks between sentences using "\\n" (e.g., "First sentence.\\nSecond sentence.\\nThird sentence."). The posts must be returned as a JSON array of strings, like this: ["First sentence.\\nSecond sentence.", "First sentence.\\nSecond sentence.", ..., "First sentence.\\nSecond sentence."]. Do not include hashtags, and only use emojis if the profile content uses them. Ensure the output is valid JSON.
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
        console.warn("⚠️ Claude response not JSON. Fallback to splitting lines.");
        posts = raw.split("\n").filter((l: string) => l.trim()).map((l: string) => l.trim());
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

// ✅ Express server setup
try {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "../public")));

  app.post("/generate-posts", async (req, res) => {
    console.log("📩 Received POST /generate-posts");
    try {
      const { url, topic } = req.body;
      if (!url || !topic) {
        return res.status(400).json({ error: "URL and topic required" });
      }
      const posts = await generatePosts(url, topic);
      res.json({ posts });
    } catch (error: any) {
      console.error("❌ Error generating posts:", error.message, error.stack);
      res.status(500).json({ error: error.message });
    }
  });

  // Explicit routes for each page
  app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/index.html"));
  });

  app.get("/signin.html", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/signin.html"));
  });

  app.get("/generator.html", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/generator.html"));
  });

  app.listen(54367, () => {
    console.log("✅ Server running on http://localhost:54367");
  });
} catch (error: any) {
  console.error("❌ Failed to start server:", error.message, error.stack);
  process.exit(1);
}

// Global error handling
process.on("uncaughtException", (err) =>
  console.error("Uncaught Exception:", err.message, err.stack)
);
process.on("unhandledRejection", (err) =>
  console.error("Unhandled Rejection:", err)
);